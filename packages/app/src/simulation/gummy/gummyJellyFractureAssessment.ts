/** Tensile and plastic-work damage assessment, independent of topology commit and rollback. */
import { areaNormal, gummyJellyFractureParameters, volume, } from './gummyJellyFractureGeometry'
import { evaluateGummyTensileStrain, gummyMixedTensileOpening, gummyNormalTensileOpening, } from './gummyJellyFractureStrain'
import type { Facet, prepareJellyFractureGeometry, } from './gummyJellyFractureGeometry'
import type { GummyMesh } from './gummyMeshContracts'

const MAX_FACES_PER_EVENT = 64
export type GummyJellyFractureAssessment = {
  tearing: boolean
  softness: number
  fragility?: number
  response?: 'soft' | 'crumble'
  plasticStrain?: Float32Array
  plasticGradients?: Float32Array
  plasticIncrement?: Float32Array
}

function validateDuctileField(
  values: Float32Array | undefined,
  length: number,
  nonnegative: boolean,
  message: string,
) {
  if (
    values &&
    (values.length !== length ||
      values.some(
        (value) => !Number.isFinite(value) || (nonnegative && value < 0),
      ))
  )
    throw new Error(message)
}

function canAssessDuctile(
  options: GummyJellyFractureAssessment,
  tetCount: number,
  soft: boolean,
  elapsedSeconds: number,
) {
  if (soft) {
    validateDuctileField(
      options.plasticStrain,
      tetCount,
      true,
      'Ductile fracture requires finite plastic strain per tetrahedron',
    )
    validateDuctileField(
      options.plasticGradients,
      tetCount * 9,
      false,
      'Ductile fracture requires a finite elastic frame per tetrahedron',
    )
    validateDuctileField(
      options.plasticIncrement,
      tetCount,
      true,
      'Ductile fracture requires finite positive plastic increments per tetrahedron',
    )
  }
  if (
    soft &&
    (!options.plasticStrain ||
      !options.plasticGradients ||
      !options.plasticIncrement)
  )
    return false
  if (!soft && (!options.tearing || elapsedSeconds === 0)) return false
  return true
}

function faceOpening(
  face: Facet,
  positions: Float32Array,
  mesh: GummyMesh,
  geometry: ReturnType<typeof prepareJellyFractureGeometry>,
  tension: Float64Array,
  soft: boolean,
) {
  const { ratios, normalScratch, restVolumes, averageScratch } = geometry
  // Inverted or strongly compressed elements cannot initiate tensile cracks.
  if (ratios[face.tetA]! < 0.35 || ratios[face.tetB]! < 0.35) return undefined
  const normal = areaNormal(positions, mesh.tetrahedra, face.a, normalScratch)
  const length = Math.hypot(normal[0], normal[1], normal[2])
  if (length < 1e-12) return undefined
  const volumeA = restVolumes[face.tetA]!,
    volumeB = restVolumes[face.tetB]!
  for (let axis = 0; axis < 6; axis++)
    averageScratch[axis] =
      (volumeA * tension[face.tetA * 6 + axis]! +
        volumeB * tension[face.tetB * 6 + axis]!) /
      (volumeA + volumeB)
  return soft
    ? gummyNormalTensileOpening(averageScratch, normal)
    : gummyMixedTensileOpening(averageScratch, normal)
}

function ductileDose(
  face: Facet,
  id: number,
  opening: number,
  volumeA: number,
  volumeB: number,
  options: GummyJellyFractureAssessment,
  elapsedSeconds: number,
  peakElasticOpening: Float64Array,
  plasticLimit: number,
  workCapacity: number,
) {
  const previousPeak = peakElasticOpening[id]!
  peakElasticOpening[id] = Math.max(previousPeak, opening)
  // Disabled or paused loading is observed but never banked for later tearing.
  if (!options.tearing || elapsedSeconds === 0) return undefined
  const plasticA = options.plasticStrain![face.tetA]!,
    plasticB = options.plasticStrain![face.tetB]!
  const plastic =
    (volumeA * plasticA + volumeB * plasticB) / (volumeA + volumeB)
  if (plastic <= plasticLimit) return undefined
  const increment =
    (volumeA * options.plasticIncrement![face.tetA]! +
      volumeB * options.plasticIncrement![face.tetB]!) /
    (volumeA + volumeB)
  // Spend new plastic work, never elapsed time at an old permanently yielded
  // shape. Count only the part crossing above the initial ductility allowance.
  const workIncrement = Math.min(increment, plastic - plasticLimit)
  // The finite plastic limit enters a second elastic regime. Only a NEW
  // historical maximum opening can spend its loading budget, not held stress.
  const saturated =
    (volumeA * (plasticA >= 1.2 - 1e-6 ? 1 : 0) +
      volumeB * (plasticB >= 1.2 - 1e-6 ? 1 : 0)) /
    (volumeA + volumeB)
  const tensileExcess = Math.max(0, opening - 1.015)
  const saturatedWork =
    0.5 *
    saturated *
    Math.max(0, tensileExcess ** 2 - Math.max(0, previousPeak - 1.015) ** 2)
  // Preserve the same local graphics-material law at every resolution.
  // This dimensionless work proxy is not calibrated fracture energy;
  // whole-body crack patterns and dissipation can still depend on the mesh.
  return (workIncrement * tensileExcess + saturatedWork) / workCapacity
}

