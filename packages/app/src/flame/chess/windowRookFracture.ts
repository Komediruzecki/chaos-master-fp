/** Experimental connected finite-volume fracture of the sampled Lattice Court window rook. */
import { meshWindowRook, ROOK_SOLID_VERTEX_FLOATS, } from './windowRookFractureMesh'
import { partitionWindowRook, windowRookVolume } from './windowRookVolume'
import type { RookChunk } from './windowRookFractureMesh'

export type WindowRookFracture = {
  key: string
  /** local position, normal, linear RGB, centroid, velocity, angular velocity, support radius. */
  vertices: Float32Array
  fragmentCount: number
  chunks: readonly RookChunk[]
  diagnostics: {
    cellSize: number
    occupiedCells: number
    connectedComponents: number
    retainedFraction: number
    volume: number
    interfaceFaces: number
    exteriorFaces: number
  }
}

/** Fit optional prototype glass to its assembled finite volume, not its thinner source cloud. */
export function assembledWindowRookPoints(
  solids: readonly WindowRookFracture[],
) {
  const points = new Float32Array(
    solids.reduce(
      (sum, solid) =>
        sum + (solid.vertices.length / ROOK_SOLID_VERTEX_FLOATS) * 4,
      0,
    ),
  )
  let offset = 0
  for (const solid of solids)
    for (
      let vertex = 0;
      vertex < solid.vertices.length;
      vertex += ROOK_SOLID_VERTEX_FLOATS
    ) {
      for (let axis = 0; axis < 3; axis++) {
        const value =
          solid.vertices[vertex + axis]! + solid.vertices[vertex + 9 + axis]!
        points[offset + axis] = axis === 1 ? Math.max(0, value) : value
      }
      points[offset + 3] = 1
      offset += 4
    }
  return points
}

/** This is finite sampled material with prescribed chunk motion, not a continuum stress solver. */
export function buildWindowRookFracture(
  key: string,
  points: Float32Array,
  colors: Float32Array,
): WindowRookFracture {
  if (key !== 'rook:light' && key !== 'rook:dark')
    throw new RangeError(
      'The connected-solid study currently supports window rooks only.',
    )
  const volume = windowRookVolume(points, colors)
  const partition = partitionWindowRook(volume.cells)
  const mesh = meshWindowRook(volume, partition.labels, partition.count)
  return {
    key,
    vertices: mesh.vertices,
    fragmentCount: partition.count,
    chunks: mesh.chunks,
    diagnostics: {
      cellSize: volume.cellSize,
      occupiedCells: volume.cells.length,
      connectedComponents: 1,
      retainedFraction: 1,
      volume: volume.cells.length * volume.cellSize ** 3,
      interfaceFaces: mesh.interfaceFaces,
      exteriorFaces: mesh.exteriorFaces,
    },
  }
}
