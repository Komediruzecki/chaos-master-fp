/** Independent, bounded-domain MLS-MPM particle jelly; legacy tetrahedral studies are untouched. */
import { d } from 'typegpu'
import { GUMMY_PARTICLE_GRID_SIZE, GUMMY_PARTICLE_MAX_AFFINE, GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_SPEED, GUMMY_PARTICLE_OUTER_DT, gummyParticleMaterial, prepareGummyParticles, } from './gummyParticleMath'
import { gummyParticleCaptureGrip, gummyParticleG2P, GummyParticleGrid, gummyParticleGridUpdate, gummyParticleLayout, gummyParticleP2G, GummyParticleParameters, GummyParticleState, } from './gummyParticleShaders'
import { normalizeGummyPress } from './gummySolver'
import type { TgpuRoot } from 'typegpu'
import type { GummyStep } from './gummySolver'

export type GummyParticleOptions = Parameters<typeof prepareGummyParticles>[0]

export function createGummyParticleSolver(
  root: TgpuRoot,
  device: GPUDevice,
  options: GummyParticleOptions = {},
) {
  if (root.device !== device)
    throw new Error('Particle solver root and device must match')
  const geometry = prepareGummyParticles(options)
  const {
    restPositions,
    particleCount,
    spacing,
    gridSpacing,
    substeps,
    fixedDt,
  } = geometry
  const gridCount = GUMMY_PARTICLE_GRID_SIZE ** 3
  const initialPositions = new Float32Array(restPositions)
  const initialStates = new Float32Array(
    (particleCount * d.sizeOf(GummyParticleState)) / 4,
  )
  for (let id = 0; id < particleCount; id++) {
    const base = (id * d.sizeOf(GummyParticleState)) / 4
    initialStates[base] = 1
    initialStates[base + 5] = 1
    initialStates[base + 10] = 1
    initialStates[base + 25] = 1
  }
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const positions = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, particleCount), (mapped) => {
          mapped.write(initialPositions.buffer)
        })
        .$usage('storage'),
    )
    const rest = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, particleCount), (mapped) => {
          mapped.write(restPositions.buffer)
        })
        .$usage('storage'),
    )
    const velocities = own(
      root.createBuffer(d.arrayOf(d.vec4f, particleCount)).$usage('storage'),
    )
    const states = own(
      root
        .createBuffer(
          d.arrayOf(GummyParticleState, particleCount),
          (mapped) => {
            mapped.write(initialStates.buffer)
          },
        )
        .$usage('storage'),
    )
    const grip = own(
      root.createBuffer(d.arrayOf(d.vec4f, particleCount)).$usage('storage'),
    )
    const grid = own(
      root
        .createBuffer(d.arrayOf(GummyParticleGrid, gridCount))
        .$usage('storage'),
    )
    const gridVelocities = own(
      root.createBuffer(d.arrayOf(d.vec4f, gridCount)).$usage('storage'),
    )
    const params = own(
      root.createBuffer(GummyParticleParameters).$usage('uniform'),
    )
    const group = root.createBindGroup(gummyParticleLayout, {
      params,
      positions,
      rest,
      velocities,
      states,
      grip,
      grid,
      gridVelocities,
    })
    const capture = root
      .createComputePipeline({ compute: gummyParticleCaptureGrip })
      .with(group)
    const p2g = root
      .createComputePipeline({ compute: gummyParticleP2G })
      .with(group)
    const gridUpdate = root
      .createComputePipeline({ compute: gummyParticleGridUpdate })
      .with(group)
    const g2p = root
      .createComputePipeline({ compute: gummyParticleG2P })
      .with(group)
    for (const pipeline of [capture, p2g, gridUpdate, g2p])
      root.unwrap(pipeline)
    for (const buffer of [
      positions,
      rest,
      velocities,
      states,
      grip,
      grid,
      gridVelocities,
      params,
    ])
      root.unwrap(buffer)
    const uniform = new ArrayBuffer(d.sizeOf(GummyParticleParameters))
    const f32 = new Float32Array(uniform)
    const u32 = new Uint32Array(uniform)
    let simulationTime = 0
    let accumulator = 0
    let disposed = false
    let gripKey = ''
    let previousPressHeight: number | undefined
    let lastMaterial = gummyParticleMaterial(0.55)

    function step(dt: number, input: GummyStep) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return 0
      accumulator = Math.min(6 * GUMMY_PARTICLE_OUTER_DT, accumulator + dt)
      const count = Math.floor(
        (accumulator + 0.000000001) / GUMMY_PARTICLE_OUTER_DT,
      )
      if (!count) return 0
      accumulator -= count * GUMMY_PARTICLE_OUTER_DT
      lastMaterial = gummyParticleMaterial(input.softness)
      f32.fill(0)
      f32.set([fixedDt, gridSpacing, geometry.particleVolume, spacing * 0.5], 0)
      f32.set(
        [
          lastMaterial.shearModulus,
          lastMaterial.bulkModulus,
          0.35,
          input.tearing ? 1 : 0,
        ],
        4,
      )
      f32.set([...geometry.gridOrigin, geometry.pinHeight], 8)
      u32.set([particleCount, GUMMY_PARTICLE_GRID_SIZE, gridCount, 0], 12)
      if (input.grip) {
        if (
          ![
            ...input.grip.center,
            ...input.grip.target,
            input.grip.radius,
          ].every(Number.isFinite) ||
          input.grip.radius <= 0
        )
          throw new Error(
            'Particle grip must have finite coordinates and a positive radius',
          )
        f32.set([...input.grip.center, input.grip.radius], 16)
        f32.set([...input.grip.target, 1], 20)
      }
      const press = normalizeGummyPress(input.press)
      if (press) {
        const velocity =
          previousPressHeight === undefined
            ? 0
            : Math.max(
                -2,
                Math.min(
                  2,
                  (press.height - previousPressHeight) /
                    (count * GUMMY_PARTICLE_OUTER_DT),
                ),
              )
        f32.set(
          [Math.max(spacing, press.height), press.halfExtent, 1, velocity],
          24,
        )
      }
      previousPressHeight = press?.height
      f32.set(
        [
          GUMMY_PARTICLE_MAX_SPEED,
          GUMMY_PARTICLE_MAX_AFFINE,
          GUMMY_PARTICLE_MAX_F_NORM,
          9.81,
        ],
        28,
      )
      params.write(uniform)
      const key = input.grip
        ? `${input.grip.center.join(':')}:${input.grip.radius}`
        : ''
      const captureGrip = !!key && key !== gripKey
      gripKey = key
      const encoder = device.createCommandEncoder({
        label: 'Particle jelly MLS-MPM fixed steps',
      })
      if (captureGrip) {
        const pass = encoder.beginComputePass()
        capture.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        pass.end()
      }
      for (let i = 0; i < count * substeps; i++) {
        encoder.clearBuffer(root.unwrap(grid))
        const pass = encoder.beginComputePass()
        p2g.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        gridUpdate.with(pass).dispatchWorkgroups(Math.ceil(gridCount / 64))
        g2p.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        pass.end()
      }
      device.queue.submit([encoder.finish()])
      simulationTime += count * GUMMY_PARTICLE_OUTER_DT
      return count
    }

    function reset() {
      if (disposed) return
      positions.write(initialPositions.buffer)
      states.write(initialStates.buffer)
      const encoder = device.createCommandEncoder({
        label: 'Particle jelly reset',
      })
      for (const buffer of [velocities, grip, grid, gridVelocities])
        encoder.clearBuffer(root.unwrap(buffer))
      device.queue.submit([encoder.finish()])
      simulationTime = 0
      accumulator = 0
      gripKey = ''
      previousPressHeight = undefined
    }

    async function readState() {
      if (disposed) throw new Error('Particle solver has been destroyed')
      const [p, v, state, captured] = await Promise.all([
        positions.read(),
        velocities.read(),
        states.read(),
        grip.read(),
      ])
      const packedPositions = new Float32Array(particleCount * 4)
      const packedVelocities = new Float32Array(particleCount * 4)
      const deformation = new Float32Array(particleCount * 12)
      const damage = new Float32Array(particleCount)
      const peakStretch = new Float32Array(particleCount)
      const J = new Float32Array(particleCount)
      let guardActivations = 0
      let speedCaps = 0
      let affineCaps = 0
      let deformationRejections = 0
      let domainContacts = 0
      let zeroShearUpdates = 0
      let elasticEnergy = 0
      let kineticEnergy = 0
      let gripCount = 0
      let maxGridSpeed = 0
      let maxParticleSpeed = 0
      let speedCapImpulse = 0
      let particleSpeedCaps = 0
      let gridSpeedCaps = 0
      for (let id = 0; id < particleCount; id++) {
        const point = p[id]!
        const velocity = v[id]!
        const material = state[id]!
        packedPositions.set([point.x, point.y, point.z, point.w], id * 4)
        packedVelocities.set(
          [velocity.x, velocity.y, velocity.z, velocity.w],
          id * 4,
        )
        for (let col = 0; col < 3; col++) {
          const c = material.deformation.columns[col]!
          deformation.set([c.x, c.y, c.z, 0], id * 12 + col * 4)
        }
        const [a, b, c] = material.deformation.columns
        const jacobian =
          a.x * (b.y * c.z - b.z * c.y) +
          a.y * (b.z * c.x - b.x * c.z) +
          a.z * (b.x * c.y - b.y * c.x)
        const trace = [...a, ...b, ...c].reduce(
          (sum, value) => sum + value * value,
          0,
        )
        const logJ = Math.log(jacobian)
        const mu = lastMaterial.shearModulus * (1 - material.history.x) ** 2
        elasticEnergy +=
          geometry.particleVolume *
          ((mu * (trace - 3)) / 2 -
            mu * logJ +
            (lastMaterial.bulkModulus * logJ * logJ) / 2)
        kineticEnergy +=
          (geometry.particleVolume *
            (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)) /
          2
        J[id] = jacobian
        damage[id] = material.history.x
        peakStretch[id] = material.history.y
        speedCaps += material.history.z
        affineCaps += material.history.w
        deformationRejections += material.diagnostics.x
        domainContacts += material.diagnostics.y
        zeroShearUpdates += material.diagnostics.z
        maxGridSpeed = Math.max(maxGridSpeed, material.transfer.x)
        maxParticleSpeed = Math.max(maxParticleSpeed, velocity.w)
        speedCapImpulse += material.transfer.y
        particleSpeedCaps += material.transfer.z
        gridSpeedCaps += material.transfer.w
        if (captured[id]!.w > 0) gripCount++
      }
      guardActivations = speedCaps + affineCaps + deformationRejections
      return {
        positions: packedPositions,
        velocities: packedVelocities,
        deformation,
        damage,
        peakStretch,
        J,
        simulationTime,
        particleCount,
        totalMass: geometry.restVolume,
        restVolume: geometry.restVolume,
        elasticEnergy,
        kineticEnergy,
        guardActivations,
        speedCaps,
        affineCaps,
        deformationRejections,
        domainContacts,
        zeroShearUpdates,
        maxGridSpeed,
        maxParticleSpeed,
        speedCapImpulse,
        particleSpeedCaps,
        gridSpeedCaps,
        gripCount: gripKey ? gripCount : 0,
      }
    }

    return {
      materialModel: 'mls-mpm' as const,
      positions,
      restPositions,
      particleCount,
      spacing,
      gridSpacing,
      substeps,
      fixedDt,
      restVolume: geometry.restVolume,
      transfer: 'f32-node-gather' as const,
      waveSpeedBound: geometry.waveSpeedBound,
      nodalSpeedBound: geometry.nodalSpeedBound,
      bounds: geometry.bounds,
      gridBounds: {
        min: [...geometry.gridOrigin],
        max: geometry.gridOrigin.map(
          (value) => value + GUMMY_PARTICLE_GRID_SIZE * gridSpacing,
        ),
      },
      step,
      reset,
      readState,
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
