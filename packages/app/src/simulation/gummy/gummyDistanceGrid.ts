/** Bounded separable Euclidean distance bake for finite sampled material fields. */
export type SolidPoint = readonly [number, number, number]
export type SolidBounds = {
  min: [number, number, number]
  max: [number, number, number]
}
const FAR = 1e10
const MAX_CELLS = 8_000_000

/** Squared distances on one line; lower-envelope intersections use f64 scratch. */
function transformLine(
  values: Float32Array,
  start: number,
  stride: number,
  length: number,
  cost: Float64Array,
  sites: Int32Array,
  edges: Float64Array,
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
      if (intersection > edges[count]!) break
      count--
    }
    count++
    sites[count] = q
    edges[count] = count === 0 ? -Infinity : intersection
    edges[count + 1] = Infinity
  }
  if (count < 0) return
  let site = 0
  for (let q = 0; q < length; q++) {
    while (edges[site + 1]! < q) site++
    const nearest = sites[site]!
    values[start + q * stride] = (q - nearest) ** 2 + cost[nearest]!
  }
}

/** Quantized sites are explicit: this approximates a tube union, not an exact IFS solid. */
export function bakePointDistanceGrid(
  points: Float32Array,
  radius: number,
  cell: number,
) {
  if (
    points.length === 0 ||
    points.length % 4 !== 0 ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(cell) ||
    cell <= 0
  )
    throw new Error(
      'Distance bake requires finite points, positive thickness and cell size.',
    )
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < points.length; i += 4)
    for (let axis = 0; axis < 3; axis++) {
      const value = points[i + axis]!
      if (!Number.isFinite(value))
        throw new Error('Distance bake requires finite points.')
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
  const padding = radius + cell * 2
  const origin = min.map((value) => Math.floor((value - padding) / cell) * cell)
  const maximum = max.map((value) => Math.ceil((value + padding) / cell) * cell)
  const size = origin.map(
    (value, axis) => Math.round((maximum[axis]! - value) / cell) + 1,
  )
  const count = size.reduce((product, value) => product * value, 1)
  if (!Number.isSafeInteger(count) || count > MAX_CELLS)
    throw new Error(
      'This placed source exceeds the finite-volume bake budget (8 million cells).',
    )
  const [nx, ny, nz] = size as [number, number, number]
  const values = new Float32Array(count).fill(FAR)
  for (let i = 0; i < points.length; i += 4) {
    const x = Math.round((points[i]! - origin[0]!) / cell)
    const y = Math.round((points[i + 1]! - origin[1]!) / cell)
    const z = Math.round((points[i + 2]! - origin[2]!) / cell)
    values[x + nx * (y + ny * z)] = 0
  }
  const longest = Math.max(nx, ny, nz)
  const cost = new Float64Array(longest),
    sites = new Int32Array(longest),
    edges = new Float64Array(longest + 1)
  const line = (start: number, stride: number, length: number) => {
    transformLine(values, start, stride, length, cost, sites, edges)
  }
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) line(nx * (y + ny * z), 1, nx)
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) line(x + nx * ny * z, nx, ny)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) line(x + nx * y, nx * ny, nz)
  for (let i = 0; i < count; i++)
    values[i] = Math.sqrt(values[i]!) * cell - radius
  const field = (point: SolidPoint) => {
    const coordinate = point.map(
      (value, axis) => (value - origin[axis]!) / cell,
    )
    const clamp = coordinate.map((value, axis) =>
      Math.max(0, Math.min(size[axis]! - 1, value)),
    )
    const base = clamp.map((value, axis) =>
      Math.min(size[axis]! - 2, Math.floor(value)),
    )
    const fraction = clamp.map((value, axis) => value - base[axis]!)
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
      ...coordinate.map((value, axis) => (value - clamp[axis]!) * cell),
    )
    return Math.max(distance + outside, -point[1])
  }
  return {
    field,
    cell,
    gridCells: count,
    gridBytes: values.byteLength,
    quantizationError: (Math.sqrt(3) * cell) / 2,
    bounds: {
      min: origin as [number, number, number],
      max: maximum as [number, number, number],
    },
    sourceBounds: {
      min: min as [number, number, number],
      max: max as [number, number, number],
    },
  }
}
