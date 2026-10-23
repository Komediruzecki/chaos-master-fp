/** Bear mould field, normals and conforming clipped tetrahedron geometry. */
import type { GummyVec3 } from './gummyMeshContracts'

export type Tet = [number, number, number, number]
export type Face = [number, number, number]

function ellipsoid(p: GummyVec3, c: GummyVec3, r: GummyVec3) {
  const x = (p[0] - c[0]) / r[0]
  const y = (p[1] - c[1]) / r[1]
  const z = (p[2] - c[2]) / r[2]
  // A conservative smooth field with the exact ellipsoid zero set.
  return (Math.hypot(x, y, z) - 1) * Math.min(...r)
}

function smoothUnion(a: number, b: number, width: number) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / width))
  return b + (a - b) * h - width * h * (1 - h)
}

/** The mould has a belly, joined limbs, round ears, a raised muzzle and recessed eyes. */
export function gummyBearField(p: GummyVec3) {
  let result = ellipsoid(p, [0, 1.05, 0], [0.46, 0.68, 0.34])
  const parts: [GummyVec3, GummyVec3][] = [
    [
      [0, 1.96, 0],
      [0.49, 0.46, 0.35],
    ],
    [
      [-0.36, 2.34, 0],
      [0.195, 0.22, 0.19],
    ],
    [
      [0.36, 2.34, 0],
      [0.195, 0.22, 0.19],
    ],
    [
      [-0.49, 1.18, 0.04],
      [0.245, 0.36, 0.25],
    ],
    [
      [0.49, 1.18, 0.04],
      [0.245, 0.36, 0.25],
    ],
    [
      [-0.255, 0.24, 0.13],
      [0.285, 0.25, 0.38],
    ],
    [
      [0.255, 0.24, 0.13],
      [0.285, 0.25, 0.38],
    ],
    [
      [0, 1.83, 0.29],
      [0.275, 0.195, 0.19],
    ],
    [
      [0, 1.93, 0.445],
      [0.095, 0.075, 0.055],
    ],
    [
      [0, 0.99, 0.275],
      [0.32, 0.39, 0.13],
    ],
  ]
  for (const [center, radii] of parts)
    result = smoothUnion(result, ellipsoid(p, center, radii), 0.085)
  for (const x of [-0.19, 0.19]) {
    const eye = ellipsoid(p, [x, 2.07, 0.329], [0.06, 0.07, 0.04])
    result = -smoothUnion(-result, eye, 0.018)
  }
  return Math.max(result, -p[1])
}

export function fieldNormal(p: GummyVec3): GummyVec3 {
  const h = 0.0002
  const gradient = [0, 1, 2].map((axis) => {
    const a: GummyVec3 = [...p]
    const b: GummyVec3 = [...p]
    a[axis]! += h
    b[axis]! -= h
    return gummyBearField(a) - gummyBearField(b)
  })
  const length = Math.hypot(...gradient) || 1
  return [gradient[0]! / length, gradient[1]! / length, gradient[2]! / length]
}

export function tetrahedronVolume(
  a: GummyVec3,
  b: GummyVec3,
  c: GummyVec3,
  e: GummyVec3,
) {
  const x = b.map((value, i) => value - a[i]!)
  const y = c.map((value, i) => value - a[i]!)
  const z = e.map((value, i) => value - a[i]!)
  return (
    (x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) +
      x[1]! * (y[2]! * z[0]! - y[0]! * z[2]!) +
      x[2]! * (y[0]! * z[1]! - y[1]! * z[0]!)) /
    6
  )
}

export const TET_FACES = [
  [1, 2, 3],
  [0, 3, 2],
  [0, 1, 3],
  [0, 2, 1],
] as const
export const CUBE_TETS: Tet[] = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
]

/** Pulling triangulation of clipped tetrahedra preserves shared-face diagonals. */
export function clipTetrahedron(
  tet: Tet,
  points: GummyVec3[],
  values: number[],
  edges: Map<string, number>,
): Tet[] {
  const inside = tet.filter((id) => values[id]! <= 0)
  if (inside.length === 4) return [tet]
  if (inside.length === 0) return []
  const cuts = new Set<number>()
  const intersection = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const found = edges.get(key)
    if (found !== undefined) {
      cuts.add(found)
      return found
    }
    const t = values[a]! / (values[a]! - values[b]!)
    if (t < 0.00001) {
      cuts.add(a)
      return a
    }
    if (t > 0.99999) {
      cuts.add(b)
      return b
    }
    const id = points.length
    points.push(
      points[a]!.map((x, k) => x + t * (points[b]![k]! - x)) as GummyVec3,
    )
    values.push(0)
    edges.set(key, id)
    cuts.add(id)
    return id
  }
  const polygons: number[][] = []
  for (const face of TET_FACES) {
    const polygon: number[] = []
    for (let j = 0; j < 3; j++) {
      const a = tet[face[j]!],
        b = tet[face[(j + 1) % 3]!]
      if (values[a]! <= 0) polygon.push(a)
      if (values[a]! <= 0 !== values[b]! <= 0) polygon.push(intersection(a, b))
    }
    const distinct = [...new Set(polygon)]
    if (distinct.length >= 3) polygons.push(distinct)
  }
  if (cuts.size >= 3) {
    const cutIds = [...cuts]
    const center: GummyVec3 = [0, 0, 0]
    for (const id of cutIds)
      for (let k = 0; k < 3; k++) center[k]! += points[id]![k]! / cutIds.length
    const normal = fieldNormal(center)
    const u =
      Math.abs(normal[1]) < 0.9
        ? [normal[2], 0, -normal[0]]
        : [0, -normal[2], normal[1]]
    const v = [
      normal[1] * u[2]! - normal[2] * u[1]!,
      normal[2] * u[0]! - normal[0] * u[2]!,
      normal[0] * u[1]! - normal[1] * u[0]!,
    ]
    const angle = (id: number) => {
      const delta = points[id]!.map((x, k) => x - center[k]!)
      return Math.atan2(
        delta.reduce((sum, x, k) => sum + x * v[k]!, 0),
        delta.reduce((sum, x, k) => sum + x * u[k]!, 0),
      )
    }
    cutIds.sort((a, b) => angle(a) - angle(b))
    polygons.push(cutIds)
  }
  const anchor = Math.min(...inside)
  const output: Tet[] = []
  for (const polygon of polygons) {
    if (polygon.includes(anchor)) continue
    const first = polygon.indexOf(Math.min(...polygon))
    const ordered = polygon.map(
      (_, i) => polygon[(i + first) % polygon.length]!,
    )
    for (let j = 1; j < ordered.length - 1; j++) {
      const candidate: Tet = [anchor, ordered[0]!, ordered[j]!, ordered[j + 1]!]
      const volume = tetrahedronVolume(
        ...(candidate.map((id) => points[id]!) as [
          GummyVec3,
          GummyVec3,
          GummyVec3,
          GummyVec3,
        ]),
      )
      if (Math.abs(volume) < 1e-12) continue
      if (volume < 0)
        [candidate[1], candidate[2]] = [candidate[2], candidate[1]]
      output.push(candidate)
    }
  }
  return output
}
