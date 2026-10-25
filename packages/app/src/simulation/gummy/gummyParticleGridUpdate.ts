/** Floating-point particle gather and constrained grid momentum update. */
import { d, std, tgpu } from 'typegpu'
import { gummyParticleLayout } from './gummyParticleLayouts'
import { gummyParticleViscousSpeedLimit, gummyParticleWeights, } from './gummyParticleMath'
import { currentColliderVelocity, gridIndex, gummyParticleGridCoordinates, } from './gummyParticleShaderCoordinates'
import { gummyRookContactVelocity } from './gummyRookCollider'

const GridGather = d.struct({
  mass: d.f32,
  momentum: d.vec3f,
  pinned: d.u32,
  contactNormal: d.vec3f,
  contactMass: d.f32,
})
const gatherGridMomentum = (index: d.v3i, node: number) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  let mass = d.f32(0)
  let momentum = d.vec3f(0)
  let pinned = false
  let contactNormal = d.vec3f(0)
  let contactMass = d.f32(0)
  if (std.atomicLoad(gummyParticleLayout.$.grid[node]!.occupied) > 0) {
    for (const z of std.range(3))
      for (const y of std.range(3))
        for (const x of std.range(3)) {
          const offset = d.vec3i(x, y, z)
          const base = std.sub(index, offset)
          if (base.x < 0 || base.y < 0 || base.z < 0) continue
          let link = std.atomicLoad(
            gummyParticleLayout.$.grid[gridIndex(base)]!.head,
          )
          while (link > 0) {
            const id = link - 1
            const state = gummyParticleLayout.$.states[id]!
            const xp = std.div(
              std.sub(
                gummyParticleLayout.$.positions[id]!.xyz,
                params.origin.xyz,
              ),
              params.geometry.y,
            )
            const fraction = std.sub(xp, d.vec3f(base))
            const wx = gummyParticleWeights(fraction.x)
            const wy = gummyParticleWeights(fraction.y)
            const wz = gummyParticleWeights(fraction.z)
            const weight = wx[x]! * wy[y]! * wz[z]!
            const weightedMass = weight * params.geometry.z
            const distance = std.mul(
              std.sub(d.vec3f(offset), fraction),
              params.geometry.y,
            )
            mass += weightedMass
            if (
              (params.colliderPosition.w > 0 || params.counts.w > 0) &&
              state.contact.w <= 0
            ) {
              contactNormal = std.add(
                contactNormal,
                std.mul(state.contact.xyz, weightedMass),
              )
              contactMass += weightedMass
            }
            momentum = std.add(
              momentum,
              std.mul(
                std.add(
                  std.mul(
                    gummyParticleLayout.$.velocities[id]!.xyz,
                    params.geometry.z,
                  ),
                  std.mul(state.affine, distance),
                ),
                weight,
              ),
            )
            if (weightedMass > 0 && gummyParticleLayout.$.rest[id]!.w <= 0)
              pinned = true
            link = state.links.x
          }
        }
  }
  return GridGather({
    mass,
    momentum,
    pinned: std.select(d.u32(0), d.u32(1), pinned),
    contactNormal,
    contactMass,
  })
}

export const gummyParticleGridUpdate = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  if (gid.x >= params.counts.z) return
  const n = params.counts.y
  const index = gummyParticleGridCoordinates(gid.x, n)
  const gathered = gatherGridMomentum(index, gid.x)
  const mass = gathered.mass
  const momentum = gathered.momentum
  const contactNormal = gathered.contactNormal
  const contactMass = gathered.contactMass
  const pinned = gathered.pinned > 0
  let velocity = d.vec3f(0)
  let rawSpeed = d.f32(0)
  const nodalLimit = gummyParticleViscousSpeedLimit(
    params.geometry.x,
    params.geometry.y,
    params.rheology.w,
    params.limits.w,
  )
  if (mass > 0) {
    velocity = std.div(momentum, mass)
    velocity.y -= params.limits.w * params.geometry.x
    velocity = std.mul(
      velocity,
      std.exp(-params.material.z * params.geometry.x),
    )
    const point = std.add(
      params.origin.xyz,
      std.mul(d.vec3f(index), params.geometry.y),
    )
    if (point.y < params.geometry.w && velocity.y < 0) {
      velocity.y = 0
      let friction = d.f32(0.8)
      if (params.rheology.x > 0)
        friction = std.exp(-params.interaction.w * params.geometry.x)
      velocity.x *= friction
      velocity.z *= friction
    }
    if (
      params.press.z > 0 &&
      std.abs(point.x) < params.press.y &&
      std.abs(point.z) < params.press.y &&
      point.y > params.press.x - params.geometry.w
    )
      velocity.y = std.min(velocity.y, params.press.w)
    // Material proximity gates contact, so overlapping grid supports alone cannot push the victim.
    if (
      params.colliderPosition.w > 0 &&
      contactMass > 0 &&
      std.length(contactNormal) > 0.000001
    )
      velocity = gummyRookContactVelocity(
        velocity,
        currentColliderVelocity(point, gummyParticleLayout.$.clock[0]!),
        std.normalize(contactNormal),
        0,
        params.colliderVelocity.w,
      )
    // Apply Dirichlet data last, on the full finite support of actual fixed material.
    if (pinned) velocity = d.vec3f(0)
    rawSpeed = std.length(velocity)
    if (rawSpeed > nodalLimit)
      velocity = std.mul(velocity, nodalLimit / rawSpeed)
  }
  gummyParticleLayout.$.grid[gid.x]!.mass = mass
  gummyParticleLayout.$.grid[gid.x]!.pinned = std.select(
    d.u32(0),
    d.u32(1),
    pinned,
  )
  gummyParticleLayout.$.grid[gid.x]!.contact = d.vec4f(
    contactNormal,
    contactMass,
  )
  gummyParticleLayout.$.gridVelocities[gid.x] = d.vec4f(velocity, rawSpeed)
})
