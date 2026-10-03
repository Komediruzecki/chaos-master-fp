/** Bounded particle-support geometry and mask rules shared by GPU shaders and numerical tests. */
import { d, std, tgpu } from 'typegpu'
import { gummyOpticalPath } from './gummyMaterial'

export const PARTICLE_GUMMY_RADIUS_SCALE = 1.3
export const PARTICLE_GUMMY_FILTER_RADIUS = 12
export const PARTICLE_GUMMY_DENSITY_ISO = 0.28

/** Dimensionless compact density; its volume integral is exactly the represented particle volume. */
export const particleKernelDensity = tgpu.fn(
  [d.vec3f, d.f32, d.f32],
  d.f32,
)((relative, radius, weight) => {
  'use gpu'
  if (radius <= 0) return 0
  const density = std.max(
    1 - std.dot(relative, relative) / (radius * radius),
    0,
  )
  return density * density * (35 / 8) * weight
})

/** Outward negative density gradient. Compact support makes absent particles contribute nothing. */
export const particleKernelNormal = tgpu.fn(
  [d.vec3f, d.f32, d.f32],
  d.vec3f,
)((relative, radius, weight) => {
  'use gpu'
  if (radius <= 0 || std.dot(relative, relative) >= radius * radius)
    return d.vec3f(0)
  const density = 1 - std.dot(relative, relative) / (radius * radius)
  return std.mul(relative, (17.5 * weight * density) / (radius * radius))
})

/** First sampled density crossing; no crossing leaves the original support pixel empty. */
export const particleDensitySurface = tgpu.fn(
  [d.f32, d.f32, d.vec4f, d.vec4f, d.f32],
  d.f32,
)((start, step, first, second, iso) => {
  'use gpu'
  if (start <= 0 || step <= 0 || iso <= 0) return 0
  let previous = d.f32(0)
  for (let index = d.u32(0); index < 8; index++) {
    let value = d.f32(0)
    if (index < 4) value = first[index]!
    else value = second[index - 4]!
    if (value >= iso) {
      if (index === 0) return start
      const fraction = std.clamp(
        (iso - previous) / std.max(value - previous, 0.000001),
        0,
        1,
      )
      return start + (d.f32(index) - 1 + fraction) * step
    }
    previous = value
  }
  return 0
})

/** A sparse nearer support may precede the body; continue a bounded actual-density search behind it. */
export const particleDensitySurfaceWithFallback = tgpu.fn(
  [d.f32, d.f32, d.vec4f, d.vec4f, d.vec4f, d.f32],
  d.f32,
)((start, radius, first, second, far, iso) => {
  'use gpu'
  const near = particleDensitySurface(
    start,
    (2 * radius) / 7,
    first,
    second,
    iso,
  )
  if (near > 0) return near
  if (start <= 0 || radius <= 0 || iso <= 0) return 0
  let previous = d.f32(second.w)
  const step = (2 * radius) / 3
  for (let index = d.u32(0); index < 4; index++) {
    const value = far[index]!
    if (value >= iso) {
      const fraction = std.clamp(
        (iso - previous) / std.max(value - previous, 0.000001),
        0,
        1,
      )
      return start + 2 * radius + (d.f32(index) + fraction) * step
    }
    previous = value
  }
  return 0
})

/** Two consistently wound triangles cover the full square exactly once away from their diagonal. */
export const particleQuadCorner = tgpu.fn(
  [d.u32],
  d.vec2f,
)((id) => {
  'use gpu'
  if (id === 0) return d.vec2f(-1, -1)
  if (id === 1 || id === 4) return d.vec2f(1, -1)
  if (id === 2 || id === 3) return d.vec2f(-1, 1)
  return d.vec2f(1, 1)
})

/** Unit-normalized ray intersections, returning zero when the sphere is behind or missed. */
export const particleSphereInterval = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.vec2f,
)((eye, ray, centre, radius) => {
  'use gpu'
  const delta = std.sub(centre, eye)
  const projected = std.dot(delta, ray)
  const squared =
    radius * radius - (std.dot(delta, delta) - projected * projected)
  if (squared <= 0) return d.vec2f(0)
  const halfChord = std.sqrt(squared)
  const end = projected + halfChord
  if (end <= 0.001) return d.vec2f(0)
  return d.vec2f(std.max(projected - halfChord, 0.001), end)
})

