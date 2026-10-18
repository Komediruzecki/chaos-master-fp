// A finite, authored threshold assembled from both worlds; no lore or gameplay is implied.
import type { BookGeometry } from '../almanac/bookAsset'

type Point = readonly [number, number, number]
type Color = readonly [number, number, number]
export interface TemplePresentation {
  active: boolean
  progress: number
  revealed: boolean
}
export interface TempleStats {
  renderedParts: number
  totalParts: number
  visibleTriangles: number
  connectionSegments: number
  sealLit: boolean
}
export const EMPTY_TEMPLE: TemplePresentation = {
  active: false,
  progress: 0,
  revealed: false,
}
export const TEMPLE_CENTER: Point = [0, 0, -12]
export const TEMPLE_SEAL: Point = [0, 2.15, -11.72]
export const TEMPLE_WORLD_PLACEMENTS = {
  glasswake: { center: [-3.7, 2.45, -11] as Point, scale: 0.85 },
  tideweave: { center: [3.7, 2.45, -11] as Point, scale: 0.76 },
} as const
export const EMPTY_TEMPLE_STATS: TempleStats = {
  renderedParts: 0,
  totalParts: 0,
  visibleTriangles: 0,
  connectionSegments: 0,
  sealLit: false,
}

export function copyTemple(value: TemplePresentation): TemplePresentation {
  return {
    active: value.active,
    progress: Number.isFinite(value.progress)
      ? Math.max(0, Math.min(1, value.progress))
      : 0,
    revealed: value.revealed,
  }
}

interface Material {
  color: Color
  metal: number
  roughness: number
  emission: number
}
const STONE: Material = {
  color: [0.24, 0.3, 0.38],
  metal: 0.12,
  roughness: 0.54,
  emission: 0.04,
}
const EDGE: Material = {
  color: [0.65, 0.68, 0.63],
  metal: 0.32,
  roughness: 0.3,
  emission: 0.02,
}
const GOLD: Material = {
  color: [0.92, 0.58, 0.19],
  metal: 0.65,
  roughness: 0.28,
  emission: 0.18,
}
const TEAL: Material = {
  color: [0.13, 0.66, 0.59],
  metal: 0.32,
  roughness: 0.3,
  emission: 0.18,
}
const PALE: Material = {
  color: [0.72, 0.88, 0.81],
  metal: 0.38,
  roughness: 0.3,
  emission: 0.12,
}

// The mesh stores actual closed rectangular solids with flat face normals. All
// stretches happen before upload, so the existing shader needs no normal-matrix change.
class TempleMesh {
  private vertices: number[] = []
  private indices: number[] = []
  private materials = new Set<string>()

