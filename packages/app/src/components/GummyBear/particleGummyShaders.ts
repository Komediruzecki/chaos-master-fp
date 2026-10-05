/** Native particle-support surface: analytic spheres, masked depth smoothing and linear HDR optics. */
import { d, std, tgpu } from 'typegpu'
import { gummyAbsorptionAtPoint } from './gummyBands'
import { GUMMY_FLOOR_EXTENT, GUMMY_IOR, gummyEnvironment, gummyFresnel, gummyUnitNormal, } from './gummyMaterial'
import { gummyCameraLayout } from './gummyShaders'
import { PARTICLE_GUMMY_FILTER_RADIUS, particleBoundaryNormal, particleDepthWeight, particleKernelDensity, particleMeanDye, particleOpticalScale, particleQuadCorner, particleSmoothChord, particleSphereInterval, } from './particleGummyMath'

export const particleGummyLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  support: { uniform: d.vec4f }, // radius, volume normalization, world depth range, maximum filter radius
})
export const particleOpaqueLayout = tgpu.bindGroupLayout({
  depth: { texture: d.textureDepth2d() },
})
export const particleProfileSourceLayout = tgpu.bindGroupLayout({
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
})
export const particleFilterLayout = tgpu.bindGroupLayout({
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  source: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
})
export const particleCompositeLayout = tgpu.bindGroupLayout({
  depth: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  normal: { texture: d.texture2d(d.f32) },
  optical: { texture: d.texture2d(d.f32) },
  dye: { texture: d.texture2d(d.f32) },
  scene: { texture: d.texture2d(d.f32) },
  sceneDepth: { texture: d.textureDepth2d() },
  sampler: { sampler: 'filtering' },
})

export const particleRay = tgpu.fn(
  [d.vec2f],
  d.vec3f,
)((pixel) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const uv = std.div(pixel, camera.resolution.xy)
  const far = std.mul(
    camera.inverseViewProjection,
    d.vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 1, 1),
  )
  return gummyUnitNormal(
    std.sub(std.div(far.xyz, far.w), camera.eye.xyz),
    d.vec3f(0, 0, -1),
  )
})

const projectedDepth = tgpu.fn(
  [d.vec3f],
  d.f32,
)((world) => {
  'use gpu'
  const clip = std.mul(
    gummyCameraLayout.$.camera.viewProjection,
    d.vec4f(world, 1),
  )
  return clip.z / clip.w
})

/** A projected camera-aligned box encloses the sphere, including off-axis perspective. */
export const particleGummyVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, centre: d.vec3f, rest: d.vec3f },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const centre = particleGummyLayout.$.positions[input.instance]!.xyz
  const radius = particleGummyLayout.$.support.x
  const right = gummyUnitNormal(
    camera.inverseViewProjection.columns[0].xyz,
    d.vec3f(1, 0, 0),
  )
  const up = gummyUnitNormal(
    camera.inverseViewProjection.columns[1].xyz,
    d.vec3f(0, 1, 0),
  )
  const forward = particleRay(std.mul(camera.resolution.xy, 0.5))
  const front = std.mul(
    camera.viewProjection,
    d.vec4f(std.sub(centre, std.mul(forward, radius)), 1),
  )
  const back = std.mul(
    camera.viewProjection,
    d.vec4f(std.add(centre, std.mul(forward, radius)), 1),
  )
  const extent = std.add(
    std.abs(
      std.mul(camera.viewProjection, d.vec4f(std.mul(right, radius), 0)).xy,
    ),
    std.abs(std.mul(camera.viewProjection, d.vec4f(std.mul(up, radius), 0)).xy),
  )
  const frontW = std.max(front.w, 0.001)
  const backW = std.max(back.w, 0.001)
  const minimum = std.min(
    std.div(std.sub(front.xy, extent), frontW),
    std.div(std.sub(back.xy, extent), backW),
  )
  const maximum = std.max(
    std.div(std.add(front.xy, extent), frontW),
    std.div(std.add(back.xy, extent), backW),
  )
  const corner = particleQuadCorner(input.vertex)
  const ndc = std.mix(
    minimum,
    maximum,
    std.add(std.mul(corner, 0.5), d.vec2f(0.5)),
  )
  return {
    position: d.vec4f(ndc, 0, 1),
    centre,
    rest: particleGummyLayout.$.restPositions[input.instance]!.xyz,
  }
})

