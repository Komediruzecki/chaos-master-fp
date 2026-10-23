/** Independent, bounded-domain MLS-MPM particle jelly; legacy tetrahedral studies are untouched. */
import { d } from 'typegpu'
import { summarizeGummyParticles } from './gummyParticleDiagnostics'
import { GUMMY_PARTICLE_OUTER_DT, gummyParticleMaterial, gummyParticleViscousSpeedLimit, } from './gummyParticleMath'
import { prepareGummyParticleSolver } from './gummyParticlePreparation'
import { createGummyParticleResources } from './gummyParticleResources'
import { GummyParticleParameters } from './gummyParticleShaders'
import { validateGummyParticleGripMotion, writeGummyParticleUniforms, } from './gummyParticleUniforms'
import { normalizeGummyRookCollider } from './gummyRookCollider'
import type { TgpuRoot } from 'typegpu'
import type { GummyParticleOptions, GummyParticleStep, } from './gummyParticleContracts'

export type {
  GummyParticleStep,
  GummyParticleOptions,
} from './gummyParticleContracts'

export function createGummyParticleSolver(
  root: TgpuRoot,
  device: GPUDevice,
  options: GummyParticleOptions = {},
) {
  if (root.device !== device)
    throw new Error('Particle solver root and device must match')
  const preparedGeometry = prepareGummyParticleSolver(options)
  const {
    geometry,
    restPositions,
    particleCount,
    spacing,
    gridSpacing,
    substeps,
    fixedDt,
    gridSize,
    gridCount,
    gridOrigin,
    initialPositions,
    initialStates,
  } = preparedGeometry
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const {
      positions,
      velocities,
      states,
      grip,
      grid,
      gridVelocities,
      params,
      clock,
      capture,
      p2g,
      gridUpdate,
      g2p,
      advanceTime,
    } = createGummyParticleResources(
      root,
      device,
      options,
      preparedGeometry,
      own,
    )
    const uniform = new ArrayBuffer(d.sizeOf(GummyParticleParameters))
    const f32 = new Float32Array(uniform)
    const u32 = new Uint32Array(uniform)
    let simulationTime = 0
    let accumulator = 0
    let disposed = false
    let gripKey = ''
    let previousPressHeight: number | undefined
    let lastMaterial = gummyParticleMaterial(0.55)

    function prepareStep(dt: number, input: GummyParticleStep) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return undefined
      const collider = normalizeGummyRookCollider(input.collider)
      validateGummyParticleGripMotion(input.gripMotion)
      accumulator = Math.min(6 * GUMMY_PARTICLE_OUTER_DT, accumulator + dt)
      const count = Math.floor(
        (accumulator + 0.000000001) / GUMMY_PARTICLE_OUTER_DT,
      )
      if (!count) return undefined
      accumulator -= count * GUMMY_PARTICLE_OUTER_DT
      lastMaterial = gummyParticleMaterial(
        input.softness,
        input.particleMaterial,
        input.fragility,
        input.tuning,
      )
      const { pressHeight, key } = writeGummyParticleUniforms(
        f32,
        u32,
        input,
        preparedGeometry,
        options.pairContact,
        previousPressHeight,
        count,
        collider,
        lastMaterial,
      )
      previousPressHeight = pressHeight
      params.write(uniform)
      const captureGrip = !!key && key !== gripKey
      gripKey = key
      return { count, captureGrip, collider: !!collider }
    }

    type PreparedStep = NonNullable<ReturnType<typeof prepareStep>>

    function encodeSetup(encoder: GPUCommandEncoder, prepared: PreparedStep) {
      if (prepared.collider) encoder.clearBuffer(root.unwrap(clock))
      if (prepared.captureGrip) {
        const pass = encoder.beginComputePass()
        capture.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        pass.end()
      }
    }

    function encodeP2G(encoder: GPUCommandEncoder) {
      encoder.clearBuffer(root.unwrap(grid))
      const pass = encoder.beginComputePass()
      p2g.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
      pass.end()
    }

    function encodeGrid(encoder: GPUCommandEncoder) {
      const pass = encoder.beginComputePass()
      gridUpdate.with(pass).dispatchWorkgroups(Math.ceil(gridCount / 64))
      pass.end()
    }

    function encodeG2P(encoder: GPUCommandEncoder) {
      const pass = encoder.beginComputePass()
      g2p.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
      pass.end()
    }

    function recordSteps(count: number) {
      simulationTime += count * GUMMY_PARTICLE_OUTER_DT
    }

    function step(dt: number, input: GummyParticleStep) {
      const prepared = prepareStep(dt, input)
      if (!prepared) return 0
      const encoder = device.createCommandEncoder({
        label: 'Particle jelly MLS-MPM fixed steps',
      })
      encodeSetup(encoder, prepared)
      for (let i = 0; i < prepared.count * substeps; i++) {
        encoder.clearBuffer(root.unwrap(grid))
        const pass = encoder.beginComputePass()
        p2g.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        gridUpdate.with(pass).dispatchWorkgroups(Math.ceil(gridCount / 64))
        g2p.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        if (prepared.collider) advanceTime.with(pass).dispatchWorkgroups(1)
        pass.end()
      }
      device.queue.submit([encoder.finish()])
      recordSteps(prepared.count)
      return prepared.count
    }

    function reset() {
      if (disposed) return
      positions.write(initialPositions.buffer)
      states.write(initialStates.buffer)
      const encoder = device.createCommandEncoder({
        label: 'Particle jelly reset',
      })
      for (const buffer of [velocities, grip, grid, gridVelocities, clock])
        encoder.clearBuffer(root.unwrap(buffer))
      device.queue.submit([encoder.finish()])
      simulationTime = 0
      accumulator = 0
      gripKey = ''
      previousPressHeight = undefined
    }

    /** Picking needs only current positions, without material diagnostics or other readbacks. */
    async function readPositions(): Promise<Float32Array> {
      if (disposed) throw new Error('Particle solver has been destroyed')
      const points = await positions.read()
      if (disposed) throw new Error('Particle solver has been destroyed')
      const packed = new Float32Array(particleCount * 4)
      for (let id = 0; id < particleCount; id++) {
        const point = points[id]!
        packed[id * 4] = point.x
        packed[id * 4 + 1] = point.y
        packed[id * 4 + 2] = point.z
        packed[id * 4 + 3] = point.w
      }
      return packed
    }

    async function readState() {
      if (disposed) throw new Error('Particle solver has been destroyed')
      const [p, v, state, captured] = await Promise.all([
        positions.read(),
        velocities.read(),
        states.read(),
        grip.read(),
      ])
      return summarizeGummyParticles(
        p,
        v,
        state,
        captured,
        geometry,
        lastMaterial,
        simulationTime,
        gripKey,
      )
    }

    return {
      materialModel: 'mls-mpm' as const,
      positions,
      restPositions,
      initialPositions,
      particleCount,
      spacing,
      gridSpacing,
      gridSize,
      substeps,
      fixedDt,
      restVolume: geometry.restVolume,
      transfer: 'f32-node-gather' as const,
      waveSpeedBound: geometry.waveSpeedBound,
      get nodalSpeedBound() {
        return gummyParticleViscousSpeedLimit(
          fixedDt,
          gridSpacing,
          lastMaterial.viscosity,
          lastMaterial.gravity,
        )
      },
      bounds: geometry.bounds,
      gridBounds: {
        min: [...gridOrigin],
        max: gridOrigin.map((value) => value + gridSize * gridSpacing),
      },
      step,
      reset,
      readPositions,
      readState,
      /** Split transfers let the pair owner couple independent grids before either body's G2P. */
      kernels: {
        prepareStep,
        encodeSetup,
        encodeP2G,
        encodeGrid,
        encodeG2P,
        recordSteps,
        grid,
        gridVelocities,
        velocities,
        states,
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
