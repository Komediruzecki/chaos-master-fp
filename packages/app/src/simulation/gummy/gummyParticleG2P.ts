/** Grid-to-particle transport, constitutive history, and bounded-domain contact. */
import { d, std, tgpu } from 'typegpu'
import { updateGummyParticleMaterial } from './gummyParticleConstitutive'
import { gummyParticleLayout, GummyParticleState } from './gummyParticleLayouts'
import { gummyParticleIdentity, gummyParticleViscousSpeedLimit, gummyParticleWeights, } from './gummyParticleMath'
import { gridIndex } from './gummyParticleShaderCoordinates'
import { transportGummyParticle } from './gummyParticleTransport'

/** Grid velocities transport material; its deformation gradient and irreversible history follow it. */
export const gummyParticleG2P = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  if (gid.x >= params.counts.x) return
  const oldPosition = gummyParticleLayout.$.positions[gid.x]!.xyz
  const rest = gummyParticleLayout.$.rest[gid.x]!
  const previous = gummyParticleLayout.$.states[gid.x]!
  const transfer = d.vec4f(previous.transfer)
  let peakSpeed = d.f32(gummyParticleLayout.$.velocities[gid.x]!.w)
  const dx = params.geometry.y
  const xp = std.div(std.sub(oldPosition, params.origin.xyz), dx)
  const base = d.vec3i(std.floor(std.sub(xp, d.vec3f(0.5))))
  const fraction = std.sub(xp, d.vec3f(base))
  const wx = gummyParticleWeights(fraction.x)
  const wy = gummyParticleWeights(fraction.y)
  const wz = gummyParticleWeights(fraction.z)
  let velocity = d.vec3f(0)
  let affine = d.mat3x3f()
  let guarded = false
  const nodalLimit = gummyParticleViscousSpeedLimit(
    params.geometry.x,
    dx,
    params.rheology.w,
    params.limits.w,
  )
  for (const z of std.range(3))
    for (const y of std.range(3))
      for (const x of std.range(3)) {
        const offset = d.vec3i(x, y, z)
        const id = gridIndex(std.add(base, offset))
        const weight = wx[x]! * wy[y]! * wz[z]!
        const grid = gummyParticleLayout.$.gridVelocities[id]!
        const weightedVelocity = std.mul(grid.xyz, weight)
        const distance = std.mul(std.sub(d.vec3f(offset), fraction), dx)
        velocity = std.add(velocity, weightedVelocity)
        affine = std.add(
          affine,
          d.mat3x3f(
            std.mul(weightedVelocity, distance.x),
            std.mul(weightedVelocity, distance.y),
            std.mul(weightedVelocity, distance.z),
          ),
        )
        if (weight > 0.001) transfer.x = std.max(transfer.x, grid.w)
        transfer.y +=
          params.geometry.z * weight * std.max(0, grid.w - nodalLimit)
        if (grid.w > nodalLimit && weight > 0.001) guarded = true
      }
  affine = std.mul(affine, 4 / (dx * dx))
  const material = updateGummyParticleMaterial(gid.x, affine)
  affine = d.mat3x3f(
    material.affine.columns[0].x,
    material.affine.columns[0].y,
    material.affine.columns[0].z,
    material.affine.columns[1].x,
    material.affine.columns[1].y,
    material.affine.columns[1].z,
    material.affine.columns[2].x,
    material.affine.columns[2].y,
    material.affine.columns[2].z,
  )
  let deformation = d.mat3x3f(
    material.deformation.columns[0].x,
    material.deformation.columns[0].y,
    material.deformation.columns[0].z,
    material.deformation.columns[1].x,
    material.deformation.columns[1].y,
    material.deformation.columns[1].z,
    material.deformation.columns[2].x,
    material.deformation.columns[2].y,
    material.deformation.columns[2].z,
  )
  const history = d.vec4f(material.history)
  const diagnostics = d.vec4f(material.diagnostics)
  const flow = d.vec4f(material.flow)
  if (guarded) transfer.w += 1
  const speed = std.length(velocity)
  peakSpeed = std.max(peakSpeed, speed)
  if (speed > params.limits.x) {
    velocity = std.mul(velocity, params.limits.x / speed)
    guarded = true
    transfer.z += 1
  }
  const transported = transportGummyParticle(oldPosition, velocity, rest)
  let position = d.vec3f(transported.position)
  velocity = d.vec3f(transported.velocity)
  diagnostics.y += transported.domainContact
  if (rest.w <= 0) {
    position = d.vec3f(rest.xyz)
    velocity = d.vec3f(0)
    affine = d.mat3x3f()
    deformation = gummyParticleIdentity()
  }
  if (guarded) history.z += 1
  gummyParticleLayout.$.positions[gid.x] = d.vec4f(position, rest.w)
  gummyParticleLayout.$.velocities[gid.x] = d.vec4f(velocity, peakSpeed)
  gummyParticleLayout.$.states[gid.x] = GummyParticleState({
    deformation,
    affine,
    history,
    diagnostics,
    transfer,
    links: d.vec4u(0),
    flow,
    contact: d.vec4f(0),
  })
})