export const particleGummyDepthFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, centre: d.vec3f, rest: d.vec3f },
  out: { distance: d.vec4f, depth: d.builtin.fragDepth },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const ray = particleRay(input.pixel.xy)
  const interval = particleSphereInterval(
    camera.eye.xyz,
    ray,
    input.centre,
    particleGummyLayout.$.support.x,
  )
  if (interval.y <= 0) std.discard()
  const world = std.add(camera.eye.xyz, std.mul(ray, interval.x))
  const depth = projectedDepth(world)
  const opaque = std.textureLoad(
    particleOpaqueLayout.$.depth,
    d.vec2i(input.pixel.xy),
    0,
  )
  if (depth < 0 || depth > 1 || depth > opaque) std.discard()
  return {
    distance: d.vec4f(interval.x, 0, 0, 1),
    depth,
  }
})

/** Add optical depths, rather than using the empty air between front and rear blobs as gel. */
export const particleGummyOpticalFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, centre: d.vec3f, rest: d.vec3f },
  out: {
    optical: d.vec4f,
    profileFirst: d.vec4f,
    profileSecond: d.vec4f,
  },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const ray = particleRay(input.pixel.xy)
  const interval = particleSphereInterval(
    camera.eye.xyz,
    ray,
    input.centre,
    particleGummyLayout.$.support.x,
  )
  if (interval.y <= 0) std.discard()
  const opaqueDepth = std.textureLoad(
    particleOpaqueLayout.$.depth,
    d.vec2i(input.pixel.xy),
    0,
  )
  const uv = std.div(input.pixel.xy, camera.resolution.xy)
  const opaque = std.mul(
    camera.inverseViewProjection,
    d.vec4f(uv.x * 2 - 1, 1 - uv.y * 2, opaqueDepth, 1),
  )
  const opaqueDistance = std.dot(
    std.sub(std.div(opaque.xyz, opaque.w), camera.eye.xyz),
    ray,
  )
  const radius = particleGummyLayout.$.support.x
  const relative = std.sub(input.centre, camera.eye.xyz)
  const projected = std.dot(relative, ray)
  const impactSquared = std.max(
    std.dot(relative, relative) - projected * projected,
    0,
  )
  const halfChord = std.sqrt(std.max(radius * radius - impactSquared, 0))
  const path =
    particleSmoothChord(
      halfChord,
      interval.x - projected,
      std.min(interval.y, opaqueDistance) - projected,
      radius,
    ) * particleGummyLayout.$.support.y
  const absorption = gummyAbsorptionAtPoint(
    input.rest,
    camera.colour.w,
    camera.absorption.xyz,
  )
  const start = std.textureLoad(
    particleProfileSourceLayout.$.original,
    d.vec2i(input.pixel.xy),
    0,
  ).x
  const profileFirst = d.vec4f(0)
  const profileSecond = d.vec4f(0)
  // Eight shared ray positions cover two support radii behind the nearest raw sphere front.
  for (let index = d.u32(0); index < 8; index++) {
    const sampleDistance = start + (d.f32(index) * 2 * radius) / 7
    let density = d.f32(0)
    if (start > 0 && sampleDistance <= opaqueDistance) {
      density = particleKernelDensity(
        std.sub(
          std.add(camera.eye.xyz, std.mul(ray, sampleDistance)),
          input.centre,
        ),
        radius,
        particleGummyLayout.$.support.y,
      )
    }
    if (index < 4) profileFirst[index] = density
    else profileSecond[index - 4] = density
  }
  return {
    optical: d.vec4f(std.mul(absorption, path), path),
    profileFirst,
    profileSecond,
  }
})