  beam(
    from: Point,
    to: Point,
    width: number,
    depth: number,
    material: Material,
  ) {
    const delta = to.map((value, index) => value - from[index])
    const length = Math.hypot(...delta)
    const tangent = delta.map((value) => value / length)
    const side: Point =
      Math.abs(tangent[1]) > 0.99 ? [1, 0, 0] : [tangent[1], -tangent[0], 0]
    const sideLength = Math.hypot(...side)
    const u = side.map((value) => value / sideLength)
    const v = [
      tangent[1] * u[2] - tangent[2] * u[1],
      tangent[2] * u[0] - tangent[0] * u[2],
      tangent[0] * u[1] - tangent[1] * u[0],
    ]
    const corners = [from, to].flatMap((point) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) =>
        point.map(
          (value, axis) =>
            value + (u[axis] * x * width) / 2 + (v[axis] * y * depth) / 2,
        ),
      ),
    )
    const center = from.map((value, index) => (value + to[index]) / 2)
    for (const face of [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ]) {
      let points = face.map((index) => corners[index])
      const a = points[1].map((value, index) => value - points[0][index])
      const b = points[2].map((value, index) => value - points[0][index])
      let n = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
      if (
        n.reduce(
          (sum, value, axis) => sum + value * (points[0][axis] - center[axis]),
          0,
        ) < 0
      ) {
        points = points.reverse()
        n = n.map((value) => -value)
      }
      const normalLength = Math.hypot(...n)
      n = n.map((value) => value / normalLength)
      const first = this.vertices.length / 16
      for (const point of points)
        this.vertices.push(
          ...point,
          1,
          ...n,
          0,
          ...material.color,
          1,
          material.metal,
          material.roughness,
          material.emission,
          1,
        )
      this.indices.push(
        first,
        first + 1,
        first + 2,
        first,
        first + 2,
        first + 3,
      )
    }
    this.materials.add(
      material === GOLD
        ? 'Glasswake gold'
        : material === TEAL
          ? 'Tideweave enamel'
          : 'Threshold stone and silver',
    )
  }

  path(points: Point[], width: number, depth: number, material: Material) {
    for (let index = 1; index < points.length; index++)
      this.beam(points[index - 1], points[index], width, depth, material)
  }

  ring(
    radius: number,
    y: number,
    z: number,
    width: number,
    material: Material,
    count = 48,
    phase = 0,
  ) {
    this.path(
      Array.from({ length: count + 1 }, (_, index): Point => {
        const angle = phase + (index / count) * Math.PI * 2
        return [Math.cos(angle) * radius, y + Math.sin(angle) * radius, z]
      }),
      width,
      width,
      material,
    )
  }

  finish(): BookGeometry {
    const vertices = new Float32Array(this.vertices)
    const indices = new Uint32Array(this.indices)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let offset = 0; offset < vertices.length; offset += 16)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertices[offset + axis])
        max[axis] = Math.max(max[axis], vertices[offset + axis])
      }
    return {
      vertices,
      indices,
      triangles: indices.length / 3,
      bytes: vertices.byteLength + indices.byteLength,
      bounds: { min, max },
      materials: [...this.materials],
      anchors: {},
    }
  }
}

export interface TemplePart {
  id: string
  start: number
  geometry: BookGeometry
  kind: 'stone' | 'glasswake' | 'tideweave' | 'seal'
}

