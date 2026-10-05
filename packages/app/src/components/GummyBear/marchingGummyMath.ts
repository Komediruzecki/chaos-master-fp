/** Compact particle density and bounded cube-surface allocation, shared with GPU and numerical tests. */
import { d, std, tgpu } from 'typegpu'

export const MARCHING_GUMMY_RADIUS_SCALE = 1.8
export const MARCHING_GUMMY_CELL_SCALE = 0.75
// The lowest lattice sample of one particle is 0.1355 at a fine-cell centre.
// A lower isovalue preserves detached single-particle droplets at every grid phase.
export const MARCHING_GUMMY_ISO = 0.095
export const MARCHING_GUMMY_FIXED_SCALE = 16384
export const MARCHING_GUMMY_MAX_VERTICES = 300000
export const MARCHING_GUMMY_MEMORY_LIMIT = 96 * 1024 * 1024

/** C1 compact kernel whose integral is particle volume; zero support cannot connect separated blobs. */
export const marchingGummyDensity = tgpu.fn(
  [d.vec3f, d.f32, d.f32],
  d.f32,
)((relative, radius, volumeWeight) => {
  'use gpu'
  if (radius <= 0) return 0
  const value = std.max(1 - std.dot(relative, relative) / (radius * radius), 0)
  return value * value * (35 / 8) * volumeWeight
})

/** Interpolate only within a bracketed cube edge; equal values remain finite. */
export const marchingGummyCrossing = tgpu.fn(
  [d.f32, d.f32, d.f32],
  d.f32,
)((a, b, iso) => {
  'use gpu'
  const difference = b - a
  if (std.abs(difference) < 0.00000001) return 0.5
  return std.clamp((iso - a) / difference, 0, 1)
})

/** Append reservations and capacities are triangle aligned, including overflowed frames. */
export const marchingGummyDrawCount = tgpu.fn(
  [d.u32, d.u32],
  d.u32,
)((attempted, capacity) => {
  'use gpu'
  const bounded = std.min(attempted, capacity)
  return bounded - (bounded % 3)
})

/** Ghost nodes keep every kernel closed even when particles press against the solver domain wall. */
export function marchingGummyDomain(
  bounds: { min: readonly number[]; max: readonly number[] },
  supportRadius: number,
) {
  if (!Number.isFinite(supportRadius) || supportRadius <= 0)
    throw new Error('Marching-cubes support radius must be finite and positive')
  return {
    min: bounds.min.map((value) => value - supportRadius),
    max: bounds.max.map((value) => value + supportRadius),
  }
}

export function marchingGummyGrid(
  bounds: { min: readonly number[]; max: readonly number[] },
  cellSize: number,
  maxVertices = MARCHING_GUMMY_MAX_VERTICES,
) {
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new Error('Marching-cubes cell size must be finite and positive')
  if (
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((value, axis) => value >= bounds.max[axis]!)
  )
    throw new Error(
      'Marching-cubes bounds must contain three finite increasing axes',
    )
  if (
    !Number.isSafeInteger(maxVertices) ||
    maxVertices < 3 ||
    maxVertices > 3000000
  )
    throw new Error(
      'Marching-cubes vertex capacity must be an integer between 3 and 3000000',
    )
  const capacity = maxVertices - (maxVertices % 3)
  const gridSize = bounds.min.map((value, axis) => {
    const cells = (bounds.max[axis]! - value) / cellSize
    // A round-off-sized remainder must not allocate a whole additional grid plane.
    return Math.ceil(cells - Number.EPSILON * Math.max(1, cells) * 8) + 1
  })
  const nodeCount = gridSize.reduce((product, value) => product * value, 1)
  const cellCount = gridSize.reduce(
    (product, value) => product * (value - 1),
    1,
  )
  // Four u32 scatter accumulators + one vec4 sample; evaluate normals only on the mesh.
  const bytes = nodeCount * 32 + capacity * 48 + 256 * 16 * 4 + 256
  if (!Number.isSafeInteger(nodeCount) || bytes > MARCHING_GUMMY_MEMORY_LIMIT)
    throw new Error(
      'Marching-cubes grid exceeds the 96 MiB surface memory budget',
    )
  return { gridSize, nodeCount, cellCount, capacity, bytes }
}
