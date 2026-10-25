/** Kinematic collider, floor, press, and domain constraints for transported particles. */
import { d, std } from 'typegpu'
import { gummyParticleLayout } from './gummyParticleLayouts'
import { currentColliderAngle, currentColliderPosition, currentColliderVelocity, } from './gummyParticleShaderCoordinates'
import { gummyColliderContactSlot, gummyColliderMayContactSlot, gummyColliderRotateY, gummyRookContactCorrection, gummyRookContactVelocity, } from './gummyRookCollider'

const TransportResult = d.struct({
  position: d.vec3f,
  velocity: d.vec3f,
  domainContact: d.f32,
})
export const transportGummyParticle = (
  oldPosition: d.v3f,
  incomingVelocity: d.v3f,
  rest: d.v4f,
) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  const dx = params.geometry.y
  let velocity = d.vec3f(incomingVelocity)
  let domainContact = d.f32(0)
  let position = std.add(oldPosition, std.mul(velocity, params.geometry.x))
  if (params.colliderPosition.w > 0 && rest.w > 0) {
    const elapsed = gummyParticleLayout.$.clock[0]! + params.geometry.x
    const angle = currentColliderAngle(elapsed)
    const local = gummyColliderRotateY(
      std.sub(position, currentColliderPosition(elapsed)),
      -angle,
    )
    if (gummyColliderMayContactSlot.$(local, params.geometry.w)) {
      const localContact = gummyColliderContactSlot.$(local)
      const contact = d.vec4f(
        gummyColliderRotateY(localContact.xyz, angle),
        localContact.w,
      )
      position = std.add(
        position,
        gummyRookContactCorrection(
          contact,
          params.geometry.w,
          params.geometry.w * 0.5,
        ),
      )
      velocity = gummyRookContactVelocity(
        velocity,
        currentColliderVelocity(position, elapsed),
        contact.xyz,
        contact.w - params.geometry.w,
        params.colliderVelocity.w,
      )
    }
  }
  if (position.y < params.geometry.w) {
    position.y = params.geometry.w
    velocity.y = std.max(0, velocity.y)
  }
  if (
    params.press.z > 0 &&
    std.abs(position.x) < params.press.y &&
    std.abs(position.z) < params.press.y &&
    position.y > params.press.x - params.geometry.w
  ) {
    position.y = params.press.x - params.geometry.w
    velocity.y = std.min(velocity.y, params.press.w)
  }
  const low = std.add(params.origin.xyz, d.vec3f(dx * 0.51))
  const high = std.add(
    params.origin.xyz,
    d.vec3f(dx * (d.f32(params.counts.y) - 1.51)),
  )
  if (
    position.x < low.x ||
    position.y < low.y ||
    position.z < low.z ||
    position.x > high.x ||
    position.y > high.y ||
    position.z > high.z
  ) {
    position = std.clamp(position, low, high)
    velocity = d.vec3f(0)
    domainContact = 1
  }
  return TransportResult({ position, velocity, domainContact })
}
