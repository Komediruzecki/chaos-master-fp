/** Closed, locally colored chunk surfaces; internal interfaces share exact assembled positions. */
import { ROOK_DIRECTIONS } from './windowRookVolume'
import type { RookPoint, RookVolume } from './windowRookVolume'

export type RookChunk = {
  centroid: RookPoint
  radius: number
  cells: number
  firstVertex: number
  vertexCount: number
}
export const ROOK_SOLID_VERTEX_FLOATS = 19
export const ROOK_SOLID_MAX_VERTICES = 120_000

function chunkCenters(volume: RookVolume, labels: Int16Array, count: number) {
  const chunks = Array.from({ length: count }, () => ({
    sum: [0, 0, 0],
    cells: 0,
  }))
  volume.cells.forEach((cell, index) => {
    const chunk = chunks[labels[index]!]!
    chunk.cells++
    for (let axis = 0; axis < 3; axis++)
      chunk.sum[axis] = chunk.sum[axis]! + cell.position[axis]!
  })
  return chunks.map(
    (chunk): RookChunk => ({
      centroid: chunk.sum.map(
        (value) => value / chunk.cells,
      ) as unknown as RookPoint,
      radius: 0,
      cells: chunk.cells,
      firstVertex: 0,
      vertexCount: 0,
    }),
  )
}

function cornerPosition(
  volume: RookVolume,
  coordinate: RookPoint,
  corner: readonly number[],
): RookPoint {
  return coordinate.map(
    (value, axis) =>
      volume.origin[axis]! + (value + corner[axis]!) * volume.cellSize,
  ) as unknown as RookPoint
}

function faceCorners(normal: RookPoint): RookPoint[] {
  const axis = normal.findIndex((value) => value !== 0)
  const u = (axis + 1) % 3,
    v = (axis + 2) % 3
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([a, b]) => {
    const corner = [0, 0, 0]
    corner[axis] = normal[axis] === 1 ? 1 : 0
    corner[u] = a!
    corner[v] = b!
    return corner as unknown as RookPoint
  })
  return normal[axis] === 1 ? corners : corners.reverse()
}

function chunkMotion(chunk: RookChunk, index: number) {
  const angle =
    Math.atan2(chunk.centroid[2], chunk.centroid[0]) +
    Math.sin(index * 2.3) * 0.45
  const speed = 0.7 + (index % 5) * 0.1
  return {
    velocity: [
      Math.cos(angle) * speed,
      1.5 + (index % 4) * 0.18,
      Math.sin(angle) * speed,
    ],
    angular: [
      Math.sin(index * 1.7) * 2,
      1.2 + Math.cos(index * 2.1),
      Math.cos(index * 0.8) * 1.5,
    ],
  }
}

function fitChunkRadii(
  volume: RookVolume,
  labels: Int16Array,
  chunks: RookChunk[],
) {
  volume.cells.forEach((_cell, index) => {
    const chunk = chunks[labels[index]!]!
    for (const x of [0, 1])
      for (const y of [0, 1])
        for (const z of [0, 1]) {
          const point = cornerPosition(volume, volume.coordinates[index]!, [
            x,
            y,
            z,
          ])
          chunk.radius = Math.max(
            chunk.radius,
            Math.hypot(
              ...point.map((value, axis) => value - chunk.centroid[axis]!),
            ),
          )
        }
  })
}

/** Cell faces within one chunk disappear; boundaries become paired closed fracture surfaces. */
export function meshWindowRook(
  volume: RookVolume,
  labels: Int16Array,
  count: number,
) {
  const chunks = chunkCenters(volume, labels, count)
  fitChunkRadii(volume, labels, chunks)
  const chunkVertices = chunks.map(() => [] as number[])
  const motion = chunks.map(chunkMotion)
  let exteriorFaces = 0,
    interfaceFaces = 0,
    vertexCount = 0
  volume.cells.forEach((cell, cellIndex) => {
    const label = labels[cellIndex]!,
      chunk = chunks[label]!,
      vertices = chunkVertices[label]!
    const coordinate = volume.coordinates[cellIndex]!
    for (const normal of ROOK_DIRECTIONS) {
      const neighbour = volume.grid.get(
        coordinate.map((value, axis) => value + normal[axis]!).join(','),
      )
      if (neighbour !== undefined && labels[neighbour] === label) continue
      if (neighbour === undefined) exteriorFaces++
      else interfaceFaces++
      vertexCount += 6
      if (vertexCount > ROOK_SOLID_MAX_VERTICES)
        throw new RangeError(
          'Solid rook exceeds its 120,000-vertex mesh budget.',
        )
      const corners = faceCorners(normal).map((corner) =>
        cornerPosition(volume, coordinate, corner),
      )
      for (const corner of [0, 1, 2, 0, 2, 3]) {
        const position = corners[corner]!
        vertices.push(
          ...position.map((value, axis) => value - chunk.centroid[axis]!),
          ...normal,
          ...cell.color,
          ...chunk.centroid,
          ...motion[label]!.velocity,
          ...motion[label]!.angular,
          chunk.radius,
        )
      }
    }
  })
  const vertices = new Float32Array(vertexCount * ROOK_SOLID_VERTEX_FLOATS)
  let offset = 0
  chunks.forEach((chunk, index) => {
    const data = chunkVertices[index]!
    chunk.firstVertex = offset / ROOK_SOLID_VERTEX_FLOATS
    chunk.vertexCount = data.length / ROOK_SOLID_VERTEX_FLOATS
    vertices.set(data, offset)
    offset += data.length
  })
  return { vertices, chunks, exteriorFaces, interfaceFaces }
}
