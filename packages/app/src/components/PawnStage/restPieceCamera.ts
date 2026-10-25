/** Keep all framed material inside the depth range, including distant imported sources. */
import { gummyCameraRadius } from '../GummyBear/gummyStudyMath'
import type { GummyCameraFraming, GummyOrbit, } from '../GummyBear/gummyStudyMath'

/** Radius plus a containing sphere bounds every corner from any orbit or pan. */
export function restPieceFarPlane(
  orbit: GummyOrbit,
  aspect: number,
  framing: GummyCameraFraming,
) {
  const radius = gummyCameraRadius(orbit, aspect, 'pull', framing)
  const halfDiagonal = Math.hypot(
    ...framing.max.map(
      (value, axis) =>
        (value - framing.min[axis]!) / 2 + (framing.surfacePadding ?? 0),
    ),
  )
  const panDistance = Math.hypot(...(orbit.pan ?? [0, 0, 0]))
  return Math.max(50, (radius + halfDiagonal + panDistance) * 1.05)
}
