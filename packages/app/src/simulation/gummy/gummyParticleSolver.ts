/** Independent, bounded-domain MLS-MPM particle jelly; legacy tetrahedral studies are untouched. */
import { d } from 'typegpu'
import { createGummyChessCollider, gummyChessColliderContact, gummyChessColliderMayContact, } from './gummyChessCollider'
import { GUMMY_PARTICLE_GRID_SIZE, GUMMY_PARTICLE_MAX_AFFINE, GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_SPEED, GUMMY_PARTICLE_OUTER_DT, gummyParticleMaterial, gummyParticleViscousSpeedLimit, gummyParticleWarmVolumetricEnergy, prepareGummyParticles, } from './gummyParticleMath'
import { gummyParticleAdvanceTime, gummyParticleCaptureGrip, gummyParticleG2P, GummyParticleGrid, gummyParticleGridUpdate, gummyParticleLayout, gummyParticleP2G, GummyParticleParameters, GummyParticleState, } from './gummyParticleShaders'
import { gummyColliderContactSlot, gummyColliderMayContactSlot, normalizeGummyRookCollider, } from './gummyRookCollider'
import { normalizeGummyPress } from './gummySolver'
import type { TgpuRoot } from 'typegpu'
import type { GummyChessMould } from './gummyChessMoulds'
import type { GummyParticleMaterialMode, GummyParticleTuning, } from './gummyParticleMath'
import type { GummyRookCollider } from './gummyRookCollider'
import type { GummyStep } from './gummySolver'

export type GummyParticleStep = GummyStep & {
  particleMaterial?: GummyParticleMaterialMode
  /** Current selects a spatial patch of deformed material; rest preserves scripted baseline grips. */
  gripSpace?: 'rest' | 'current'
  fragility?: number
  tuning?: Partial<GummyParticleTuning>
  /** Prescribed rigid rook; the victim is the only deformable body in this solver. */
  collider?: GummyRookCollider
  /** Moving grip attachment, optionally restricted to the original base material. */
  gripMotion?: {
    velocity: readonly [number, number, number]
    baseHeight?: number
  }
}

export type GummyParticleOptions = Parameters<
  typeof prepareGummyParticles
