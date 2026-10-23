/** Particle capture and stress preparation entrypoints for MLS-MPM. */
import { d, std, tgpu } from 'typegpu'
import { gummyParticleLayout } from './gummyParticleLayouts'
import { gummyParticleDeterminant, gummyParticleGripOffset, gummyParticleStress, gummyParticleViscousStress, gummyParticleWarmStress, } from './gummyParticleMath'
import { currentColliderAngle, currentColliderPosition, gridIndex, } from './gummyParticleShaderCoordinates'
import { gummyColliderContactSlot, gummyColliderMayContactSlot, gummyColliderRotateY, } from './gummyRookCollider'

export * from './gummyParticleLayouts'
export { gummyParticleGridCoordinates } from './gummyParticleShaderCoordinates'
export { gummyParticleGridUpdate } from './gummyParticleGridUpdate'
export { gummyParticleG2P } from './gummyParticleG2P'

/** Separate dispatch keeps collider motion ordered without races inside particle workgroups. */
export const gummyParticleAdvanceTime = tgpu.computeFn({ workgroupSize: [1] })(
  () => {
    'use gpu'
    gummyParticleLayout.$.clock[0] =
      gummyParticleLayout.$.clock[0]! + gummyParticleLayout.$.params.geometry.x
  },
)

export const gummyParticleCaptureGrip = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyParticleLayout.$.params.counts.x) return
  const params = gummyParticleLayout.$.params
  const rest = gummyParticleLayout.$.rest[gid.x]!
  const selectedPosition = std.select(
    rest.xyz,
    gummyParticleLayout.$.positions[gid.x]!.xyz,
    params.interaction.x > 0,
  )
  const distance = std.length(std.sub(selectedPosition, params.gripCenter.xyz))
  let weight = d.f32(0)
  if (rest.w > 0 && params.gripTarget.w > 0)
    weight =
      1 -
      std.smoothstep(params.gripCenter.w * 0.65, params.gripCenter.w, distance)
  if (params.gripMotion.w > 0) {
    weight = 0
    if (rest.w > 0 && rest.y <= params.gripCenter.y + params.gripMotion.w)
      weight =
        1 -
        std.smoothstep(
          params.gripCenter.w * 0.75,
          params.gripCenter.w,
          std.length(std.sub(rest.xz, params.gripCenter.xz)),
        )
  }
  gummyParticleLayout.$.grip[gid.x] = d.vec4f(
    gummyParticleGripOffset(
      gummyParticleLayout.$.positions[gid.x]!.xyz,
      params.gripCenter.xyz,
      params.gripTarget.xyz,
      params.interaction.x,
    ),
    weight,
  )
})

// TypeGPU 0.12 omits std.atomicExchange; integer atomics only allocate linked-list entries.
const exchangeHead = tgpu
  .fn([
      d.u32,
      d.u32,
    ], d.u32)(`(bucket: u32, value: u32) -> u32 { return atomicExchange(&layout.$.grid[bucket].head, value); }`)
  .$uses({ layout: gummyParticleLayout })

/** Prepare stress/APIC momentum once, then bin by quadratic support base for exact 27-node gather. */
export const gummyParticleP2G = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyParticleLayout.$.params.counts.x) return
  const params = gummyParticleLayout.$.params
  const position = gummyParticleLayout.$.positions[gid.x]!.xyz
  let velocity = d.vec3f(gummyParticleLayout.$.velocities[gid.x]!.xyz)
  let peakSpeed = d.f32(gummyParticleLayout.$.velocities[gid.x]!.w)
  const state = gummyParticleLayout.$.states[gid.x]!
  const pinned = gummyParticleLayout.$.rest[gid.x]!.w <= 0
  const grip = gummyParticleLayout.$.grip[gid.x]!
  state.contact = d.vec4f(0, 0, 0, 1000000)
  if (params.colliderPosition.w > 0) {
    const angle = currentColliderAngle(gummyParticleLayout.$.clock[0]!)
    const local = gummyColliderRotateY(
      std.sub(
        position,
        currentColliderPosition(gummyParticleLayout.$.clock[0]!),
      ),
      -angle,
    )
    if (gummyColliderMayContactSlot.$(local, params.geometry.w)) {
      const contact = gummyColliderContactSlot.$(local)
      state.contact = d.vec4f(
        gummyColliderRotateY(contact.xyz, angle),
        contact.w - params.geometry.w,
      )
    }
  }
  // External grip impulses pass through the grid so F sees the same motion as particles.
  if (params.gripTarget.w > 0 && grip.w > 0 && !pinned) {
    const goal = std.add(params.gripTarget.xyz, grip.xyz)
    const acceleration = std.sub(
      std.mul(std.sub(goal, position), params.interaction.y),
      std.mul(std.sub(velocity, params.gripMotion.xyz), params.interaction.z),
    )
    velocity = std.add(
      velocity,
      std.mul(acceleration, params.geometry.x * grip.w),
    )
    const speed = std.length(velocity)
    peakSpeed = std.max(peakSpeed, speed)
    if (speed > params.limits.x) {
      velocity = std.mul(velocity, params.limits.x / speed)
      state.history.z += 1
      state.transfer.z += 1
    }
  }
  const dx = params.geometry.y
  const xp = std.div(std.sub(position, params.origin.xyz), dx)
  const base = d.vec3i(std.floor(std.sub(xp, d.vec3f(0.5))))
  let stress = d.mat3x3f()
  if (params.rheology.x > 0) {
    stress = gummyParticleWarmStress(
      state.deformation,
      params.material.x,
      params.material.y,
      state.history.x,
    )
    const viscosity = params.rheology.w * (0.35 + 0.65 * state.history.x)
    stress = std.add(
      stress,
      gummyParticleViscousStress(
        state.affine,
        gummyParticleDeterminant(state.deformation),
        viscosity,
      ),
    )
  } else {
    stress = gummyParticleStress(
      state.deformation,
      params.material.x,
      params.material.y,
      state.history.x,
    )
  }
  // Scratch until G2P reconstructs C. No other invocation reads this particle during preparation.
  state.affine = std.sub(
    std.mul(state.affine, params.geometry.z),
    std.mul(stress, (4 * params.geometry.x * params.geometry.z) / (dx * dx)),
  )
  gummyParticleLayout.$.velocities[gid.x] = d.vec4f(velocity, peakSpeed)
  state.links.x = exchangeHead(gridIndex(base), gid.x + 1)
  for (const z of std.range(3))
    for (const y of std.range(3))
      for (const x of std.range(3)) {
        const id = gridIndex(std.add(base, d.vec3i(x, y, z)))
        std.atomicStore(gummyParticleLayout.$.grid[id]!.occupied, 1)
      }
})

/** Gather each node's supported particles in f32; mass and momentum share identical weights. */
