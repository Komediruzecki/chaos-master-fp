/** Finite material connectivity, ground support and actual marching-density warnings. */
import { d } from 'typegpu'
import { MARCHING_GUMMY_FIXED_SCALE, MARCHING_GUMMY_ISO, MARCHING_GUMMY_RADIUS_SCALE, marchingGummyDensity, } from '@/components/GummyBear/marchingGummyMath'
import type { SolidBounds, SolidPoint } from './gummyDistanceGrid'

export type CandidateSolidReport = {
  particleCount: number
  restVolume: number
  componentCount: number
  largestComponentFraction: number
  componentParticleCounts: number[]
  baseCellCount: number
  baseArea: number
  centerOfMass: [number, number, number]
  centerSupported: boolean
  sourceBounds: SolidBounds
  bounds: SolidBounds
  rendererOpeningRisk: { tested: number; closed: number }
  warnings: string[]
  bakeMilliseconds: number
  gridCells: number
  gridBytes: number
  quantizationError: number
}

type Cell = [number, number, number]
const keyOf = (cell: readonly number[]) => cell.join(',')
const cellOf = (
  positions: Float32Array,
  offset: number,
  spacing: number,
): Cell => [
  Math.round(positions[offset]! / spacing - 0.5) || 0,
  Math.round(positions[offset + 1]! / spacing - 0.5) || 0,
  Math.round(positions[offset + 2]! / spacing - 0.5) || 0,
]

function componentCounts(cells: Map<string, Cell>) {
  const remaining = new Set(cells.keys()),
    counts: number[] = []
  while (remaining.size > 0) {
    const first = remaining.values().next().value!
    remaining.delete(first)
    const pending = [cells.get(first)!]
    for (let index = 0; index < pending.length; index++)
      for (let axis = 0; axis < 3; axis++)
        for (const direction of [-1, 1]) {
          const neighbour = [...pending[index]!] as Cell
          neighbour[axis]! += direction
          const key = keyOf(neighbour)
          if (remaining.delete(key)) pending.push(cells.get(key)!)
        }
    counts.push(pending.length)
  }
  return counts.sort((a, b) => b - a)
}

const cross = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)

/** A rigid-body support-polygon diagnostic, not a promise about deformable stability. */
function centerInsideSupport(
  cells: readonly Cell[],
  center: SolidPoint,
  spacing: number,
) {
  const unique = new Map<string, [number, number]>()
  for (const [x, , z] of cells)
    for (const dx of [0, 1])
      for (const dz of [0, 1]) {
        const point: [number, number] = [(x + dx) * spacing, (z + dz) * spacing]
        unique.set(point.join(','), point)
      }
  const points = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (points.length < 3) return false
  const half = (ordered: readonly [number, number][]) => {
    const result: [number, number][] = []
    for (const point of ordered) {
      while (
        result.length >= 2 &&
        cross(result.at(-2)!, result.at(-1)!, point) <= 0
      )
        result.pop()
      result.push(point)
    }
    return result.slice(0, -1)
  }
  const hull = [...half(points), ...half([...points].reverse())]
  return hull.every(
    (point, index) =>
      cross(point, hull[(index + 1) % hull.length]!, [center[0], center[2]]) >=
      -1e-9,
  )
}

/** Same compact kernel and fixed-point quantization as the native surface scatter. */
export function candidateSolidDensity(
  point: SolidPoint,
  positions: Float32Array,
  spacing: number,
) {
  const radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
  const weight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
  let density = 0
  for (let i = 0; i < positions.length; i += 4) {
    const x = point[0] - positions[i]!,
      y = point[1] - positions[i + 1]!,
      z = point[2] - positions[i + 2]!
    if (x * x + y * y + z * z >= radius * radius) continue
    density +=
      Math.round(
        marchingGummyDensity(d.vec3f(x, y, z), radius, weight) *
          MARCHING_GUMMY_FIXED_SCALE,
      ) / MARCHING_GUMMY_FIXED_SCALE
  }
  return density
}

/** Resolution probes count field-clear interior samples, not certified topological holes. */
function openingRisk(
  field: (point: SolidPoint) => number,
  bounds: SolidBounds,
  positions: Float32Array,
  spacing: number,
) {
  let tested = 0,
    closed = 0
  // Fixed source-relative grid makes probes independent of labels and side palettes.
  for (let z = 1; z < 10; z++)
    for (let y = 1; y < 10; y++)
      for (let x = 1; x < 10; x++) {
        const point = [x, y, z].map(
          (value, axis) =>
            bounds.min[axis]! +
            (value / 10) * (bounds.max[axis]! - bounds.min[axis]!),
        ) as [number, number, number]
        const clearance = field(point)
        if (
          clearance < spacing * 0.75 ||
          clearance > spacing * MARCHING_GUMMY_RADIUS_SCALE
        )
          continue
        tested++
        if (
          candidateSolidDensity(point, positions, spacing) >= MARCHING_GUMMY_ISO
        )
          closed++
      }
  return { tested, closed }
}

export function inspectCandidateMaterial(
  positions: Float32Array,
  spacing: number,
  sourceBounds: SolidBounds,
  field: (point: SolidPoint) => number,
) {
  if (positions.length === 0 || positions.length % 4 !== 0)
    throw new Error('This source has no occupied finite material cells.')
  const cells = new Map<string, Cell>(),
    base: Cell[] = []
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const center: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < positions.length; i += 4) {
    const cell = cellOf(positions, i, spacing)
    cells.set(keyOf(cell), cell)
    if (cell[1] === 0) base.push(cell)
    for (let axis = 0; axis < 3; axis++) {
      center[axis] = center[axis]! + positions[i + axis]!
      min[axis] = Math.min(min[axis]!, cell[axis]! * spacing)
      max[axis] = Math.max(max[axis]!, (cell[axis]! + 1) * spacing)
    }
  }
  const particleCount = positions.length / 4
  for (let axis = 0; axis < 3; axis++)
    center[axis] = center[axis]! / particleCount
  const counts = componentCounts(cells),
    bounds = { min, max }
  const risk = openingRisk(field, sourceBounds, positions, spacing)
  const centerSupported = centerInsideSupport(base, center, spacing),
    warnings: string[] = []
  if (counts.length > 1)
    warnings.push(
      `Material has ${counts.length} separate 6-face components; it is not one connected body.`,
    )
  if (base.length === 0)
    warnings.push('No occupied material cell touches the ground plane.')
  else if (!centerSupported)
    warnings.push(
      'The material centre lies outside its ground support polygon.',
    )
  if (risk.closed > 0)
    warnings.push(
      `${risk.closed} of ${risk.tested} field-clear interior probes become filled by the current marching surface kernel.`,
    )
  warnings.push(
    'Only finite sampled thickness is material; finer ideal IFS holes and physical tearing are not certified by this inspection.',
  )
  return {
    particleCount,
    restVolume: particleCount * spacing ** 3,
    componentCount: counts.length,
    largestComponentFraction: counts[0]! / particleCount,
    componentParticleCounts: counts,
    baseCellCount: base.length,
    baseArea: base.length * spacing ** 2,
    centerOfMass: center,
    centerSupported,
    sourceBounds,
    bounds,
    rendererOpeningRisk: risk,
    warnings,
  }
}