/** A recognizable open doorway: tiered threshold, paired ribs and a suspended two-world seal. */
export function createTempleParts(): TemplePart[] {
  const parts: TemplePart[] = []
  const add = (
    id: string,
    start: number,
    kind: TemplePart['kind'],
    build: (mesh: TempleMesh) => void,
  ) => {
    const mesh = new TempleMesh()
    build(mesh)
    parts.push({ id, start, kind, geometry: mesh.finish() })
  }
  add('threshold', 0, 'stone', (mesh) => {
    for (let step = 0; step < 5; step++) {
      const y = 0.06 + step * 0.105
      const half = 2.15 - step * 0.16
      const z = 1.05 - step * 0.31
      mesh.beam([-half, y, z], [half, y, z], 0.105, 0.7, STONE)
      mesh.beam(
        [-half, y + 0.054, z + 0.34],
        [half, y + 0.054, z + 0.34],
        0.018,
        0.024,
        EDGE,
      )
    }
  })
  for (const sign of [-1, 1]) {
    const kind = sign < 0 ? 'glasswake' : 'tideweave'
    const material = sign < 0 ? GOLD : TEAL
    add(`${kind}-pier`, sign < 0 ? 0.09 : 0.27, 'stone', (mesh) => {
      for (let rib = 0; rib < 3; rib++) {
        const x = sign * (1.35 + rib * 0.16)
        const z = -rib * 0.23
        mesh.beam([x, 0.44, z], [x, 2.63 - rib * 0.12, z], 0.13, 0.19, STONE)
        mesh.beam(
          [x - sign * 0.07, 0.51, z + 0.1],
          [x - sign * 0.07, 2.62 - rib * 0.12, z + 0.1],
          0.018,
          0.022,
          material,
        )
      }
    })
    add(`${kind}-vault`, sign < 0 ? 0.44 : 0.54, 'stone', (mesh) => {
      for (let rib = 0; rib < 3; rib++) {
        const z = -rib * 0.23
        const path: Point[] = [
          [sign * (1.35 + rib * 0.16), 2.63 - rib * 0.12, z],
          [sign * (1.13 + rib * 0.1), 3.26 + rib * 0.12, z],
          [sign * 0.58, 3.83 + rib * 0.13, z],
          [0, 4.23 + rib * 0.13, z],
        ]
        mesh.path(path, 0.13, 0.19, STONE)
        mesh.path(
          path.map(([x, y, depth]): Point => [x, y, depth + 0.105]),
          0.02,
          0.025,
          material,
        )
      }
    })
  }
  add('radial-inscription', 0.15, 'glasswake', (mesh) => {
    mesh.ring(0.72, 2.15, 0.31, 0.024, GOLD, 36)
    for (let ray = 0; ray < 12; ray++) {
      const angle = (ray / 12) * Math.PI * 2
      mesh.beam(
        [Math.cos(angle) * 0.79, 2.15 + Math.sin(angle) * 0.79, 0.31],
        [
          Math.cos(angle) * (ray % 2 ? 0.89 : 0.99),
          2.15 + Math.sin(angle) * (ray % 2 ? 0.89 : 0.99),
          0.31,
        ],
        0.025,
        0.04,
        GOLD,
      )
    }
  })
  add('branching-inscription', 0.32, 'tideweave', (mesh) => {
    for (const sign of [-1, 1]) {
      mesh.path(
        [
          [sign * 0.09, 1.14, 0.28],
          [sign * 0.38, 1.39, 0.29],
          [sign * 0.51, 1.68, 0.3],
          [sign * 0.46, 2, 0.3],
        ],
        0.025,
        0.035,
        TEAL,
      )
      mesh.path(
        [
          [sign * 0.38, 1.39, 0.29],
          [sign * 0.69, 1.39, 0.3],
          [sign * 0.91, 1.59, 0.29],
        ],
        0.02,
        0.03,
        TEAL,
      )
      mesh.path(
        [
          [sign * 0.51, 1.68, 0.3],
          [sign * 0.29, 1.84, 0.31],
          [sign * 0.24, 2.08, 0.31],
        ],
        0.02,
        0.03,
        TEAL,
      )
    }
  })
  add('sevenfold-crown', 0.69, 'stone', (mesh) => {
    for (let index = 0; index < 7; index++) {
      const angle = Math.PI * 0.18 + (index / 6) * Math.PI * 0.64
      mesh.beam(
        [Math.cos(angle) * 2.02, 2.54 + Math.sin(angle) * 2.02, -0.35],
        [Math.cos(angle) * 2.13, 2.54 + Math.sin(angle) * 2.13, -0.35],
        0.055,
        0.09,
        index < 3 ? GOLD : index > 3 ? TEAL : PALE,
      )
    }
  })
  add('joined-seal', 0.88, 'seal', (mesh) => {
    mesh.ring(0.49, 2.15, 0.33, 0.03, PALE, 6, Math.PI / 6)
    mesh.ring(0.26, 2.15, 0.36, 0.021, PALE, 6, Math.PI / 6)
    mesh.path(
      [
        [-0.16, 2.15, 0.37],
        [0, 2.32, 0.37],
        [0.16, 2.15, 0.37],
        [0, 1.98, 0.37],
        [-0.16, 2.15, 0.37],
      ],
      0.024,
      0.035,
      PALE,
    )
  })
  return parts
}

export interface TempleConnection {
  id: string
  world: 'glasswake' | 'tideweave'
  start: number
  geometry: BookGeometry
}
export function createTempleConnections(): TempleConnection[] {
  const result: TempleConnection[] = []
  for (const world of ['glasswake', 'tideweave'] as const) {
    const sign = world === 'glasswake' ? -1 : 1
    for (let index = 0; index < 10; index++) {
      const at = (t: number): Point => [
        sign * (2.58 - t * 1.56),
        2.45 - Math.sin(t * Math.PI) * 0.32 - t * 0.3,
        0.9 - t * 0.58,
      ]
      const mesh = new TempleMesh()
      mesh.beam(
        at(index / 10),
        at((index + 0.76) / 10),
        0.016,
        0.026,
        world === 'glasswake' ? GOLD : TEAL,
      )
      result.push({
        id: `${world}-connection-${index}`,
        world,
        start: (world === 'glasswake' ? 0 : 0.27) + index * 0.025,
        geometry: mesh.finish(),
      })
    }
  }
  return result
}

/** Motion-off reveals the static architecture at once; color remains useful teaching feedback. */
export function templePartVisible(
  part: TemplePart,
  state: TemplePresentation,
  motion: boolean,
) {
  return (
    state.active && (!motion || state.revealed || state.progress >= part.start)
  )
}