const filterPixel = tgpu.fn(
  [d.vec2f, d.vec2i],
  d.vec4f,
)((uv, direction) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const pixel = d.vec2i(std.mul(uv, camera.resolution.xy))
  const originalCentre = std.textureLoad(
    particleFilterLayout.$.original,
    pixel,
    0,
  ).x
  if (originalCentre <= 0) return d.vec4f(0)
  const centre = std.textureLoad(particleFilterLayout.$.source, pixel, 0).x
  if (centre <= 0) return d.vec4f(originalCentre, 0, 0, 1)
  const worldRange = particleGummyLayout.$.support.z
  const cameraUp = gummyUnitNormal(
    camera.inverseViewProjection.columns[1].xyz,
    d.vec3f(0, 1, 0),
  )
  const projectionScale = std.length(
    std.mul(camera.viewProjection, d.vec4f(cameraUp, 0)).xy,
  )
  const pixelRadius = std.clamp(
    (2 *
      particleGummyLayout.$.support.x *
      projectionScale *
      camera.resolution.y) /
      (2 * centre),
    1,
    particleGummyLayout.$.support.w,
  )
  let total = d.f32(0)
  let weighted = d.f32(0)
  for (
    let offset = d.i32(-PARTICLE_GUMMY_FILTER_RADIUS);
    offset <= PARTICLE_GUMMY_FILTER_RADIUS;
    offset++
  ) {
    if (std.abs(d.f32(offset)) > pixelRadius) continue
    const neighborPixel = std.add(pixel, std.mul(direction, offset))
    if (
      neighborPixel.x < 0 ||
      neighborPixel.y < 0 ||
      neighborPixel.x >= d.i32(camera.resolution.x) ||
      neighborPixel.y >= d.i32(camera.resolution.y)
    )
      continue
    const original = std.textureLoad(
      particleFilterLayout.$.original,
      neighborPixel,
      0,
    ).x
    const source = std.textureLoad(
      particleFilterLayout.$.source,
      neighborPixel,
      0,
    ).x
    // The original depth guards separate layers; iterative weights follow the smoothed surface.
    if (original <= 0 || std.abs(original - originalCentre) > worldRange)
      continue
    const weight = particleDepthWeight(
      centre,
      source,
      d.f32(offset),
      pixelRadius * 0.65,
      worldRange,
    )
    if (source <= 0 || std.abs(source - centre) > worldRange) continue
    weighted += source * weight
    total += weight
  }
  if (total <= 0) return d.vec4f(centre, 0, 0, 1)
  // Correct grid-scale noise, without moving the compact surface into the old empty envelope.
  const displacement = particleGummyLayout.$.support.x * 0.2
  return d.vec4f(
    std.clamp(
      weighted / total,
      originalCentre - displacement,
      originalCentre + displacement,
    ),
    0,
    0,
    1,
  )
})

export const particleGummyFilterHorizontal = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  return filterPixel(input.uv, d.vec2i(1, 0))
})
export const particleGummyFilterVertical = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  return filterPixel(input.uv, d.vec2i(0, 1))
})

const surfacePoint = tgpu.fn(
  [d.vec2i, d.f32],
  d.vec4f,
)((pixel, fallback) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  if (
    pixel.x < 0 ||
    pixel.y < 0 ||
    pixel.x >= d.i32(camera.resolution.x) ||
    pixel.y >= d.i32(camera.resolution.y)
  )
    return d.vec4f(
      std.add(
        camera.eye.xyz,
        std.mul(particleRay(std.add(d.vec2f(pixel), d.vec2f(0.5))), fallback),
      ),
      0,
    )
  const original = std.textureLoad(
    particleCompositeLayout.$.original,
    pixel,
    0,
  ).x
  const depth = std.textureLoad(particleCompositeLayout.$.depth, pixel, 0).x
  let distance = d.f32(fallback)
  let valid = d.f32(0)
  if (
    original > 0 &&
    depth > 0 &&
    std.abs(depth - fallback) <= particleGummyLayout.$.support.z
  ) {
    distance = depth
    valid = 1
  }
  return d.vec4f(
    std.add(
      camera.eye.xyz,
      std.mul(particleRay(std.add(d.vec2f(pixel), d.vec2f(0.5))), distance),
    ),
    valid,
  )
})

