/** CPU diagnostic reduction of an explicit particle solver readback. */
import { gummyParticleWarmVolumetricEnergy } from './gummyParticleMath'
import type { d } from 'typegpu'
import type { GummyParticleState } from './gummyParticleLayouts'
import type { gummyParticleMaterial, prepareGummyParticles, } from './gummyParticleMath'

export function summarizeGummyParticles(
  p: readonly d.v4f[],
  v: readonly d.v4f[],
  state: readonly d.Infer<typeof GummyParticleState>[],
  captured: readonly d.v4f[],
  geometry: ReturnType<typeof prepareGummyParticles>,
  lastMaterial: ReturnType<typeof gummyParticleMaterial>,
  simulationTime: number,
  gripKey: string,
) {
  const { particleCount } = geometry
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