>[0] & {
  /** Simulation-space placement; the public rest dye coordinates remain mould-local. */
  initialOffset?: readonly [number, number, number]
  initialRotationY?: number
  colliderMould?: GummyChessMould
  colliderRotationY?: number
  gridOrigin?: readonly [number, number, number]
  gridSize?: number
  /** Enable independent-grid geometric contact gathers for the pair owner. */
  pairContact?: boolean
}

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
  const gridSize = options.gridSize ?? GUMMY_PARTICLE_GRID_SIZE
  if (!Number.isInteger(gridSize) || gridSize < 32 || gridSize > 64)
    throw new RangeError('Particle grid size must be an integer from 32 to 64')
  const gridCount = gridSize ** 3
  const initialOffset = options.initialOffset ?? [0, 0, 0]
  const gridOrigin = options.gridOrigin ?? geometry.gridOrigin
  if (![...initialOffset, ...gridOrigin].every(Number.isFinite))
    throw new RangeError('Particle placement and grid origin must be finite')
  const initialRotationY = options.initialRotationY ?? 0
  if (
    !Number.isFinite(initialRotationY) ||
    !Number.isFinite(options.colliderRotationY ?? 0)
  )
    throw new RangeError('Particle and collider orientations must be finite')
  const cosine = Math.cos(initialRotationY),
    sine = Math.sin(initialRotationY)
  const initialPositions = new Float32Array(restPositions)
  for (let i = 0; i < initialPositions.length; i += 4) {
    const x = restPositions[i]!,
      z = restPositions[i + 2]!
    initialPositions[i] = x * cosine + z * sine + initialOffset[0]
    initialPositions[i + 1]! += initialOffset[1]
    initialPositions[i + 2] = z * cosine - x * sine + initialOffset[2]
  }
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
          mapped.write(initialPositions.buffer)
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
    const clock = own(root.createBuffer(d.arrayOf(d.f32, 1)).$usage('storage'))
    const group = root.createBindGroup(gummyParticleLayout, {
      params,
      positions,
      rest,
      velocities,
      states,
      grip,
      grid,
      gridVelocities,
      clock,
    })
    const capture = root
      .createComputePipeline({ compute: gummyParticleCaptureGrip })
      .with(group)
    const sampledCollider =
      options.colliderMould !== undefined &&
      (options.colliderMould !== 'rook' ||
        options.artStyle === 'sculpted' ||
        (options.colliderRotationY ?? 0) !== 0)
        ? own(
            createGummyChessCollider(
              root,
              device,
              options.colliderMould,
              options.colliderRotationY,
              options.artStyle,
            ),
          )
        : undefined
    const contactRoot = sampledCollider
      ? root
          .with(gummyColliderContactSlot, gummyChessColliderContact)
          .with(gummyColliderMayContactSlot, gummyChessColliderMayContact)
      : root
    let p2g = contactRoot
      .createComputePipeline({ compute: gummyParticleP2G })
      .with(group)
    const gridUpdate = root
      .createComputePipeline({ compute: gummyParticleGridUpdate })
      .with(group)
    let g2p = contactRoot
      .createComputePipeline({ compute: gummyParticleG2P })
      .with(group)
    if (sampledCollider) {
      p2g = p2g.with(sampledCollider.group)
      g2p = g2p.with(sampledCollider.group)
    }
    const advanceTime = root
      .createComputePipeline({ compute: gummyParticleAdvanceTime })
      .with(group)
    for (const pipeline of [capture, p2g, gridUpdate, g2p, advanceTime])
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
      clock,
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

    function prepareStep(dt: number, input: GummyParticleStep) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return undefined
      const collider = normalizeGummyRookCollider(input.collider)
      if (
        input.gripMotion &&
        (!input.gripMotion.velocity.every(Number.isFinite) ||
          Math.hypot(...input.gripMotion.velocity) > 32 ||
          !Number.isFinite(input.gripMotion.baseHeight ?? 0) ||
          (input.gripMotion.baseHeight ?? 0) < 0 ||
          (input.gripMotion.baseHeight ?? 0) > 0.6)
      )
        throw new RangeError('Grip motion must be finite and bounded')
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
      f32.set([...gridOrigin, geometry.pinHeight], 8)
      u32.set(
        [particleCount, gridSize, gridCount, options.pairContact ? 1 : 0],
        12,
      )
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
          lastMaterial.gravity,
        ],
        28,
      )
      f32.set(
        [
          lastMaterial.mode === 'warm' ? 1 : 0,
          lastMaterial.relaxationRate,
          lastMaterial.damageRate,
          lastMaterial.viscosity,
        ],
        32,
      )
      f32.set(
        [
          input.gripSpace === 'current' ? 1 : 0,
          lastMaterial.gripStiffness,
          lastMaterial.gripDamping,
          lastMaterial.floorDrag,
        ],
        36,
      )
      f32.set(
        [
          lastMaterial.yieldStretch,
          lastMaterial.damageOnset,
          lastMaterial.damageComplete,
          0,
        ],
        40,
      )
      if (collider) {
        f32.set([...collider.position, 1], 44)
        f32.set([...collider.velocity, collider.friction], 48)
      }
      if (input.gripMotion)
        f32.set(
          [...input.gripMotion.velocity, input.gripMotion.baseHeight ?? 0],
          52,
        )
      params.write(uniform)
      const key = input.grip
        ? `${input.gripSpace ?? 'rest'}:${input.grip.center.join(':')}:${input.grip.radius}:${input.gripMotion?.baseHeight ?? 0}`
        : ''
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
      const packedPositions = new Float32Array(particleCount * 4)
      const packedVelocities = new Float32Array(particleCount * 4)
      const deformation = new Float32Array(particleCount * 12)
      const damage = new Float32Array(particleCount)
      const peakStretch = new Float32Array(particleCount)
      const plasticStrain = new Float32Array(particleCount)
      let maxPlasticStrain = 0
      const volumetricOpening = new Float32Array(particleCount)
      let maxVolumetricOpening = 0
      let cavitationUpdates = 0
      const J = new Float32Array(particleCount)
      let guardActivations = 0
      let speedCaps = 0
      let affineCaps = 0
      let deformationRejections = 0
      let domainContacts = 0
      let zeroShearUpdates = 0
      let relaxationUpdates = 0
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
        const volumetricEnergy =
          lastMaterial.mode === 'warm'
            ? gummyParticleWarmVolumetricEnergy(
                logJ,
                lastMaterial.bulkModulus,
                material.history.x,
              )
            : (lastMaterial.bulkModulus * logJ * logJ) / 2
        elasticEnergy +=
          geometry.particleVolume *
          ((mu * (trace - 3)) / 2 - mu * logJ + volumetricEnergy)
        kineticEnergy +=
          (geometry.particleVolume *
            (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)) /
          2
        J[id] = jacobian
        damage[id] = material.history.x
        peakStretch[id] = material.history.y
        plasticStrain[id] = material.flow.x
        maxPlasticStrain = Math.max(maxPlasticStrain, material.flow.x)
        volumetricOpening[id] = material.flow.y
        maxVolumetricOpening = Math.max(maxVolumetricOpening, material.flow.y)
        cavitationUpdates += material.flow.z
        speedCaps += material.history.z
        affineCaps += material.history.w
        deformationRejections += material.diagnostics.x
        domainContacts += material.diagnostics.y
        zeroShearUpdates += material.diagnostics.z
        relaxationUpdates += material.diagnostics.w
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
        plasticStrain,
        maxPlasticStrain,
        volumetricOpening,
        maxVolumetricOpening,
        cavitationUpdates,
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
        relaxationUpdates,
        particleMaterial: lastMaterial.mode,
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
