// Static tone-star anchors and chamber lighting follow the existing Glasswake presentation clock.
import { mat4 } from 'wgpu-matrix'
import { GLASSWAKE_PETAL_RADIUS, GLASSWAKE_SEAL_TINTS, glasswakePetalAngle, } from './glasswakeGeometry'
import { GLASSWAKE_CENTER } from './scene'
import type { GlasswakePresentation, Vec3 } from './scene'

const clamp01 = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const acceptedSeals = (value: number) =>
  Math.max(0, Math.min(3, Number.isFinite(value) ? Math.trunc(value) : 0))
const starGroup = (value: number) =>
  Math.max(0, Math.min(2, Number.isFinite(value) ? Math.trunc(value) : 0))

/** The centre of a curved petal is 0.09 m forward of the seal origin. */
export const GLASSWAKE_TONE_STAR_Z = 0.09 + 0.06
export const GLASSWAKE_TONE_STAR_POSITIONS: readonly Vec3[] = [0, 1, 2].map(
  (group): Vec3 => {
    const angle = glasswakePetalAngle(group)
    return [
      GLASSWAKE_CENTER[0] + Math.cos(angle) * GLASSWAKE_PETAL_RADIUS,
      GLASSWAKE_CENTER[1] + Math.sin(angle) * GLASSWAKE_PETAL_RADIUS,
      GLASSWAKE_CENTER[2] + GLASSWAKE_TONE_STAR_Z,
    ]
  },
)

/** A star's local +Y points radially outwards; there is no spin or independent clock. */
export function toneStarMatrix(group: number) {
  const index = starGroup(group)
  const matrix = mat4.translation(GLASSWAKE_TONE_STAR_POSITIONS[index])
  return mat4.rotateZ(matrix, glasswakePetalAngle(index) - Math.PI / 2, matrix)
}

/** Opened stars emerge after the initial shatter, on the same paused clock as its shards. */
export function toneStarTint(
  group: number,
  presentation: GlasswakePresentation,
  motion: boolean,
  clay = false,
): readonly [number, number, number, number] {
  if (clay) return [1, 1, 1, 0]
  const index = starGroup(group)
  const tint = GLASSWAKE_SEAL_TINTS[index]
  const accepted = acceptedSeals(presentation.accepted)
  if (index < accepted) {
    const burst = presentation.burstTimes[index]
    let fade = 1
    // Restored partial progress has no burst timestamp: its stars are already settled.
    if (motion && Number.isFinite(burst)) {
      const time = Number.isFinite(presentation.time) ? presentation.time : 0
      const age = Math.max(0, time - burst)
      const rise = clamp01((age - 0.35) / 0.65)
      fade = rise * rise * (3 - 2 * rise)
    }
    return [tint[0], tint[1], tint[2], 0.85 * fade]
  }
  const holding = index === accepted && presentation.holding
  const charge = holding ? clamp01(presentation.charge) : 0
  const brightness = holding ? 0.6 + 0.4 * charge : 0.45
  return [
    tint[0] * brightness,
    tint[1] * brightness,
    tint[2] * brightness,
    holding ? 0.04 + 0.45 * charge : 0,
  ]
}

/** Monotonic earned warmth with a reversible hold contribution; motion adds no light pulse. */
export function chamberLight(
  presentation: GlasswakePresentation,
  _motion: boolean,
): number {
  const accepted = acceptedSeals(presentation.accepted)
  const charge =
    presentation.holding && accepted < 3 ? clamp01(presentation.charge) : 0
  return 0.55 + 0.15 * accepted + 0.1 * charge
}
