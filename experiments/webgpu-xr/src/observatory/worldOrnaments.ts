// Closed, opaque ornaments frame the retained fractal cores without replacing their silhouettes.
import type { BookGeometry } from '../almanac/bookAsset'

type Point = readonly [number, number, number]
type World = 'glasswake' | 'tideweave'
interface Material {
  name: string
  color: Point
  roughness: number
  metallic: number
  emission?: number
}
interface Section {
  center: Point
  rim: Point[]
}

const IVORY: Material = {
  name: 'Porcelain crystal',
  color: [0.78, 0.83, 0.78],
  roughness: 0.24,
  metallic: 0.12,
}
const GOLD: Material = {
  name: 'Warm gold facet',
  color: [0.72, 0.43, 0.12],
  roughness: 0.28,
  metallic: 0.72,
}
const BRONZE: Material = {
  name: 'Corona bronze',
  color: [0.35, 0.2, 0.055],
  roughness: 0.36,
  metallic: 0.65,
}
const TEAL: Material = {
  name: 'Tide enamel',
  color: [0.055, 0.53, 0.43],
  roughness: 0.27,
  metallic: 0.28,
}
const COBALT: Material = {
  name: 'Cobalt underside',
  color: [0.035, 0.12, 0.35],
  roughness: 0.34,
  metallic: 0.38,
}
const SEAFOAM: Material = {
  name: 'Seafoam edge',
  color: [0.24, 0.72, 0.62],
  roughness: 0.3,
  metallic: 0.18,
}
const SEAFOAM_SEAM: Material = {
  ...SEAFOAM,
  name: 'Seafoam seam',
  emission: 0.12,
}
const RECTANGLE = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const
// Narrow chamfers catch light without turning the broad face into a bright band.
const BEVELED_RIBBON = [
  [0.7, 1],
  [-0.7, 1],
  [-1, 0.4],
  [-1, -0.4],
  [-0.7, -1],
  [0.7, -1],
  [1, -0.4],
  [1, 0.4],
] as const

const add = (a: Point, b: Point): Point => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]
const subtract = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const scale = (a: Point, amount: number): Point => [
  a[0] * amount,
  a[1] * amount,
  a[2] * amount,
]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const normalize = (a: Point): Point => scale(a, 1 / Math.hypot(...a))
const midpoint = (a: Point, b: Point): Point => scale(add(a, b), 0.5)

class OrnamentMesh {
  private vertices: number[] = []
  private materials = new Set<string>()

  triangle(a: Point, b: Point, c: Point, material: Material, inside: Point) {
    // Each triangle gets its own geometric normal: the crystal facets stay crisp.
    let normal = cross(subtract(b, a), subtract(c, a))
    if (dot(normal, subtract(a, inside)) < 0) {
      const previous = b
      b = c
      c = previous
      normal = scale(normal, -1)
    }
    normal = normalize(normal)
    for (const position of [a, b, c])
      this.vertices.push(
        ...position,
        1,
        ...normal,
        0,
        ...material.color,
        1,
        material.metallic,
        material.roughness,
        material.emission ?? 0,
        1,
      )
    this.materials.add(material.name)
  }

  solid(
    start: Point,
    sections: Section[],
    end: Point,
    palette: readonly Material[],
  ) {
    const sides = sections[0].rim.length
    const first = sections[0]
    const last = sections[sections.length - 1]
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides
      const material = palette[side % palette.length]
      this.triangle(
        start,
        first.rim[side],
        first.rim[next],
        material,
        midpoint(start, first.center),
      )
      for (let index = 1; index < sections.length; index++) {
        const from = sections[index - 1]
        const to = sections[index]
        const inside = midpoint(from.center, to.center)
        this.triangle(
          from.rim[side],
          to.rim[side],
          to.rim[next],
          material,
          inside,
        )
        this.triangle(
          from.rim[side],
          to.rim[next],
          from.rim[next],
          material,
          inside,
        )
      }
      this.triangle(
        last.rim[side],
        end,
        last.rim[next],
        material,
        midpoint(last.center, end),
      )
    }
  }

  finish(): BookGeometry {
    const vertices = new Float32Array(this.vertices)
    const indices = Uint32Array.from(
      { length: vertices.length / 16 },
      (_, index) => index,
    )
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
      materials: [...this.materials],
      bounds: { min, max },
      anchors: {},
    }
  }
}

