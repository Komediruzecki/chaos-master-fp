/** Transaction-owned GPU storage and pipelines for one particle simulation. */
import { d } from 'typegpu'
import { createGummyChessCollider, gummyChessColliderContact, gummyChessColliderMayContact, } from './gummyChessCollider'
import { gummyParticleAdvanceTime, gummyParticleCaptureGrip, gummyParticleG2P, GummyParticleGrid, gummyParticleGridUpdate, gummyParticleLayout, gummyParticleP2G, GummyParticleParameters, GummyParticleState, } from './gummyParticleShaders'
import { gummyColliderContactSlot, gummyColliderMayContactSlot, } from './gummyRookCollider'
import type { TgpuRoot } from 'typegpu'
import type { GummyParticleOptions } from './gummyParticleContracts'
import type { prepareGummyParticleSolver } from './gummyParticlePreparation'

export function createGummyParticleResources(
  root: TgpuRoot,
  device: GPUDevice,
  options: GummyParticleOptions,
  prepared: ReturnType<typeof prepareGummyParticleSolver>,
  own: <T extends { destroy(): void }>(resource: T) => T,
) {
  const { particleCount, gridCount, initialPositions, initialStates } = prepared
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
      .createBuffer(d.arrayOf(GummyParticleState, particleCount), (mapped) => {
        mapped.write(initialStates.buffer)
      })
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
            options.authoredPawn,
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
  return {
    positions,
    rest,
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
  }
}
