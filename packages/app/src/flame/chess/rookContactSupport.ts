/** A flat support patch balances beneath the center of mass; an edge or corner still permits tipping. */
import type { ContactVector as V } from './rookContactTypes'

const turn2 = (a: V, b: V, c: V) =>
  (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
export function supportPoint(points: V[], center: V, height: number): V {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[2] - b[2])
  const half = (values: V[]) => {
    const result: V[] = []
    for (const point of values) {
      while (
        result.length > 1 &&
        turn2(result[result.length - 2]!, result[result.length - 1]!, point) <=
          0
      )
        result.pop()
      result.push(point)
    }
    result.pop()
    return result
  }
  const hull =
    sorted.length > 1 ? [...half(sorted), ...half(sorted.toReversed())] : sorted
  if (
    hull.length >= 3 &&
    hull.every(
      (point, i) =>
        turn2(point, hull[(i + 1) % hull.length]!, center) >= -1e-10,
    )
  )
    return [center[0], height, center[2]]
  let nearest: V = [...hull[0]!],
    distance = Infinity
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index]!,
      b = hull[(index + 1) % hull.length]!,
      dx = b[0] - a[0],
      dz = b[2] - a[2]
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center[0] - a[0]) * dx + (center[2] - a[2]) * dz) /
          Math.max(1e-15, dx * dx + dz * dz),
      ),
    )
    const point: V = [a[0] + t * dx, height, a[2] + t * dz]
    const candidate = (point[0] - center[0]) ** 2 + (point[2] - center[2]) ** 2
    if (candidate < distance) {
      distance = candidate
      nearest = point
    }
  }
  return nearest
}
