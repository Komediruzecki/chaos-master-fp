/** A bounded finite-thickness sample volume and face-connected partition for the window rook study. */
export type RookPoint = readonly [number, number, number]
export type RookCell = {
  position: RookPoint
  color: RookPoint
  neighbours: number[]
}
export type RookVolume = {
  cells: RookCell[]
  grid: Map<string, number>
  coordinates: RookPoint[]
  cellSize: number
  origin: RookPoint
}
const gridKey = (point: RookPoint) => point.join(',')
export const ROOK_DIRECTIONS: readonly RookPoint[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]
const add = (a: RookPoint, b: RookPoint): RookPoint => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]

function sampleBounds(points: Float32Array, colors: Float32Array) {
  if (
    !points.length ||
    points.length % 4 ||
    points.length !== colors.length ||
    points.length > 400_000
  )
    throw new RangeError(
      'Solid rook requires matching xyzw and RGBA arrays of at most 100,000 samples.',
    )
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < points.length; offset += 4)
    for (let axis = 0; axis < 3; axis++) {
      const value = points[offset + axis]!,
        color = colors[offset + axis]!
      if (
        !Number.isFinite(value) ||
        !Number.isFinite(color) ||
        color < 0 ||
        color > 1
      )
        throw new RangeError(
          'Solid rook positions and linear RGB must be finite; colors must lie in [0,1].',
        )
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
  const span = Math.max(...max.map((value, axis) => value - min[axis]!))
  if (span < 0.1 || span > 4 || min[1]! < 0)
    throw new RangeError(
      'Solid rook samples must fit a nondegenerate, above-board chess piece.',
    )
  return { min, cellSize: span / 32 }
}

function sourceSites(
  points: Float32Array,
  colors: Float32Array,
  origin: RookPoint,
  step: number,
) {
  const sites = new Map<
    string,
    { coordinate: RookPoint; color: number[]; count: number }
  >()
  for (let offset = 0; offset < points.length; offset += 4) {
    const coordinate = [0, 1, 2].map((axis) =>
      Math.floor((points[offset + axis]! - origin[axis]!) / step),
    ) as unknown as RookPoint
    const key = gridKey(coordinate)
    const site = sites.get(key) ?? { coordinate, color: [0, 0, 0], count: 0 }
    site.count++
    for (let axis = 0; axis < 3; axis++)
      site.color[axis] = site.color[axis]! + colors[offset + axis]!
    sites.set(key, site)
  }
  return [...sites.values()].map((site) => ({
    ...site,
    color: site.color.map((value) => value / site.count),
  }))
}

/** Radius is explicit finite material, not a claim about the ideal attractor's topology. */
export function windowRookVolume(
  points: Float32Array,
  colors: Float32Array,
): RookVolume {
  const { min, cellSize } = sampleBounds(points, colors)
  const origin: RookPoint = [
    min[0]! - 2 * cellSize,
    Math.max(0, min[1]! - 2 * cellSize),
    min[2]! - 2 * cellSize,
  ]
  const occupied = new Map<
    string,
    { coordinate: RookPoint; color: number[]; weight: number }
  >()
  const offsets: RookPoint[] = []
  for (let z = -2; z <= 2; z++)
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++)
        if (x * x + y * y + z * z <= 3) offsets.push([x, y, z])
  for (const site of sourceSites(points, colors, origin, cellSize))
    for (const offset of offsets) {
      const coordinate = add(site.coordinate, offset)
      if (coordinate[1] < 0) continue
      const key = gridKey(coordinate)
      const cell = occupied.get(key) ?? {
        coordinate,
        color: [0, 0, 0],
        weight: 0,
      }
      const weight =
        1 / (1 + offset.reduce((sum, value) => sum + value * value, 0))
      cell.weight += weight
      for (let axis = 0; axis < 3; axis++)
        cell.color[axis] = cell.color[axis]! + site.color[axis]! * weight
      occupied.set(key, cell)
    }
  if (occupied.size > 30_000)
    throw new RangeError('Solid rook exceeds its 30,000-cell budget.')
  const source = [...occupied.values()].sort(
    (a, b) =>
      a.coordinate[2] - b.coordinate[2] ||
      a.coordinate[1] - b.coordinate[1] ||
      a.coordinate[0] - b.coordinate[0],
  )
  const grid = new Map(
    source.map((cell, index) => [gridKey(cell.coordinate), index]),
  )
  const cells = source.map(
    (cell): RookCell => ({
      position: cell.coordinate.map(
        (value, axis) => origin[axis]! + (value + 0.5) * cellSize,
      ) as unknown as RookPoint,
      color: cell.color.map(
        (value) => value / cell.weight,
      ) as unknown as RookPoint,
      neighbours: ROOK_DIRECTIONS.flatMap((direction) => {
        const index = grid.get(gridKey(add(cell.coordinate, direction)))
        return index === undefined ? [] : [index]
      }),
    }),
  )
  return {
    cells,
    grid,
    coordinates: source.map((cell) => cell.coordinate),
    cellSize,
    origin,
  }
}

function distances(cells: readonly RookCell[], seed: number) {
  const distance = new Int32Array(cells.length).fill(-1)
  const queue = [seed]
  distance[seed] = 0
  for (let cursor = 0; cursor < queue.length; cursor++)
    for (const next of cells[queue[cursor]!]!.neighbours)
      if (distance[next] === -1) {
        distance[next] = distance[queue[cursor]!]! + 1
        queue.push(next)
      }
  return distance
}

/** Farthest geodesic seeds and multi-source growth guarantee a connected graph for every chunk. */
export function partitionWindowRook(cells: readonly RookCell[], count = 18) {
  if (
    !cells.length ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 32 ||
    count > cells.length
  )
    throw new RangeError('Solid rook needs 2–32 nonempty connected chunks.')
  const nearest = distances(cells, 0)
  if (nearest.includes(-1))
    throw new Error(
      'This finite rook volume is disconnected. No material was dropped or bridged automatically.',
    )
  const seeds = [0]
  while (seeds.length < count) {
    let farthest = 0
    for (let index = 1; index < nearest.length; index++)
      if (nearest[index]! > nearest[farthest]!) farthest = index
    seeds.push(farthest)
    const next = distances(cells, farthest)
    for (let index = 0; index < nearest.length; index++)
      nearest[index] = Math.min(nearest[index]!, next[index]!)
  }
  const labels = new Int16Array(cells.length).fill(-1),
    queue = [...seeds]
  seeds.forEach((seed, index) => {
    labels[seed] = index
  })
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!
    for (const next of cells[current]!.neighbours)
      if (labels[next] === -1) {
        labels[next] = labels[current]!
        queue.push(next)
      }
  }
  return { labels, count }
}
