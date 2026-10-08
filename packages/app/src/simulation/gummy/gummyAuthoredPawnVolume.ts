/** Bounded CPU distance bake thickens deterministic IFS samples into a physical volume. */
import { samplePawnCloud } from '@/flame/chess/pawnCloud'
import { buildAuthoredPawnFlame } from './gummyAuthoredPawnFlame'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'

const CELL = 0.025
const ORIGIN = [-0.825, -0.025, -0.825] as const
const SIZE = [67, 109, 67] as const
const FAR = 1e10
type Point = readonly [number, number, number]

/** Exact squared Euclidean distance transform of each one-dimensional grid line. */
function transformLine(
  values: Float32Array,
  start: number,
  stride: number,
  length: number,
  cost: Float64Array,
  sites: Int32Array,
  boundaries: Float64Array,
) {
  let count = -1
  for (let q = 0; q < length; q++) cost[q] = values[start + q * stride]!
  for (let q = 0; q < length; q++) {
    if (cost[q]! >= FAR) continue
    let intersection = -Infinity
    while (count >= 0) {
      const previous = sites[count]!
      intersection =
        (cost[q]! + q * q - cost[previous]! - previous * previous) /
        (2 * (q - previous))
      if (intersection > boundaries[count]!) break
      count--
    }
    count++
    sites[count] = q
    boundaries[count] = count === 0 ? -Infinity : intersection
    boundaries[count + 1] = Infinity
  }
  if (count < 0) return
  let site = 0
  for (let q = 0; q < length; q++) {
    while (boundaries[site + 1]! < q) site++
    const nearest = sites[site]!
    values[start + q * stride] = (q - nearest) ** 2 + cost[nearest]!
  }
}

/** About 1.9 MiB survives a bake; no particle positions or temporary grids are retained. */
export function bakeAuthoredPawnVolume(
  recipe: PawnRecipe,
  seed: number,
  radius: number,
) {
  const [nx, ny, nz] = SIZE
  const values = new Float32Array(nx * ny * nz).fill(FAR)
  const cloud = samplePawnCloud(buildAuthoredPawnFlame(recipe, radius), {
    count: 24_000,
    burnIn: 64,
    seed,
  })
  for (let i = 0; i < cloud.points.length; i += 4) {
    // Source affines carry the fixed frame; never refit random sample extrema.
    const point = [cloud.points[i]!, cloud.points[i + 1]!, cloud.points[i + 2]!]
    const cell = point.map((v, axis) => Math.round((v - ORIGIN[axis]!) / CELL))
    values[cell[0]! + nx * (cell[1]! + ny * cell[2]!)] = 0
  }
  const cost = new Float64Array(ny)
  const sites = new Int32Array(ny)
  const boundaries = new Float64Array(ny + 1)
  const line = (start: number, stride: number, length: number) => {
    transformLine(values, start, stride, length, cost, sites, boundaries)
  }
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) line(nx * (y + ny * z), 1, nx)
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) line(x + nx * ny * z, nx, ny)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) line(x + nx * y, nx * ny, nz)
  for (let i = 0; i < values.length; i++)
    values[i] = Math.sqrt(values[i]!) * CELL - radius

  return (point: Point): number => {
    const coordinates = point.map((v, axis) => (v - ORIGIN[axis]!) / CELL)
    const clamped = coordinates.map((v, axis) =>
      Math.max(0, Math.min(SIZE[axis]! - 1, v)),
    )
    const base = clamped.map((v, axis) =>
      Math.min(SIZE[axis]! - 2, Math.floor(v)),
    )
    const fraction = clamped.map((v, axis) => v - base[axis]!)
    let distance = 0
    for (let z = 0; z < 2; z++)
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const weight =
            (x ? fraction[0]! : 1 - fraction[0]!) *
            (y ? fraction[1]! : 1 - fraction[1]!) *
            (z ? fraction[2]! : 1 - fraction[2]!)
          distance +=
            weight *
            values[base[0]! + x + nx * (base[1]! + y + ny * (base[2]! + z))]!
        }
    const outside = Math.hypot(
      ...coordinates.map((v, axis) => (v - clamped[axis]!) * CELL),
    )
    return Math.max(distance + outside, -point[1])
  }
}