/** Ray integral of a C1 squared compact density, with the same mass as a uniform sphere. */
export const particleSmoothChord = tgpu.fn(
  [d.f32, d.f32, d.f32, d.f32],
  d.f32,
)((halfChord, start, end, radius) => {
  'use gpu'
  if (radius <= 0 || halfChord <= 0 || end <= start) return 0
  const low = std.clamp(start, -halfChord, halfChord)
  const high = std.clamp(end, -halfChord, halfChord)
  if (high <= low) return 0
  const radiusFourth = radius * radius * radius * radius
  const aSquared = halfChord * halfChord
  const lowCubed = low * low * low
  const highCubed = high * high * high
  const lowIntegral =
    (aSquared * aSquared * low -
      (2 * aSquared * lowCubed) / 3 +
      (lowCubed * low * low) / 5) /
    radiusFourth
  const highIntegral =
    (aSquared * aSquared * high -
      (2 * aSquared * highCubed) / 3 +
      (highCubed * high * high) / 5) /
    radiusFourth
  // Integral over the whole sphere of (1-r²/R²)² is 8/35 of uniform volume.
  return std.max(highIntegral - lowIntegral, 0) * (35 / 8)
})

/** Average transported linear dye along occupied kernel support, with a finite empty-ray fallback. */
export const particleMeanDye = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((weighted, path) => {
  'use gpu'
  if (path <= 0.000001) return d.vec3f(0)
  return std.div(weighted, path)
})

/** Open or discontinuous stencil neighbors use an actual support-sphere normal, not a flat facing plane. */
export const particleEdgeNormal = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec4f],
  d.vec3f,
)((reconstructed, analytic, validity) => {
  'use gpu'
  if (
    validity.x >= 0.5 &&
    validity.y >= 0.5 &&
    validity.z >= 0.5 &&
    validity.w >= 0.5
  )
    return d.vec3f(reconstructed)
  if (std.dot(analytic, analytic) <= 0.00000001) return d.vec3f(reconstructed)
  return std.normalize(analytic)
})

/** Filtered normals in the body blend into field normals over the smoothing footprint near a boundary. */
export const particleBoundaryNormal = tgpu.fn(
  [d.vec3f, d.vec3f, d.f32, d.f32],
  d.vec3f,
)((filtered, field, edgeDistance, footprint) => {
  'use gpu'
  if (std.dot(field, field) <= 0.00000001 || footprint <= 0)
    return d.vec3f(filtered)
  const weight = 1 - std.smoothstep(0, footprint, std.max(edgeDistance - 2, 0))
  const normal = std.mix(filtered, std.normalize(field), weight)
  if (std.dot(normal, normal) <= 0.00000001) return d.vec3f(filtered)
  return std.normalize(normal)
})

/** Rounded refracted-chord correction scales only occupied material; empty air remains empty. */
export const particleOpticalScale = tgpu.fn(
  [d.f32, d.f32, d.f32],
  d.f32,
)((occupied, cosineView, cosineInside) => {
  'use gpu'
  if (occupied <= 0.000001) return 0
  return std.clamp(
    gummyOpticalPath(occupied, cosineView, cosineInside, 0) / occupied,
    0.25,
    4,
  )
})

/** A missing centre stays missing; neighbors across a world-scale depth gap are rejected. */
export const particleDepthWeight = tgpu.fn(
  [d.f32, d.f32, d.f32, d.f32, d.f32],
  d.f32,
)((centre, neighbor, offset, spatialSigma, worldRange) => {
  'use gpu'
  if (centre <= 0 || neighbor <= 0 || worldRange <= 0) return 0
  const difference = std.abs(neighbor - centre)
  if (difference > worldRange) return 0
  const sigma = std.max(spatialSigma, 0.5)
  return (
    std.exp((-0.5 * offset * offset) / (sigma * sigma)) *
    std.exp((-2 * difference * difference) / (worldRange * worldRange))
  )
})

/** A sphere kernel integrates to its represented particle volume, independent of overlap. */
export function particleVolumeWeight(spacing: number, radius: number): number {
  if (
    !Number.isFinite(spacing) ||
    !Number.isFinite(radius) ||
    spacing <= 0 ||
    radius <= 0
  )
    throw new Error(
      'Particle spacing and support radius must be finite and positive',
    )
  return spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
}
