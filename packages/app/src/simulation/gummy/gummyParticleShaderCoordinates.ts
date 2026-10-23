/** Exact grid addressing and time-dependent rigid collider coordinates for MPM kernels. */
import { d, std, tgpu } from 'typegpu'
import { gummyParticleLayout } from './gummyParticleLayouts'
import { gummyColliderSurfaceVelocity } from './gummyRookCollider'

export const currentColliderPosition = (elapsed: number) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  return std.add(
    params.colliderPosition.xyz,
    std.mul(params.colliderVelocity.xyz, elapsed),
  )
}

export const currentColliderAngle = (elapsed: number) => {
  'use gpu'
  const rotation = gummyParticleLayout.$.params.colliderRotation
  return rotation.x + rotation.y * elapsed
}

export const currentColliderVelocity = (point: d.v3f, elapsed: number) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  return gummyColliderSurfaceVelocity(
    params.colliderVelocity.xyz,
    std.sub(point, currentColliderPosition(elapsed)),
    params.colliderRotation.y,
  )
}

export const gridIndex = (p: d.v3i) => {
  'use gpu'
  const n = gummyParticleLayout.$.params.counts.y
  return d.u32(p.x) + n * (d.u32(p.y) + n * d.u32(p.z))
}

// TypeGPU division promotes to f32; truncating a rounded quotient can select the preceding row.
export const gummyParticleGridCoordinates = tgpu.fn(
  [d.u32, d.u32],
  d.vec3i,
)(`
  (id: u32, n: u32) -> vec3i {
    return vec3i(i32(id % n), i32((id / n) % n), i32(id / (n * n)));
  }
`)
