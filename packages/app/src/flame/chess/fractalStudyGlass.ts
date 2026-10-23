/** Thin, closed glass display envelopes fitted around unchanged native fractal samples. */
import type { ChessCandidateRole } from './chessCandidate'

type Vec3 = readonly [number, number, number]
type Ring = { x: number; y: number; z: number; radius: number }

const RADIAL_SEGMENTS = 48
const PROFILE_RINGS = 14
const CAP_RINGS = 6
const WALL = 0.018
const CLEARANCE = 0.025

export function getFractalStudyGlassRole(
  collectionId: string,
): ChessCandidateRole | undefined {
  if (collectionId === 'wild-canopy') return 'knight'
  if (collectionId === 'tidal-relics') return 'bishop'
  if (collectionId === 'lattice-court') return 'rook'
  return undefined
}

function boundsOf(points: Float32Array) {
  if (points.length === 0 || points.length % 4 !== 0)
    throw new RangeError('Glass fitting requires nonempty packed xyzw samples')
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let n = 0; n < points.length; n += 4)
    for (let axis = 0; axis < 3; axis++) {
      const value = points[n + axis]!
      if (!Number.isFinite(value))
        throw new RangeError('Glass samples must have finite positions')
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
  return { min, max }
}

function perimeter(aspect: number, square: boolean): Vec3[] {
  const power = square ? 0.55 : 1
  const curve = (value: number) => Math.sign(value) * Math.abs(value) ** power
  return Array.from({ length: RADIAL_SEGMENTS }, (_, index) => {
    const angle = (index / RADIAL_SEGMENTS) * Math.PI * 2
    return [curve(Math.cos(angle)), 0, curve(Math.sin(angle)) * aspect]
  })
}

/** Exact support planes of the faceted ring, rather than its ideal ellipse. */
function ringScale(x: number, z: number, shape: readonly Vec3[]) {
  let scale = 0
  for (let index = 0; index < shape.length; index++) {
    const a = shape[index]!
    const b = shape[(index + 1) % shape.length]!
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    scale = Math.max(scale, (dz * x - dx * z) / (dz * a[0] - dx * a[2]))
  }
  return scale
}

function fittedProfile(
  points: Float32Array,
  role: ChessCandidateRole,
  shape: readonly Vec3[],
  aspect: number,
  min: number[],
  max: number[],
) {
  const middleX = (min[0]! + max[0]!) / 2
  const middleZ = (min[2]! + max[2]!) / 2
  const low = min[1]! - 0.035
  const high = max[1]! + 0.035
  const step = (high - low) / (PROFILE_RINGS - 1)
  const rings: Ring[] = Array.from({ length: PROFILE_RINGS }, (_, index) => {
    return {
      x: middleX,
      y: low + index * step,
      z: middleZ,
      radius: 0.06,
    }
  })
  // Centre the envelope on the complete silhouette. A density-weighted or
  // independently shifted ring axis can double a rare frond's overhang when
  // its required radius is smoothed into the neighbouring height bands.
  const padding = CLEARANCE / Math.min(1, aspect)
  for (let n = 0; n < points.length; n += 4) {
    const band = Math.min(
      PROFILE_RINGS - 2,
      Math.max(0, Math.floor((points[n + 1]! - low) / step)),
    )
    // A sample is enclosed at BOTH ends of its vertical band. Convexity then
    // encloses it in every interpolated cross-section, including mesh facets.
    for (const index of [band, band + 1]) {
      const ring = rings[index]!
      ring.radius = Math.max(
        ring.radius,
        ringScale(points[n]! - ring.x, points[n + 2]! - ring.z, shape) +
          padding,
      )
    }
  }
  // Smooth only outward and locally. Dividing a global amplitude by a narrow
  // authored foot can inflate the entire shell far beyond its board square.
  // This local envelope cannot exceed the largest radius actually required.
  const required = rings.map((ring) => ring.radius)
  for (let index = 0; index < rings.length; index++)
    rings[index]!.radius = Math.max(
      ...required.map((radius, source) => {
        if (role === 'rook') return radius
        const distance = (index - source) / 3.5
        return radius * Math.exp(-0.5 * distance * distance)
      }),
    )
  if (role !== 'rook') {
    // The upper hull fills inward waists without growing past the existing
    // maximum radius. Its decreasing slopes give the lens one continuous
    // convex shoulder instead of separate inflated lobes.
    const hull: number[] = []
    for (let index = 0; index < rings.length; index++) {
      while (hull.length >= 2) {
        const a = hull.at(-2)!
        const b = hull.at(-1)!
        const before = (rings[b]!.radius - rings[a]!.radius) / (b - a)
        const after = (rings[index]!.radius - rings[b]!.radius) / (index - b)
        if (before > after) break
        hull.pop()
      }
      hull.push(index)
    }
    for (let segment = 0; segment < hull.length - 1; segment++) {
      const from = hull[segment]!
      const to = hull[segment + 1]!
      const start = rings[from]!.radius
      const end = rings[to]!.radius
      for (let index = from + 1; index < to; index++)
        rings[index]!.radius =
          start + ((end - start) * (index - from)) / (to - from)
    }
  }
  const bottom = rings[0]!
  const top = rings.at(-1)!
  const capHeight = role === 'rook' ? 0.09 : role === 'bishop' ? 0.24 : 0.21
  return [
    ...Array.from({ length: CAP_RINGS }, (_, index) => {
      const angle = ((index / CAP_RINGS) * Math.PI) / 2
      return {
        ...bottom,
        y: low - 0.035 * Math.cos(angle),
        radius: bottom.radius * Math.sin(angle),
      }
    }),
    ...rings,
    ...Array.from({ length: CAP_RINGS }, (_, index) => {
      const angle = (((index + 1) / CAP_RINGS) * Math.PI) / 2
      return {
        ...top,
        y: high + capHeight * Math.sin(angle),
        radius: index === CAP_RINGS - 1 ? 0 : top.radius * Math.cos(angle),
      }
    }),
  ]
}

