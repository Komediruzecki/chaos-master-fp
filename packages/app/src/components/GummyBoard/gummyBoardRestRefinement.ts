/** Bake-only sculpted surface projection removes particle-lattice bumps from waiting pieces. */
import { gummyChessField } from '@/simulation/gummy/gummyChessMoulds'
import type { Point3 } from '@/simulation/gummy/gummyChessFields'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

type Vec4 = { x: number; y: number; z: number; w: number }
export type GummyBoardBakedVertex = { position: Vec4; normal: Vec4; rest: Vec4 }
type SurfacePoint = {
  position: [number, number, number]
  normal: [number, number, number]
}

function fieldGradient(
  point: Point3,
  mould: GummyChessMould,
  epsilon: number,
): [number, number, number] {
  const [x, y, z] = point
  const field = (p: Point3) => gummyChessField(p, mould, 'sculpted')
  return [
    (field([x + epsilon, y, z]) - field([x - epsilon, y, z])) / (2 * epsilon),
    (field([x, y + epsilon, z]) - field([x, y - epsilon, z])) / (2 * epsilon),
    (field([x, y, z + epsilon]) - field([x, y, z - epsilon])) / (2 * epsilon),
  ]
}

/** Limited Newton steps improve the isosurface residual without moving a vertex more than one cell. */
export function projectGummyBoardRestPoint(
  point: Point3,
  mould: GummyChessMould,
  spacing: number,
): SurfacePoint {
  if (
    !point.every(Number.isFinite) ||
    !Number.isFinite(spacing) ||
    spacing < 0.06 ||
    spacing > 0.12
  )
    throw new RangeError(
      'Rest surface projection needs finite coordinates and a supported particle spacing',
    )
  const current: [number, number, number] = [...point]
  const epsilon = spacing * 0.025
  let distance = gummyChessField(current, mould, 'sculpted')
  for (
    let iteration = 0;
    iteration < 5 && Math.abs(distance) > 1e-5;
    iteration++
  ) {
    const gradient = fieldGradient(current, mould, epsilon)
    const length = Math.hypot(...gradient)
    if (length < 1e-6) break
    const stride = Math.max(
      -spacing * 0.4,
      Math.min(spacing * 0.4, distance / length),
    )
    let fraction = 1
    let accepted = false
    for (let trial = 0; trial < 4; trial++) {
      const candidate = current.map(
        (value, axis) => value - (gradient[axis]! * stride * fraction) / length,
      ) as [number, number, number]
      const displacement = candidate.map((value, axis) => value - point[axis]!)
      const travelled = Math.hypot(...displacement)
      if (travelled > spacing)
        for (let axis = 0; axis < 3; axis++)
          candidate[axis] =
            point[axis]! + (displacement[axis]! * spacing) / travelled
      const residual = gummyChessField(candidate, mould, 'sculpted')
      if (Math.abs(residual) < Math.abs(distance)) {
        current[0] = candidate[0]
        current[1] = candidate[1]
        current[2] = candidate[2]
        distance = residual
        accepted = true
        break
      }
      fraction *= 0.5
    }
    if (!accepted) break
  }
  const gradient = fieldGradient(current, mould, epsilon)
  const length = Math.hypot(...gradient)
  const normal: [number, number, number] =
    length > 1e-6
      ? [gradient[0] / length, gradient[1] / length, gradient[2] / length]
      : [0, 1, 0]
  return { position: current, normal }
}

/** Shared MC edge vertices receive identical projections; all original triangle connectivity is retained. */
export function refineGummyBoardRestVertices(
  vertices: readonly GummyBoardBakedVertex[],
  mould: GummyChessMould,
  spacing: number,
) {
  const packed = new Float32Array(vertices.length * 12)
  const cache = new Map<string, SurfacePoint>()
  for (const [index, vertex] of vertices.entries()) {
    const point: Point3 = [
      vertex.position.x,
      vertex.position.y,
      vertex.position.z,
    ]
    const key = `${point[0]},${point[1]},${point[2]}`
    let projected = cache.get(key)
    if (!projected) {
      projected = projectGummyBoardRestPoint(point, mould, spacing)
      cache.set(key, projected)
    }
    packed.set(
      [
        ...projected.position,
        vertex.position.w,
        ...projected.normal,
        vertex.normal.w,
        ...projected.position,
        vertex.rest.w,
      ],
      index * 12,
    )
  }
  return packed
}
