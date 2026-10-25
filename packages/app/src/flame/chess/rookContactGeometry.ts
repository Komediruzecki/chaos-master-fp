/** Exact greedy boxes and shared-face bonds retain the finite rook's material without overlapping proxies. */
import { ROOK_CONTACT_MAX_BOXES } from './rookContactTypes'
import type { ContactVector, RookContactBond, RookContactPhysics, } from './rookContactTypes'
import type { RookChunk } from './windowRookFractureMesh'
import type { RookVolume } from './windowRookVolume'

function packBoxes(
  volume: RookVolume,
  labels: Int16Array,
  chunks: readonly RookChunk[],
) {
  const used = new Uint8Array(volume.cells.length)
  const boxes = chunks.map(() => [] as number[])
  const available = (x: number, y: number, z: number, label: number) => {
    const index = volume.grid.get(`${x},${y},${z}`)
    return index !== undefined && !used[index] && labels[index] === label
  }
  let count = 0
  for (let index = 0; index < volume.cells.length; index++) {
    if (used[index]) continue
    const [x, y, z] = volume.coordinates[index]!,
      label = labels[index]!
    let nx = 1,
      ny = 1,
      nz = 1
    while (available(x + nx, y, z, label)) nx++
    const layer = (dy: number, dz: number, height: number) => {
      for (let yy = 0; yy < height; yy++)
        for (let xx = 0; xx < nx; xx++)
          if (!available(x + xx, y + dy + yy, z + dz, label)) return false
      return true
    }
    while (layer(ny, 0, 1)) ny++
    while (layer(0, nz, ny)) nz++
    for (let zz = 0; zz < nz; zz++)
      for (let yy = 0; yy < ny; yy++)
        for (let xx = 0; xx < nx; xx++)
          used[volume.grid.get(`${x + xx},${y + yy},${z + zz}`)!] = 1
    const center = [x + nx / 2, y + ny / 2, z + nz / 2].map(
      (value, axis) =>
        volume.origin[axis]! +
        value * volume.cellSize -
        chunks[label]!.centroid[axis]!,
    )
    boxes[label]!.push(
      ...center,
      (nx * volume.cellSize) / 2,
      (ny * volume.cellSize) / 2,
      (nz * volume.cellSize) / 2,
    )
    if (++count > ROOK_CONTACT_MAX_BOXES)
      throw new RangeError(
        'The contact study exceeds its 1,500 collision-box budget.',
      )
  }
  return boxes.map((values) => new Float32Array(values))
}

function support(boxes: Float32Array) {
  const corners = new Map<string, ContactVector>()
  for (let offset = 0; offset < boxes.length; offset += 6)
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const point: ContactVector = [
            boxes[offset]! + x * boxes[offset + 3]!,
            boxes[offset + 1]! + y * boxes[offset + 4]!,
            boxes[offset + 2]! + z * boxes[offset + 5]!,
          ]
          corners.set(
            point.map((value) => Math.round(value * 1e7)).join(','),
            point,
          )
        }
  return new Float32Array([...corners.values()].flat())
}

function bondsOf(volume: RookVolume, labels: Int16Array): RookContactBond[] {
  const sums = new Map<
    string,
    { a: number; b: number; count: number; center: number[]; normal: number[] }
  >()
  volume.coordinates.forEach((coordinate, index) => {
    for (let axis = 0; axis < 3; axis++) {
      const next = [...coordinate]
      next[axis]!++
      const other = volume.grid.get(next.join(','))
      if (other === undefined || labels[index] === labels[other]) continue
      const a = Math.min(labels[index]!, labels[other]!),
        b = Math.max(labels[index]!, labels[other]!),
        key = `${a}:${b}`
      const sum = sums.get(key) ?? {
        a,
        b,
        count: 0,
        center: [0, 0, 0],
        normal: [0, 0, 0],
      }
      sum.count++
      for (let n = 0; n < 3; n++)
        sum.center[n]! +=
          volume.cells[index]!.position[n]! +
          (n === axis ? volume.cellSize / 2 : 0)
      sum.normal[axis]! += labels[index] === a ? 1 : -1
      sums.set(key, sum)
    }
  })
  return [...sums.values()].map((sum) => {
    const length = Math.hypot(...sum.normal)
    return {
      a: sum.a,
      b: sum.b,
      area: sum.count * volume.cellSize ** 2,
      centroid: sum.center.map((value) => value / sum.count) as ContactVector,
      normal: sum.normal.map((value) =>
        length ? value / length : 0,
      ) as ContactVector,
    }
  })
}

export function buildRookContactGeometry(
  volume: RookVolume,
  labels: Int16Array,
  chunks: readonly RookChunk[],
): RookContactPhysics {
  const boxes = packBoxes(volume, labels, chunks)
  return {
    cellSize: volume.cellSize,
    bonds: bondsOf(volume, labels),
    chunks: chunks.map((chunk, index) => {
      const points = support(boxes[index]!),
        min: ContactVector = [Infinity, Infinity, Infinity],
        max: ContactVector = [-Infinity, -Infinity, -Infinity]
      for (let offset = 0; offset < points.length; offset += 3)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, points[offset + axis]!)
          max[axis] = Math.max(max[axis]!, points[offset + axis]!)
        }
      return {
        centroid: [...chunk.centroid],
        mass: chunk.cells * volume.cellSize ** 3,
        localMin: min,
        localMax: max,
        boxes: boxes[index]!,
        supportPoints: points,
      }
    }),
  }
}
