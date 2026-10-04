/** Watertight procedural gummy solid, clipped tetrahedra and paired cohesive tear faces. */
import { partitionGummyCells } from './gummyPartition'

export type GummyVec3 = [number, number, number]

export type GummyMesh = {
  /** Runtime splits use actual shared-node adjacency and permanently exposed internal faces. */
  runtimeFracture?: boolean
  /** xyz in metres, w is inverse lumped mass; the bottom contact patch is optionally anchored. */
  positions: Float32Array
  tetrahedra: Uint32Array
  /** Three corresponding vertex pairs per cohesive triangle, followed by two padding words. */
  interfaces: Uint32Array
  /** Outward triangle indices and cohesive interface ID, EXTERIOR_FACE or EXPOSED_TEAR_FACE. */
  surface: Uint32Array
  restNormals: Float32Array
  nodeRegions: Uint32Array
  spacing: number
  restVolume: number
  /** Rest volume per study mass unit; absent retains the legacy per-mesh nodal normalization. */
  massReferenceVolume?: number
  bounds: { min: GummyVec3; max: GummyVec3 }
  demoGrip: { center: GummyVec3; radius: number; pull: GummyVec3 }
}

export const EXTERIOR_FACE = 0xffffffff
/** A fresh runtime tear face, permanently visible without a cohesive damage-buffer index. */
export const EXPOSED_TEAR_FACE = 0xfffffffe
export const GUMMY_DEMO_GRIP = {
  center: [0.64, 1.24, 0.08] as GummyVec3,
  radius: 0.28,
  pull: [0.95, 0.22, 0.14] as GummyVec3,
}

type Tet = [number, number, number, number]
type Face = [number, number, number]

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

function fieldNormal(p: GummyVec3): GummyVec3 {
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

const TET_FACES = [
  [1, 2, 3],
  [0, 3, 2],
  [0, 1, 3],
  [0, 2, 1],
] as const
const CUBE_TETS: Tet[] = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
]

