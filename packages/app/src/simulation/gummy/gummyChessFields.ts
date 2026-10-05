/** Shared rounded implicit solids keep every candy mould filled and connected through its broad base. */
export type Point3 = readonly [number, number, number]
export type ProfilePoint = readonly [radius: number, height: number]

// The shared broad foot and substantial stem keep the mould connected even at
// 0.12 spacing. Rounding is part of the volume, not a thin decorative shell.
export const BASE_PROFILE: readonly ProfilePoint[] = [
  [0, 0.07],
  [0.62, 0.07],
  [0.71, 0.12],
  [0.73, 0.23],
  [0.7, 0.33],
  [0.57, 0.42],
  [0.47, 0.48],
]
/** Signed distance to the revolved polygon, with a small moulded edge radius. */
export function roundedLathe(point: Point3, profile: readonly ProfilePoint[]) {
  const radial = Math.hypot(point[0], point[2])
  const height = point[1]
  let squared = Infinity
  let inside = false
  for (let i = 0, j = profile.length - 1; i < profile.length; j = i++) {
    const a = profile[i]!,
      b = profile[j]!
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(
        1,
        ((radial - a[0]) * dx + (height - a[1]) * dy) / (dx * dx + dy * dy),
      ),
    )
    squared = Math.min(
      squared,
      (radial - a[0] - t * dx) ** 2 + (height - a[1] - t * dy) ** 2,
    )
    if (
      a[1] > height !== b[1] > height &&
      radial < a[0] + ((height - a[1]) * dx) / dy
    )
      inside = !inside
  }
  return (inside ? -1 : 1) * Math.sqrt(squared) - 0.06
}

export function smoothUnion(a: number, b: number, width: number) {
  const h = Math.max(width - Math.abs(a - b), 0) / width
  return Math.min(a, b) - h * h * width * 0.25
}

export function sphere(point: Point3, center: Point3, radius: number) {
  return (
    Math.hypot(
      point[0] - center[0],
      point[1] - center[1],
      point[2] - center[2],
    ) - radius
  )
}

export function roundedBox(
  point: Point3,
  center: Point3,
  half: Point3,
  radius: number,
) {
  const x = Math.abs(point[0] - center[0]) - half[0] + radius
  const y = Math.abs(point[1] - center[1]) - half[1] + radius
  const z = Math.abs(point[2] - center[2]) - half[2] + radius
  return (
    Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) +
    Math.min(Math.max(x, y, z), 0) -
    radius
  )
}
