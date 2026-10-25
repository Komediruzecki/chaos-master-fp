/** Constitutive history and stability guards for the particle G2P transfer. */
import { d, std } from 'typegpu'
import { gummyParticleLayout } from './gummyParticleLayouts'
import { GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MIN_J, gummyParticleCavitatedVolumeState, gummyParticleCavitationReturn, gummyParticleDamage, gummyParticleDamageStretch, gummyParticleDeterminant, gummyParticleFlowStep, gummyParticleIdentity, gummyParticleStretch, gummyParticleVolumeState, gummyParticleWarmDamage, } from './gummyParticleMath'

const MaterialUpdate = d.struct({
  affine: d.mat3x3f,
  deformation: d.mat3x3f,
  history: d.vec4f,
  diagnostics: d.vec4f,
  flow: d.vec4f,
})
export const updateGummyParticleMaterial = (
  id: number,
  incomingAffine: d.m3x3f,
) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  const previous = gummyParticleLayout.$.states[id]!
  const rest = gummyParticleLayout.$.rest[id]!
  const history = d.vec4f(previous.history)
  const diagnostics = d.vec4f(previous.diagnostics)
  const flow = d.vec4f(previous.flow)
  let affine = d.mat3x3f(
    incomingAffine.columns[0].x,
    incomingAffine.columns[0].y,
    incomingAffine.columns[0].z,
    incomingAffine.columns[1].x,
    incomingAffine.columns[1].y,
    incomingAffine.columns[1].z,
    incomingAffine.columns[2].x,
    incomingAffine.columns[2].y,
    incomingAffine.columns[2].z,
  )
  const affineNorm = std.sqrt(
    std.dot(affine.columns[0], affine.columns[0]) +
      std.dot(affine.columns[1], affine.columns[1]) +
      std.dot(affine.columns[2], affine.columns[2]),
  )
  if (affineNorm > params.limits.y) {
    affine = std.mul(affine, params.limits.y / affineNorm)
    history.w += 1
  }
  let deformation = std.mul(
    std.add(gummyParticleIdentity(), std.mul(affine, params.geometry.x)),
    previous.deformation,
  )
  let jacobian = gummyParticleDeterminant(deformation)
  if (params.rheology.x > 0 && jacobian > 0) {
    const returned = gummyParticleCavitationReturn(
      deformation,
      previous.history.x,
    )
    deformation = d.mat3x3f(
      returned.column0,
      returned.column1,
      returned.column2,
    )
    flow.y += returned.opening
    if (returned.opening > 0) flow.z += 1
    jacobian = gummyParticleDeterminant(deformation)
  }
  if (previous.history.x >= 1 && jacobian > 0) {
    if (params.rheology.x > 0) {
      deformation = gummyParticleCavitatedVolumeState(deformation)
      // Test the returned elastic state. Large void dilation is no longer a
      // positive-pressure state or an elastic-gradient rejection in this phase.
      jacobian = gummyParticleDeterminant(deformation)
    } else {
      deformation = gummyParticleVolumeState(deformation)
    }
    diagnostics.z += 1
  }
  const normSquared =
    std.dot(deformation.columns[0], deformation.columns[0]) +
    std.dot(deformation.columns[1], deformation.columns[1]) +
    std.dot(deformation.columns[2], deformation.columns[2])
  if (
    jacobian < GUMMY_PARTICLE_MIN_J ||
    jacobian > GUMMY_PARTICLE_MAX_J ||
    normSquared > params.limits.z * params.limits.z
  ) {
    // iOS WebKit can leave storage matrix columns packed. Scalar loads avoid
    // passing PackedVec3 values to Metal's matrix constructor (WebKit bug 320443).
    deformation = d.mat3x3f(
      previous.deformation.columns[0].x,
      previous.deformation.columns[0].y,
      previous.deformation.columns[0].z,
      previous.deformation.columns[1].x,
      previous.deformation.columns[1].y,
      previous.deformation.columns[1].z,
      previous.deformation.columns[2].x,
      previous.deformation.columns[2].y,
      previous.deformation.columns[2].z,
    )
    flow.y = previous.flow.y
    flow.z = previous.flow.z
    diagnostics.x += 1
  }
  const stretch = gummyParticleStretch(deformation)
  history.y = std.max(history.y, stretch)
  if (params.rheology.x > 0) {
    if (stretch > params.fracture.x && rest.w > 0) {
      // Yield gradually, retaining bulk pressure and objectivity throughout a thinning neck.
      const activation =
        (stretch - params.fracture.x) / std.max(0.001, stretch - 1)
      const yielded = gummyParticleFlowStep(
        deformation,
        params.geometry.x,
        params.rheology.y,
        activation,
      )
      deformation = d.mat3x3f(yielded.column0, yielded.column1, yielded.column2)
      flow.x += yielded.plasticStrain
      diagnostics.w += 1
    }
    if (params.material.w > 0) {
      // Yield must not erase the history that drives rupture. Equivalent plastic
      // strain equals true axial strain for isochoric uniaxial necking.
      const damageStretch = gummyParticleDamageStretch(
        history.y,
        stretch,
        flow.x + flow.y / 3,
      )
      history.x = gummyParticleWarmDamage(
        history.x,
        damageStretch,
        params.geometry.x,
        params.rheology.z,
        params.fracture.y,
        params.fracture.z,
      )
    }
  } else if (params.material.w > 0) {
    history.x = gummyParticleDamage(history.x, history.y)
  }
  return MaterialUpdate({ affine, deformation, history, diagnostics, flow })
}