function brittleDose(
  id: number,
  opening: number,
  elapsedSeconds: number,
  material: ReturnType<typeof gummyJellyFractureParameters>,
  neighbours: Uint32Array[],
  failed: Uint8Array,
) {
  let threshold = material.opening,
    rate = material.rate
  if (material.propagationOpening < threshold)
    for (const neighbour of neighbours[id]!)
      if (failed[neighbour]) {
        threshold = material.propagationOpening
        rate = material.propagationRate
        break
      }
  return elapsedSeconds * rate * Math.max(0, opening - threshold)
}
export function assessJellyFractureDamage(
  geometry: ReturnType<typeof prepareJellyFractureGeometry>,
  mesh: GummyMesh,
  positions: Float32Array,
  elapsedSeconds: number,
  options: GummyJellyFractureAssessment,
  failed: Uint8Array,
  history: Float64Array,
  peakElasticOpening: Float64Array,
  maxOpening: number,
) {
  const {
    tetCount,
    strainGeometry,
    strainWorkspace,
    ratios,
    restVolumes,
    interior,
    neighbours,
  } = geometry
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw new Error('Invalid runtime fracture elapsed time')
  if (
    positions.length !== mesh.positions.length ||
    positions.some((value) => !Number.isFinite(value))
  )
    throw new Error('Runtime fracture snapshot must match its live mesh')
  const material = gummyJellyFractureParameters(options.fragility)
  const soft = options.response === 'soft'
  const fragility = Math.max(0, Math.min(1, options.fragility ?? 0))
  const plasticLimit = 0.04 + 0.15 * (1 - fragility)
  const workCapacity = 0.006 + 0.025 * (1 - fragility) ** 2
  if (!canAssessDuctile(options, tetCount, soft, elapsedSeconds))
    return undefined
  const tension = evaluateGummyTensileStrain(
    positions,
    mesh.tetrahedra,
    soft && options.plasticGradients
      ? { ...strainGeometry, gradients: options.plasticGradients }
      : strainGeometry,
    strainWorkspace,
  )
  for (let tet = 0; tet < tetCount; tet++)
    ratios[tet] =
      volume(positions, mesh.tetrahedra, tet * 4) / restVolumes[tet]!
  const pending: { id: number; opening: number }[] = []
  for (let id = 0; id < interior.length; id++) {
    if (failed[id]) continue
    const face = interior[id]!
    const opening = faceOpening(face, positions, mesh, geometry, tension, soft)
    if (opening === undefined) continue
    maxOpening = Math.max(maxOpening, opening)
    const dose = soft
      ? ductileDose(
          face,
          id,
          opening,
          restVolumes[face.tetA]!,
          restVolumes[face.tetB]!,
          options,
          elapsedSeconds,
          peakElasticOpening,
          plasticLimit,
          workCapacity,
        )
      : brittleDose(id, opening, elapsedSeconds, material, neighbours, failed)
    if (dose === undefined) continue
    // Strain history is independent of UI softness; deformation already reflects that material choice.
    history[id] = Math.min(1, history[id]! + dose)
    if (history[id]! >= 1) pending.push({ id, opening })
  }
  pending.sort((a, b) => b.opening - a.opening || a.id - b.id)
  // Commit together: this event can weaken neighbours only on the next assessment.
  for (const face of pending.slice(0, MAX_FACES_PER_EVENT)) failed[face.id] = 1
  return { maxOpening, failedChanged: pending.length > 0 }
}
