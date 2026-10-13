/** Inspection-only finite tube material from a placed, certified affine native IFS. */
import { walkGroupProbability } from '@chaos-master/core'
import { toAffine3D } from '@/flame/affine3D'
import { validateChessCandidateSolid } from '@/flame/chess/chessCandidateSolid'
import { candidateRenderFlame } from '@/flame/chess/chessCandidateSource'
import { samplePawnCloud } from '@/flame/chess/pawnCloud'
import { composeAffine } from '@/flame/clash/placement'
import { inspectCandidateMaterial } from './gummyAffineIfsDiagnostics'
import { bakePointDistanceGrid } from './gummyDistanceGrid'
import type { CandidateSolidReport } from './gummyAffineIfsDiagnostics'
import type { SolidBounds, SolidPoint } from './gummyDistanceGrid'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'
import type { Affine3 } from '@/flame/clash/placement'
import type { TransformFunction } from '@/flame/schema/flameSchema'

export type { CandidateSolidReport } from './gummyAffineIfsDiagnostics'
export type CandidateSolid = {
  restPositions: Float32Array
  bounds: SolidBounds
  spacing: number
  report: CandidateSolidReport
  geometryKey: string
  /** The only non-structured-clone value; worker callers omit this closure. */
  field: (point: SolidPoint) => number
}
export const AFFINE_IFS_VOLUME_SAMPLE_COUNT = 120_000
export const AFFINE_IFS_VOLUME_CELL = 0.0125
const MAX_PARTICLES = 80_000

function mapAffine(map: TransformFunction) {
  const pre = toAffine3D(map.preAffine),
    post = toAffine3D(map.postAffine)
  let weight = 0
  for (const variation of Object.values(map.variations))
    if (variation.visible && variation.weight !== 0) weight += variation.weight
  const scaled: Affine3 = {
    a: pre.a * weight,
    b: pre.b * weight,
    c: pre.c * weight,
    d: pre.d * weight,
    e: pre.e * weight,
    f: pre.f * weight,
    g: pre.g * weight,
    h: pre.h * weight,
    i: pre.i * weight,
    j: pre.j * weight,
    k: pre.k * weight,
    l: pre.l * weight,
  }
  return composeAffine(post, scaled)
}

/** Gram row sums certify a Euclidean contraction without pretending all affine maps qualify. */
function contractionBound(map: Affine3) {
  const columns = [
    [map.a, map.e, map.i],
    [map.b, map.f, map.j],
    [map.c, map.g, map.k],
  ]
  return Math.sqrt(
    Math.max(
      ...columns.map((column) =>
        columns.reduce(
          (sum, other) =>
            sum +
            Math.abs(
              column[0]! * other[0]! +
                column[1]! * other[1]! +
                column[2]! * other[2]!,
            ),
          0,
        ),
      ),
    ),
  )
}

function mapSupportError(map: TransformFunction) {
  const variations = Object.values(map.variations).filter(
    (variation) => variation.visible && variation.weight !== 0,
  )
  if (
    variations.length === 0 ||
    variations.some((variation) => variation.type !== 'linear3D')
  )
    return 'Finite material currently supports active linear3D variations only.'
  if (
    (map.preAffine && !('g' in map.preAffine)) ||
    (map.postAffine && !('g' in map.postAffine))
  )
    return 'Finite material requires native 3D affine matrices.'
  const affine = mapAffine(map)
  if (
    !Object.values(affine).every(Number.isFinite) ||
    contractionBound(affine) >= 1
  )
    return 'This adapter requires affine maps certified contractive in the source Euclidean metric.'
  return undefined
}

/** Unsupported snapshots remain valid artwork; this narrow CPU material adapter declines them. */
export function candidateSolidSupportError(
  candidate: ChessCandidate,
): string | undefined {
  if (candidate.version !== 2 || !candidate.solid)
    return 'Enable a version-2 finite-solid request first.'
  const source = candidate.source.flame
  if (source.renderSettings.dimensions !== 3)
    return 'Finite material requires a native 3D source.'
  if (source.renderSettings.pointInitMode !== 'pointInitUnitBall')
    return 'Finite material supports pointInitUnitBall only.'
  if (candidate.source.customVariations.length > 0)
    return 'Custom variations are not supported by this finite material adapter.'
  if ((source.layers?.length ?? 0) > 0)
    return 'Flame layers are not supported by this finite material adapter.'
  if (
    source.renderSettings.blendFlame !== undefined ||
    source.renderSettings.clash !== undefined
  )
    return 'Blended and Clash sources are not supported by this finite material adapter.'
  const maps = Object.values(source.transforms).filter(
    (map) => walkGroupProbability(map) > 0,
  )
  if (maps.length === 0)
    return 'Finite material requires visible positive-probability maps.'
  for (const map of maps) {
    const error = mapSupportError(map)
    if (error) return error
  }
  return undefined
}
export const candidateSolidError = candidateSolidSupportError