/** A tapered closed ribbon has actual thickness, including when seen from behind. */
function ribbon(
  mesh: OrnamentMesh,
  path: (t: number) => Point,
  width: number,
  depth: number,
  steps: number,
  twist: number,
  palette: readonly Material[],
  profile: readonly (readonly [number, number])[] = RECTANGLE,
) {
  const sections: Section[] = []
  for (let index = 1; index < steps; index++) {
    const t = index / steps
    const center = path(t)
    const tangent = normalize(subtract(path(t + 0.0001), path(t - 0.0001)))
    const outward = normalize([tangent[1], -tangent[0], 0])
    const front = normalize(cross(outward, tangent))
    const angle = Math.sin(t * Math.PI * 1.6) * twist
    const wide = add(
      scale(outward, Math.cos(angle)),
      scale(front, Math.sin(angle)),
    )
    const thin = add(
      scale(front, Math.cos(angle)),
      scale(outward, -Math.sin(angle)),
    )
    const taper = Math.pow(Math.sin(t * Math.PI), 0.65)
    const rim = profile.map(([w, h]) =>
      add(
        center,
        add(scale(wide, w * width * taper), scale(thin, h * depth * taper)),
      ),
    )
    sections.push({ center, rim })
  }
  mesh.solid(path(0), sections, path(1), palette)
}

function glasswake(mesh: OrnamentMesh) {
  for (let index = 0; index < 6; index++) {
    const angle = Math.PI / 2 + (index * Math.PI) / 3
    const radial: Point = [Math.cos(angle), Math.sin(angle), 0]
    const tangent: Point = [-radial[1], radial[0], 0]
    const z = index % 2 ? -0.055 : 0.055
    const center = (radius: number): Point =>
      add(scale(radial, radius), [0, 0, z])
    const sections = [
      [1.055, 0.065, 0.055],
      [1.145, 0.115, 0.105],
    ].map(([radius, width, depth]) => ({
      center: center(radius),
      rim: Array.from({ length: 6 }, (_, side) => {
        const facet = (side * Math.PI) / 3 + Math.PI / 6
        return add(
          center(radius),
          add(scale(tangent, Math.cos(facet) * width), [
            0,
            0,
            Math.sin(facet) * depth,
          ]),
        )
      }),
    }))
    mesh.solid(center(0.985), sections, center(index % 2 ? 1.39 : 1.47), [
      IVORY,
      GOLD,
      IVORY,
      BRONZE,
      GOLD,
      IVORY,
    ])
    // Separate pointed pieces form a broken corona, never a complete orbital ring.
    for (let shard = 0; shard < 2; shard++) {
      const start = angle + (shard ? 0.77 : 0.23)
      const sweep = shard ? 0.115 : 0.36
      const radius = shard ? 1.19 : 1.12
      ribbon(
        mesh,
        (t) => {
          const theta = start + sweep * t
          return [
            Math.cos(theta) * radius,
            Math.sin(theta) * radius,
            z + Math.sin(t * Math.PI) * 0.035,
          ]
        },
        shard ? 0.026 : 0.035,
        0.018,
        shard ? 5 : 9,
        0.35,
        [GOLD, BRONZE, GOLD, IVORY],
      )
    }
  }
}

function tideweave(mesh: OrnamentMesh) {
  const currents = [
    { start: -2.65, sweep: 3.25, radius: 1.15, z: 0.08, width: 0.083 },
    { start: 0.48, sweep: 2.8, radius: 1.26, z: -0.16, width: 0.065 },
    { start: 3.45, sweep: 2.6, radius: 1.1, z: 0.2, width: 0.052 },
  ]
  currents.forEach((current, index) => {
    ribbon(
      mesh,
      (t) => {
        const theta =
          current.start + current.sweep * t + 0.12 * Math.sin(t * Math.PI * 2)
        const radius =
          current.radius +
          0.09 * Math.sin(t * Math.PI) +
          0.045 * Math.sin(t * Math.PI * 3 + index)
        return [
          Math.cos(theta) * radius * 0.89,
          Math.sin(theta) * radius * 1.08,
          Math.sin(theta * 1.25 + index * 0.6) * 0.4 +
            Math.sin(t * Math.PI * 3) * 0.045 +
            current.z,
        ]
      },
      current.width * 0.7,
      0.015,
      44,
      0.85,
      [
        TEAL,
        SEAFOAM,
        COBALT,
        TEAL,
        COBALT,
        TEAL,
        TEAL,
        index === 0 ? SEAFOAM_SEAM : SEAFOAM,
      ],
      BEVELED_RIBBON,
    )
  })
}

/** Build once per world; the caller owns GPU upload, transforms and disposal. */
export function createWorldOrnaments(world: World): BookGeometry {
  const mesh = new OrnamentMesh()
  if (world === 'glasswake') glasswake(mesh)
  else tideweave(mesh)
  return mesh.finish()
}