/** Bounded cardinal probes estimate how far smoothing can see an empty or discontinuous surface. */
const particleBoundaryDistance = tgpu.fn(
  [d.vec2i, d.f32],
  d.f32,
)((pixel, centre) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  let nearest = d.f32(PARTICLE_GUMMY_FILTER_RADIUS + 2)
  for (let index = d.u32(0); index < 4; index++) {
    let offset = d.i32(2)
    if (index === 1) offset = 4
    if (index === 2) offset = 8
    if (index === 3) offset = 12
    for (let direction = d.u32(0); direction < 4; direction++) {
      let delta = d.vec2i(offset, 0)
      if (direction === 1) delta = d.vec2i(-offset, 0)
      if (direction === 2) delta = d.vec2i(0, offset)
      if (direction === 3) delta = d.vec2i(0, -offset)
      const probe = std.add(pixel, delta)
      let empty = false
      if (
        probe.x < 0 ||
        probe.y < 0 ||
        probe.x >= d.i32(camera.resolution.x) ||
        probe.y >= d.i32(camera.resolution.y)
      )
        empty = true
      else {
        const mask = std.textureLoad(
          particleCompositeLayout.$.original,
          probe,
          0,
        ).x
        const depth = std.textureLoad(
          particleCompositeLayout.$.depth,
          probe,
          0,
        ).x
        if (
          mask <= 0 ||
          depth <= 0 ||
          std.abs(depth - centre) > particleGummyLayout.$.support.z
        )
          empty = true
      }
      if (empty) nearest = std.min(nearest, d.f32(offset))
    }
  }
  return nearest
})