/** Pulling triangulation of clipped tetrahedra preserves shared-face diagonals. */
function clipTetrahedron(
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

function tearRegion(p: GummyVec3) {
  if (p[0] > 0.455 && p[1] > 0.74 && p[1] < 1.6) return 1
  if (p[1] > 2.25 && p[0] > 0.16) return 2
  if (p[1] > 2.25 && p[0] < -0.16) return 3
  if (p[0] < -0.455 && p[1] > 0.74 && p[1] < 1.6) return 4
  return 0
}

/** Build a conforming solid once on CPU; all subsequent deformation runs on the GPU. */
export function buildGummyBearMesh(
  options:
    | {
        spacing?: number
        fracture?: 'fine' | 'limbs' | 'none'
        pinnedFeet?: boolean
        /** Height of the fixed lower fixture. The original limb study uses 0.065. */
        pinHeight?: number
      }
    | number = {},
): GummyMesh {
  if (typeof options === 'number') options = { spacing: options }
  const spacing = options.spacing ?? 0.14
  const pinHeight = options.pinHeight ?? 0.065
  if (!Number.isFinite(pinHeight) || pinHeight < 0 || pinHeight > 0.5)
    throw new RangeError(
      'The gummy lower fixture height must be between 0 and 0.5 metres',
    )
  if (!Number.isFinite(spacing) || spacing < 0.07 || spacing > 0.3)
    throw new RangeError(
      'Gummy mesh spacing must be between 0.07 and 0.3 metres',
    )
  const min: GummyVec3 = [-0.84, -0.035, -0.49]
  const max: GummyVec3 = [0.84, 2.66, 0.63]
  const size = min.map((x, k) => Math.ceil((max[k]! - x) / spacing) + 1)
  const points: GummyVec3[] = []
  const values: number[] = []
  const idAt = (x: number, y: number, z: number) =>
    x + size[0]! * (y + size[1]! * z)
  for (let z = 0; z < size[2]!; z++)
    for (let y = 0; y < size[1]!; y++)
      for (let x = 0; x < size[0]!; x++) {
        const p: GummyVec3 = [
          min[0] + x * spacing,
          min[1] + y * spacing,
          min[2] + z * spacing,
        ]
        points.push(p)
        values.push(gummyBearField(p))
      }
  const edges = new Map<string, number>()
  const sourceTets: Tet[] = []
  const sourceRegions: number[] = []
  const sourceCells: number[] = []
  const cellCenters = new Map<number, GummyVec3>()
  for (let z = 0; z < size[2]! - 1; z++)
    for (let y = 0; y < size[1]! - 1; y++)
      for (let x = 0; x < size[0]! - 1; x++) {
        const corners = [
          idAt(x, y, z),
          idAt(x + 1, y, z),
          idAt(x, y + 1, z),
          idAt(x + 1, y + 1, z),
          idAt(x, y, z + 1),
          idAt(x + 1, y, z + 1),
          idAt(x, y + 1, z + 1),
          idAt(x + 1, y + 1, z + 1),
        ]
        // A tear plane follows whole cell faces. Classifying individual clipped
        // tetrahedra by their centroids can leave pinched, non-manifold edges.
        const center: GummyVec3 = [
          min[0] + (x + 0.5) * spacing,
          min[1] + (y + 0.5) * spacing,
          min[2] + (z + 0.5) * spacing,
        ]
        const region = tearRegion(center)
        const cell = idAt(x, y, z)
        cellCenters.set(cell, center)
        for (const local of CUBE_TETS) {
          const tet = local.map((index) => corners[index]!) as Tet
          const clipped = clipTetrahedron(tet, points, values, edges)
          sourceTets.push(...clipped)
          sourceRegions.push(...clipped.map(() => region))
          sourceCells.push(...clipped.map(() => cell))
        }
      }
  const regions =
    options.fracture === 'fine'
      ? partitionGummyCells(
          sourceTets,
          sourceCells,
          cellCenters,
          sourceTets.map((tet) =>
            tetrahedronVolume(
              points[tet[0]]!,
              points[tet[1]]!,
              points[tet[2]]!,
              points[tet[3]]!,
            ),
          ),
        )
      : options.fracture === 'none'
        ? sourceRegions.map(() => 0)
        : sourceRegions
  const positions: number[] = [],
    normals: number[] = [],
    nodeRegions: number[] = []
  const masses: number[] = []
  const mapped = new Map<string, number>()
  const remap = (source: number, region: number) => {
    const key = `${source}:${region}`
    const found = mapped.get(key)
    if (found !== undefined) return found
    const id = positions.length / 4
    positions.push(...points[source]!, 0)
    normals.push(...fieldNormal(points[source]!), 0)
    nodeRegions.push(region)
    masses.push(0)
    mapped.set(key, id)
    return id
  }
  type FaceRecord = { source: Face; target: Face; region: number }
  const faces = new Map<string, FaceRecord>()
  const interfaces: number[] = [],
    surface: number[] = [],
    tetrahedra: number[] = []
  let restVolume = 0
  for (let tetId = 0; tetId < sourceTets.length; tetId++) {
    const tet = sourceTets[tetId]!
    const region = regions[tetId]!
    const target = tet.map((id) => remap(id, region)) as Tet
    const volume = tetrahedronVolume(
      ...(tet.map((id) => points[id]!) as [
        GummyVec3,
        GummyVec3,
        GummyVec3,
        GummyVec3,
      ]),
    )
    if (volume <= 0)
      throw new Error('Gummy tetrahedron has non-positive volume')
    restVolume += volume
    tetrahedra.push(...target)
    for (const id of target) masses[id]! += volume * 0.25
    for (const corners of TET_FACES) {
      const source = corners.map((i) => tet[i]) as Face
      const face = corners.map((i) => target[i]) as Face
      const key = [...source].sort((a, b) => a - b).join(':')
      const previous = faces.get(key)
      if (previous) {
        faces.delete(key)
        if (previous.region !== region) {
          const interfaceId = interfaces.length / 8
          for (let i = 0; i < 3; i++)
            interfaces.push(
              previous.target[i]!,
              face[source.indexOf(previous.source[i]!)]!,
            )
          interfaces.push(0, 0)
          surface.push(...previous.target, interfaceId, ...face, interfaceId)
        }
      } else faces.set(key, { source, target: face, region })
    }
  }
  for (const face of faces.values()) surface.push(...face.target, EXTERIOR_FACE)
  const averageMass = restVolume / masses.length
  const bounds = {
    min: [Infinity, Infinity, Infinity] as GummyVec3,
    max: [-Infinity, -Infinity, -Infinity] as GummyVec3,
  }
  for (let i = 0; i < masses.length; i++) {
    // Normalized lumped mass avoids extreme inverse masses in clipped slivers.
    positions[i * 4 + 3] =
      options.pinnedFeet !== false && positions[i * 4 + 1]! < pinHeight
        ? 0
        : averageMass / Math.max(masses[i]!, averageMass * 0.1)
    for (let k = 0; k < 3; k++) {
      bounds.min[k] = Math.min(bounds.min[k]!, positions[i * 4 + k]!)
      bounds.max[k] = Math.max(bounds.max[k]!, positions[i * 4 + k]!)
    }
  }
  return {
    positions: new Float32Array(positions),
    tetrahedra: new Uint32Array(tetrahedra),
    interfaces: new Uint32Array(interfaces),
    surface: new Uint32Array(surface),
    restNormals: new Float32Array(normals),
    nodeRegions: new Uint32Array(nodeRegions),
    spacing,
    restVolume,
    bounds,
    demoGrip: GUMMY_DEMO_GRIP,
  }
}
