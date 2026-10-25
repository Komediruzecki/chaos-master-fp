/** Pick coloured board pieces in world space, including scaled and rotated moulds. */
import { createAuthoredPawnField } from '@/simulation/gummy/gummyAuthoredPawn'
import { GUMMY_CHESS_MOULDS, gummyChessField, } from '@/simulation/gummy/gummyChessMoulds'
import type { GummyBoardPiece } from './gummyBoardChoreography'
import type { GummyRay, GummyVec3 } from '@/components/GummyBear/gummyStudyMath'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyChessArtStyle } from '@/simulation/gummy/gummyChessMoulds'

export function gummyBoardLocalRay(
  ray: GummyRay,
  offset: GummyVec3,
  scale: number,
  rotationY = 0,
): GummyRay {
  const c = Math.cos(rotationY),
    s = Math.sin(rotationY)
  const rotate = (p: GummyVec3): GummyVec3 => [
    c * p[0] - s * p[2],
    p[1],
    s * p[0] + c * p[2],
  ]
  return {
    origin: rotate(
      ray.origin.map((v, k) => (v - offset[k]!) / scale) as GummyVec3,
    ),
    direction: rotate(ray.direction),
  }
}

export function gummyBoardWorldPoint(
  point: GummyVec3,
  offset: GummyVec3,
  scale: number,
): GummyVec3 {
  return point.map((v, k) => v * scale + offset[k]!) as GummyVec3
}

/** Bounded sampling avoids assuming the blended mould field is an exact distance field. */
export function pickGummyBoardMould(
  ray: GummyRay,
  piece: GummyBoardPiece,
  scale: number,
  artStyle: GummyChessArtStyle = 'classic',
  authoredPawn?: GummyAuthoredPawn,
) {
  const local = gummyBoardLocalRay(ray, piece.position, scale, piece.rotationY)
  const bounds = GUMMY_CHESS_MOULDS[piece.mould].bounds
  let near = 0,
    far = Infinity
  for (let k = 0; k < 3; k++) {
    const o = local.origin[k]!,
      d = local.direction[k]!
    if (Math.abs(d) < 1e-9) {
      if (o < bounds.min[k]! || o > bounds.max[k]!) return undefined
      continue
    }
    const a = (bounds.min[k]! - o) / d,
      b = (bounds.max[k]! - o) / d
    near = Math.max(near, Math.min(a, b))
    far = Math.min(far, Math.max(a, b))
  }
  if (far < near) return undefined
  const field =
    piece.mould === 'pawn' && authoredPawn
      ? createAuthoredPawnField(authoredPawn)
      : (point: GummyVec3) => gummyChessField(point, piece.mould, artStyle)
  for (let t = near; t <= far; t += 0.025) {
    const point = local.origin.map(
      (v, k) => v + local.direction[k]! * t,
    ) as GummyVec3
    if (field(point) <= 0) return t * scale
  }
  return undefined
}

/** Use current particle positions for deformed bodies instead of their original silhouette. */
export function pickGummyBoardParticles(
  ray: GummyRay,
  positions: Float32Array,
  offset: GummyVec3,
  scale: number,
  radius: number,
) {
  const local = gummyBoardLocalRay(ray, offset, scale)
  let nearest = Infinity
  for (let i = 0; i < positions.length; i += 4) {
    const dx = positions[i]! - local.origin[0],
      dy = positions[i + 1]! - local.origin[1],
      dz = positions[i + 2]! - local.origin[2]
    const along =
      dx * local.direction[0] +
      dy * local.direction[1] +
      dz * local.direction[2]
    const perpendicular = dx * dx + dy * dy + dz * dz - along * along
    if (along < 0 || perpendicular > radius * radius) continue
    const distance = Math.max(
      0,
      along - Math.sqrt(Math.max(0, radius * radius - perpendicular)),
    )
    nearest = Math.min(nearest, distance * scale)
  }
  return Number.isFinite(nearest) ? nearest : undefined
}
