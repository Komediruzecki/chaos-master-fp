/** Filled-volume gummy absorption and a warm, glossy studio illumination field. */
import { d, std, tgpu } from 'typegpu'

export type GummyPalette =
  | 'blue'
  | 'amber'
  | 'berry'
  | 'candy'
  | 'lagoon'
  | 'marble'
export const GUMMY_IOR = 1.45
export const GUMMY_FLOOR_EXTENT = 3
export const GUMMY_LIGHT = [-0.42, 0.87, 0.26] as const
export const GUMMY_MATERIALS = {
  blue: { absorption: [5.8, 1.45, 0.25], colour: [0.006, 0.26, 0.64] },
  amber: { absorption: [0.12, 0.8, 3.5], colour: [0.85, 0.27, 0.025] },
  berry: { absorption: [0.4, 3.8, 1.1], colour: [0.67, 0.025, 0.18] },
} as const

/** Beer–Lambert through the entire filled body, with no hollow-shell term. */
export const gummyTransmission = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((absorption, path) => {
  'use gpu'
  return std.exp(std.mul(absorption, -std.max(path, 0)))
})

export const gummyFresnel = tgpu.fn(
  [d.f32],
  d.f32,
)((cosine) => {
  'use gpu'
  const ratio = (GUMMY_IOR - 1) / (GUMMY_IOR + 1)
  const f0 = ratio * ratio
  return f0 + (1 - f0) * std.pow(1 - std.clamp(cosine, 0, 1), 5)
})

/** Local spherical-chord approximation for rounded body surfaces; tear caps stay planar.
 * This retains dye at grazing angles without reconstructing a second refracted hit. */
export const gummyOpticalPath = tgpu.fn(
  [d.f32, d.f32, d.f32, d.f32],
  d.f32,
)((chord, cosineView, cosineInside, interior) => {
  'use gpu'
  const cosV = std.max(cosineView, 0.005)
  const cosT = std.max(std.abs(cosineInside), 0.15)
  let path = (chord * cosT) / std.max(cosV, 0.18)
  if (interior > 0.5) path = (chord * cosV) / cosT
  return std.clamp(path, 0.01, 2.4)
})

const lightCard = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec2f],
  d.f32,
)((direction, centre, size) => {
  'use gpu'
  const forward = std.normalize(centre)
  const right = std.normalize(std.cross(forward, d.vec3f(0, 1, 0)))
  const up = std.cross(right, forward)
  const facing = std.dot(direction, forward)
  const coordinate = std.abs(
    std.div(
      d.vec2f(std.dot(direction, right), std.dot(direction, up)),
      std.max(facing, 0.001),
    ),
  )
  const feather = std.add(std.mul(size, 0.5), d.vec2f(0.025))
  const edge = std.smoothstep(
    std.sub(size, feather),
    std.add(size, feather),
    coordinate,
  )
  return (1 - edge.x) * (1 - edge.y) * std.smoothstep(0, 0.1, facing)
})

export const gummyEnvironment = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((direction) => {
  'use gpu'
  const sky = std.smoothstep(-0.2, 0.85, direction.y)
  let light = std.mix(d.vec3f(0.1, 0.075, 0.06), d.vec3f(0.16, 0.2, 0.28), sky)
  light = std.add(
    light,
    std.mul(
      d.vec3f(5.8, 5.2, 4.2),
      lightCard(direction, d.vec3f(-0.55, 0.62, 0.55), d.vec2f(0.13, 0.55)),
    ),
  )
  light = std.add(
    light,
    std.mul(
      d.vec3f(2.8, 3.4, 4.5),
      lightCard(direction, d.vec3f(0.76, 0.33, -0.52), d.vec2f(0.065, 0.75)),
    ),
  )
  light = std.add(
    light,
    std.mul(
      d.vec3f(1.2, 1.25, 1.3),
      lightCard(direction, d.vec3f(-0.1, 0.92, -0.3), d.vec2f(0.28, 0.18)),
    ),
  )
  light = std.add(
    light,
    std.mul(
      d.vec3f(9, 7.2, 4.5),
      lightCard(direction, d.vec3f(0.28, 0.79, 0.55), d.vec2f(0.027, 0.035)),
    ),
  )
  return std.add(
    light,
    std.mul(
      d.vec3f(6.5, 5.2, 3.3),
      lightCard(direction, d.vec3f(-0.2, 0.83, 0.52), d.vec2f(0.025, 0.032)),
    ),
  )
})

/** Avoid normalizing degenerate triangles after a large deformation or tear. */
export const gummyUnitNormal = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((vector, fallback) => {
  'use gpu'
  const magnitude = std.dot(vector, vector)
  if (magnitude > 0.0000000001)
    return std.mul(vector, std.inverseSqrt(magnitude))
  const fallbackMagnitude = std.dot(fallback, fallback)
  if (fallbackMagnitude > 0.0000000001)
    return std.mul(fallback, std.inverseSqrt(fallbackMagnitude))
  return d.vec3f(0, 1, 0)
})