function geometryKey(candidate: ChessCandidate) {
  const flame = candidateRenderFlame(candidate)
  const maps = Object.entries(flame.transforms).map(([id, map]) => ({
    id,
    probability: map.probability,
    visible: map.visible,
    walkGroup: map.walkGroup,
    preAffine: map.preAffine,
    postAffine: map.postAffine,
    variations: Object.values(map.variations).map((variation) => ({
      type: variation.type,
      weight: variation.weight,
      visible: variation.visible,
    })),
  }))
  const text = JSON.stringify({
    maps,
    final: flame.finalTransform,
    solid: candidate.solid,
  })
  let hash = 2166136261
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `affine-ifs-volume-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function occupiedCells(
  field: (point: SolidPoint) => number,
  bounds: SolidBounds,
  spacing: number,
  pinHeight: number,
) {
  const min = bounds.min.map((value) => Math.floor(value / spacing))
  const max = bounds.max.map((value) => Math.ceil(value / spacing))
  min[1] = Math.max(0, min[1]!)
  const positions: number[] = []
  for (let z = min[2]!; z < max[2]!; z++)
    for (let y = min[1]; y < max[1]!; y++)
      for (let x = min[0]!; x < max[0]!; x++) {
        const point: [number, number, number] = [
          (x + 0.5) * spacing,
          (y + 0.5) * spacing,
          (z + 0.5) * spacing,
        ]
        if (field(point) > 0) continue
        positions.push(...point, Math.fround(point[1]) < pinHeight ? 0 : 1)
        if (positions.length / 4 > MAX_PARTICLES)
          throw new Error(
            'Finite material exceeds the 80,000 occupied-cell inspection budget.',
          )
      }
  return new Float32Array(positions)
}

/** Never fits cloud extrema or swaps a source by its name: placement and affines stay exact. */
export function buildCandidateSolid(
  candidate: ChessCandidate,
  options: { pinHeight?: number } = {},
): CandidateSolid {
  const error = candidateSolidSupportError(candidate)
  if (error) throw new Error(error)
  const solid = validateChessCandidateSolid(candidate.solid)
  const pinHeight = options.pinHeight ?? 0.22
  if (!Number.isFinite(pinHeight) || pinHeight < 0 || pinHeight > 0.6)
    throw new Error(
      'Finite material pin height must be between 0 and 0.6 metres.',
    )
  const start = globalThis.performance.now()
  const flame = candidateRenderFlame(candidate)
  const cloud = samplePawnCloud(flame, {
    count: AFFINE_IFS_VOLUME_SAMPLE_COUNT,
    burnIn: 64,
    seed: solid.seed,
  })
  const grid = bakePointDistanceGrid(
    cloud.points,
    solid.thickness,
    AFFINE_IFS_VOLUME_CELL,
  )
  const restPositions = occupiedCells(
    grid.field,
    grid.bounds,
    solid.spacing,
    pinHeight,
  )
  const inspected = inspectCandidateMaterial(
    restPositions,
    solid.spacing,
    grid.sourceBounds,
    grid.field,
  )
  if (grid.sourceBounds.min[1] < 0)
    inspected.warnings.push(
      'Placed source extends below y=0; the finite adapter clips material at the ground plane.',
    )
  inspected.warnings.push(
    `Distance bake quantizes source sites to a ${AFFINE_IFS_VOLUME_CELL}m grid; ideal fractal connectivity is not inferred.`,
  )
  const report: CandidateSolidReport = {
    ...inspected,
    bakeMilliseconds: globalThis.performance.now() - start,
    gridCells: grid.gridCells,
    gridBytes: grid.gridBytes,
    quantizationError: grid.quantizationError,
  }
  return {
    restPositions,
    bounds: inspected.bounds,
    spacing: solid.spacing,
    report,
    geometryKey: geometryKey(candidate),
    field: grid.field,
  }
}