function surface(
  profile: readonly Ring[],
  shape: readonly Vec3[],
  inward: boolean,
) {
  const positions: Vec3[] = []
  const ringIndices = profile.map((ring) => {
    if (ring.radius === 0) {
      const index = positions.length
      positions.push([ring.x, ring.y, ring.z])
      return Array<number>(shape.length).fill(index)
    }
    return shape.map((p) => {
      positions.push([
        ring.x + p[0] * ring.radius,
        ring.y,
        ring.z + p[2] * ring.radius,
      ])
      return positions.length - 1
    })
  })
  const normals = positions.map(() => [0, 0, 0])
  const faces: number[][] = []
  for (let band = 0; band < profile.length - 1; band++) {
    for (let radial = 0; radial < shape.length; radial++) {
      const next = (radial + 1) % shape.length
      const corners = [
        ringIndices[band]![radial]!,
        ringIndices[band + 1]![radial]!,
        ringIndices[band + 1]![next]!,
        ringIndices[band]![next]!,
      ]
      for (const triangle of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const indices = triangle.map((index) => corners[index]!)
        if (new Set(indices).size !== 3) continue
        if (inward) indices.reverse()
        const [a, b, c] = indices.map((index) => positions[index]!) as [
          Vec3,
          Vec3,
          Vec3,
        ]
        const ab = b.map((value, axis) => value - a[axis]!)
        const ac = c.map((value, axis) => value - a[axis]!)
        const normal = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ]
        for (const index of indices)
          for (let axis = 0; axis < 3; axis++)
            normals[index]![axis] = normals[index]![axis]! + normal[axis]!
        faces.push(indices)
      }
    }
  }
  const unitNormals = normals.map((normal) => {
    const length = Math.hypot(...normal)
    return normal.map((value) => value / length)
  })
  return faces.flatMap((indices) =>
    indices.flatMap((index) => [...positions[index]!, ...unitNormals[index]!]),
  )
}

/** Packed xyzw samples stay untouched; only the separate glass envelope is fitted. */
export function buildFractalStudyGlass(
  collectionId: string,
  points: Float32Array,
): { vertices: Float32Array; radius: number } {
  const role = getFractalStudyGlassRole(collectionId)
  if (role === undefined) throw new RangeError('Unknown glass study collection')
  const { min, max } = boundsOf(points)
  const aspect = Math.min(
    1.1,
    Math.max(0.4, (max[2]! - min[2]!) / Math.max(0.1, max[0]! - min[0]!)),
  )
  const shape = perimeter(aspect, role === 'rook')
  const inner = fittedProfile(points, role, shape, aspect, min, max)
  const outer = inner.map((ring, index) => ({
    ...ring,
    radius: ring.radius === 0 ? 0 : ring.radius + WALL / Math.min(1, aspect),
    y:
      index === 0
        ? ring.y - WALL
        : index === inner.length - 1
          ? ring.y + WALL
          : ring.y,
  }))
  const vertices = new Float32Array([
    ...surface(outer, shape, false),
    ...surface(inner, shape, true),
  ])
  let radius = 0
  for (let offset = 0; offset < vertices.length; offset += 6)
    radius = Math.max(
      radius,
      Math.hypot(vertices[offset]!, vertices[offset + 2]!),
    )
  return { vertices, radius }
}
