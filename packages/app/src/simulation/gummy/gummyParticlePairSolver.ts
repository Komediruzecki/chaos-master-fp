/** Two independently deformable chess pieces exchange geometric contact impulses between shared MPM kernels. */
import { d } from 'typegpu'
import { gummyPairContactLayout, gummyPairProximityLayout, gummyParticlePairContact, GummyParticlePairParameters, gummyParticlePairProximity, } from './gummyParticlePairShaders'
import { createGummyParticleSolver } from './gummyParticleSolver'
import { normalizeGummyRookCollider } from './gummyRookCollider'
import type { TgpuRoot } from 'typegpu'
import type { GummyParticleStep } from './gummyParticleSolver'

export const GUMMY_PAIR_ROOK_ORIGIN = [-3.2, 0, 0] as const
export type GummyParticlePairStep = Omit<
  GummyParticleStep,
  'collider' | 'gripMotion'
> & {
  /** A moving attachment to base material only; every rook particle remains deformable. */
  rookGuide?: {
    position: readonly [number, number, number]
    velocity: readonly [number, number, number]
  }
  friction?: number
}

export function createGummyParticlePairSolver(
  root: TgpuRoot,
  device: GPUDevice,
  options: { spacing?: number; pinnedFeet?: boolean } = {},
) {
  if (root.device !== device)
    throw new Error('Particle pair root and device must match')
  const spacing = options.spacing ?? 0.08
  if (!Number.isFinite(spacing) || spacing < 0.06 || spacing > 0.12)
    throw new RangeError('Particle pair spacing must be between 0.06 and 0.12')
  const gridSpacing = spacing * 2
  const gridSize = Math.max(32, Math.ceil(7.68 / gridSpacing))
  const gridOrigin = [
    -4.32,
    -2 * gridSpacing,
    -gridSize * gridSpacing * 0.5,
  ] as const
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const pawn = own(
      createGummyParticleSolver(root, device, {
        fixture: 'pawn',
        spacing,
        pinnedFeet: options.pinnedFeet,
        gridOrigin,
        gridSize,
        pairContact: true,
      }),
    )
    const rook = own(
      createGummyParticleSolver(root, device, {
        fixture: 'rook',
        spacing,
        pinnedFeet: false,
        initialOffset: GUMMY_PAIR_ROOK_ORIGIN,
        gridOrigin,
        gridSize,
        pairContact: true,
      }),
    )
    const params = own(
      root.createBuffer(GummyParticlePairParameters).$usage('uniform'),
    )
    const proximity = root
      .createComputePipeline({ compute: gummyParticlePairProximity })
      .with(
        root.createBindGroup(gummyPairProximityLayout, {
          params,
          positionsA: pawn.positions,
          positionsB: rook.positions,
          velocitiesA: pawn.kernels.velocities,
          velocitiesB: rook.kernels.velocities,
          statesA: pawn.kernels.states,
          statesB: rook.kernels.states,
          gridB: rook.kernels.grid,
        }),
      )
    const contact = root
      .createComputePipeline({ compute: gummyParticlePairContact })
      .with(
        root.createBindGroup(gummyPairContactLayout, {
          params,
          gridA: pawn.kernels.grid,
          gridB: rook.kernels.grid,
          velocitiesA: pawn.kernels.gridVelocities,
          velocitiesB: rook.kernels.gridVelocities,
        }),
      )
    root.unwrap(proximity)
    root.unwrap(contact)
    const uniform = new ArrayBuffer(d.sizeOf(GummyParticlePairParameters))
    const f32 = new Float32Array(uniform),
      u32 = new Uint32Array(uniform)
    let disposed = false

    function step(dt: number, input: GummyParticlePairStep) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return 0
      const guide = normalizeGummyRookCollider(input.rookGuide)
      const friction = input.friction ?? 0.45
      if (!Number.isFinite(friction))
        throw new RangeError('Pair friction must be finite')
      const preparedPawn = pawn.kernels.prepareStep(dt, input)
      const preparedRook = rook.kernels.prepareStep(dt, {
        ...input,
        gripSpace: 'rest',
        grip: guide
          ? {
              center: [...GUMMY_PAIR_ROOK_ORIGIN],
              target: [...guide.position],
              radius: 0.72,
            }
          : undefined,
        gripMotion: guide
          ? { velocity: guide.velocity, baseHeight: 0.36 }
          : undefined,
      })
      if (!preparedPawn || !preparedRook) return 0
      if (preparedPawn.count !== preparedRook.count)
        throw new Error('Particle pair clocks diverged')
      f32.set([
        pawn.fixedDt,
        gridSpacing,
        spacing,
        Math.max(0, Math.min(1, friction)),
      ])
      f32.set([...gridOrigin, 0], 4)
      u32.set(
        [pawn.particleCount, rook.particleCount, gridSize, gridSize ** 3],
        8,
      )
      params.write(uniform)
      const encoder = device.createCommandEncoder({
        label: 'Two-body gummy MPM contact',
      })
      pawn.kernels.encodeSetup(encoder, preparedPawn)
      rook.kernels.encodeSetup(encoder, preparedRook)
      for (let i = 0; i < preparedPawn.count * pawn.substeps; i++) {
        pawn.kernels.encodeP2G(encoder)
        rook.kernels.encodeP2G(encoder)
        const proximityPass = encoder.beginComputePass()
        proximity
          .with(proximityPass)
          .dispatchWorkgroups(Math.ceil(pawn.particleCount / 64))
        proximityPass.end()
        pawn.kernels.encodeGrid(encoder)
        rook.kernels.encodeGrid(encoder)
        const contactPass = encoder.beginComputePass()
        contact
          .with(contactPass)
          .dispatchWorkgroups(Math.ceil(gridSize ** 3 / 64))
        contactPass.end()
        pawn.kernels.encodeG2P(encoder)
        rook.kernels.encodeG2P(encoder)
      }
      device.queue.submit([encoder.finish()])
      pawn.kernels.recordSteps(preparedPawn.count)
      rook.kernels.recordSteps(preparedRook.count)
      return preparedPawn.count
    }
    return {
      materialModel: 'two-body-mls-mpm' as const,
      pawn,
      rook,
      step,
      reset() {
        if (!disposed) {
          pawn.reset()
          rook.reset()
        }
      },
      async readState() {
        if (disposed) throw new Error('Particle pair has been destroyed')
        const [pawnState, rookState] = await Promise.all([
          pawn.readState(),
          rook.readState(),
        ])
        if (disposed) throw new Error('Particle pair has been destroyed')
        return { pawn: pawnState, rook: rookState }
      },
      destroy() {
        if (disposed) return
        disposed = true
        for (const resource of owned.reverse()) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned.reverse()) resource.destroy()
    throw error
  }
}