export const particleGummyComposite = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const pixel = d.vec2i(std.mul(input.uv, camera.resolution.xy))
  const background = std.textureSampleLevel(
    particleCompositeLayout.$.scene,
    particleCompositeLayout.$.sampler,
    input.uv,
    0,
  ).xyz
  const distance = std.textureLoad(particleCompositeLayout.$.depth, pixel, 0).x
  const original = std.textureLoad(
    particleCompositeLayout.$.original,
    pixel,
    0,
  ).x
  if (distance <= 0 || original <= 0) return d.vec4f(background, 1)
  const ray = particleRay(std.add(d.vec2f(pixel), d.vec2f(0.5)))
  const world = std.add(camera.eye.xyz, std.mul(ray, distance))
  const opaqueDepth = std.textureLoad(
    particleCompositeLayout.$.sceneDepth,
    pixel,
    0,
  )
  if (projectedDepth(world) > opaqueDepth) return d.vec4f(background, 1)
  // A two-pixel stencil avoids reintroducing per-particle highlights after depth smoothing.
  const left = surfacePoint(std.sub(pixel, d.vec2i(2, 0)), distance)
  const right = surfacePoint(std.add(pixel, d.vec2i(2, 0)), distance)
  const above = surfacePoint(std.sub(pixel, d.vec2i(0, 2)), distance)
  const below = surfacePoint(std.add(pixel, d.vec2i(0, 2)), distance)
  let normal = gummyUnitNormal(
    std.cross(std.sub(right.xyz, left.xyz), std.sub(below.xyz, above.xyz)),
    std.neg(ray),
  )
  // Align both normals before blending; the depth cross product can have opposite winding.
  if (std.dot(normal, std.neg(ray)) < 0) normal = std.neg(normal)
  let field = d.vec3f(
    std.textureLoad(particleCompositeLayout.$.normal, pixel, 0).xyz,
  )
  if (std.dot(field, std.neg(ray)) < 0) field = std.neg(field)
  normal = particleBoundaryNormal(
    normal,
    field,
    particleBoundaryDistance(pixel, distance),
    PARTICLE_GUMMY_FILTER_RADIUS,
  )
  if (camera.resolution.z > 0.5) {
    const diffuse = std.max(
      std.dot(normal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
      0,
    )
    return d.vec4f(std.mul(d.vec3f(0.59, 0.5, 0.4), 0.45 + diffuse * 0.55), 1)
  }
  const optical = std.textureLoad(particleCompositeLayout.$.optical, pixel, 0)
  const dye = std.textureLoad(particleCompositeLayout.$.dye, pixel, 0)
  const colour = particleMeanDye(dye.xyz, dye.w)
  const noV = std.max(std.dot(std.neg(ray), normal), 0)
  const fresnel = gummyFresnel(noV)
  let refracted = std.refract(ray, normal, 1 / GUMMY_IOR)
  if (std.dot(refracted, refracted) < 0.00001) refracted = d.vec3f(ray)
  const opticalScale = particleOpticalScale(
    optical.w,
    noV,
    std.dot(refracted, normal),
  )
  const occupiedPath = optical.w * opticalScale
  const transmission = std.exp(
    std.neg(std.min(std.mul(optical.xyz, opticalScale), d.vec3f(24))),
  )
  const projected = std.mul(
    camera.viewProjection,
    d.vec4f(std.add(world, std.mul(refracted, std.min(occupiedPath, 0.8))), 1),
  )
  const refractedUv = d.vec2f(
    (projected.x / projected.w) * 0.5 + 0.5,
    0.5 - (projected.y / projected.w) * 0.5,
  )
  let transmittedScene = d.vec3f(background)
  if (
    projected.w > 0 &&
    refractedUv.x >= 0 &&
    refractedUv.y >= 0 &&
    refractedUv.x <= 1 &&
    refractedUv.y <= 1
  )
    transmittedScene = std.textureSampleLevel(
      particleCompositeLayout.$.scene,
      particleCompositeLayout.$.sampler,
      refractedUv,
      0,
    ).xyz
  const reflected = std.min(
    gummyEnvironment(std.reflect(ray, normal)),
    d.vec3f(5),
  )
  const noL = std.max(
    std.dot(normal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
    0,
  )
  const scatter =
    (0.035 + 0.09 * noL + 0.06 * (1 - noV) * (1 - noV)) *
    (1 - std.exp(-occupiedPath * 3))
  const body = std.add(
    std.mul(transmittedScene, transmission),
    std.mul(colour, scatter),
  )
  return d.vec4f(
    std.add(std.mul(body, 1 - fresnel), std.mul(reflected, fresnel)),
    1,
  )
})

export const particleGummyShadowVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, corner: d.vec2f, weight: d.f32 },
})((input) => {
  'use gpu'
  const centre = particleGummyLayout.$.positions[input.instance]!.xyz
  const radius = particleGummyLayout.$.support.x
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const projected = std.sub(
    centre.xz,
    std.mul(light.xz, std.max(centre.y, 0) / light.y),
  )
  const softRadius = radius + std.max(centre.y, 0) * 0.07
  const corner = particleQuadCorner(input.vertex)
  const world = std.add(projected, std.mul(corner, softRadius * 2))
  return {
    position: d.vec4f(
      world.x / GUMMY_FLOOR_EXTENT,
      -world.y / GUMMY_FLOOR_EXTENT,
      0,
      1,
    ),
    corner,
    weight:
      (particleGummyLayout.$.support.y * radius * radius) /
      (softRadius * softRadius),
  }
})

export const particleGummyShadowFragment = tgpu.fragmentFn({
  in: { corner: d.vec2f, weight: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const squared = std.dot(input.corner, input.corner)
  if (squared > 1) std.discard()
  return d.vec4f(0, 0, 0, std.exp(-squared * 4) * input.weight * 0.13)
})
