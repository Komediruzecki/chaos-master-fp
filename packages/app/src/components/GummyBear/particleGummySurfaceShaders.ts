/** Bounded view-ray isodensity reconstruction; absent support is never turned into gel. */
import { d, std, tgpu } from 'typegpu'
import { gummyColourAtPoint } from './gummyBands'
import { gummyCameraLayout } from './gummyShaders'
import { PARTICLE_GUMMY_DENSITY_ISO, particleDensitySurfaceWithFallback, particleKernelDensity, particleKernelNormal, } from './particleGummyMath'
import { particleGummyLayout, particleOpaqueLayout, particleProfileSourceLayout, particleRay, } from './particleGummyShaders'

export const particleSurfaceLayout = tgpu.bindGroupLayout({
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  profileFirst: { texture: d.texture2d(d.f32) },
  profileSecond: { texture: d.texture2d(d.f32) },
  profileFar: { texture: d.texture2d(d.f32) },
})
export const particleNormalSourceLayout = tgpu.bindGroupLayout({
  surface: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
})

export const particleGummySurfaceFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const pixel = d.vec2i(
    std.mul(input.uv, gummyCameraLayout.$.camera.resolution.xy),
  )
  const start = std.textureLoad(particleSurfaceLayout.$.original, pixel, 0).x
  if (start <= 0) return d.vec4f(0)
  const first = std.textureLoad(particleSurfaceLayout.$.profileFirst, pixel, 0)
  const second = std.textureLoad(
    particleSurfaceLayout.$.profileSecond,
    pixel,
    0,
  )
  const far = std.textureLoad(particleSurfaceLayout.$.profileFar, pixel, 0)
  const distance = particleDensitySurfaceWithFallback(
    start,
    particleGummyLayout.$.support.x,
    first,
    second,
    far,
    PARTICLE_GUMMY_DENSITY_ISO,
  )
  return d.vec4f(distance, 0, 0, 1)
})

/** Four extra field samples behind the precise near interval, without substituting empty coverage. */
export const particleGummyFarProfileFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, centre: d.vec3f, rest: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const ray = particleRay(input.pixel.xy)
  const pixel = d.vec2i(input.pixel.xy)
  const start = std.textureLoad(
    particleProfileSourceLayout.$.original,
    pixel,
    0,
  ).x
  if (start <= 0) std.discard()
  const radius = particleGummyLayout.$.support.x
  const profile = d.vec4f(0)
  const opaqueDepth = std.textureLoad(particleOpaqueLayout.$.depth, pixel, 0)
  for (let index = d.u32(0); index < 4; index++) {
    const distance = start + (2 + (d.f32(index + 1) * 2) / 3) * radius
    const world = std.add(camera.eye.xyz, std.mul(ray, distance))
    const clip = std.mul(camera.viewProjection, d.vec4f(world, 1))
    if (clip.z / clip.w <= opaqueDepth) {
      profile[index] = particleKernelDensity(
        std.sub(world, input.centre),
        radius,
        particleGummyLayout.$.support.y,
      )
    }
  }
  return profile
})

/** Gather gradients and transported dye at the visible surface, excluding unrelated material behind it. */
export const particleGummyNormalFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, centre: d.vec3f, rest: d.vec3f },
  out: { normal: d.vec4f, dye: d.vec4f },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const distance = std.textureLoad(
    particleNormalSourceLayout.$.surface,
    d.vec2i(input.pixel.xy),
    0,
  ).x
  if (distance <= 0) std.discard()
  const ray = particleRay(input.pixel.xy)
  const world = std.add(camera.eye.xyz, std.mul(ray, distance))
  const relative = std.sub(world, input.centre)
  const radius = particleGummyLayout.$.support.x
  const weight = particleGummyLayout.$.support.y
  const density = particleKernelDensity(relative, radius, weight)
  if (density <= 0) std.discard()
  const colour = gummyColourAtPoint(
    input.rest,
    camera.colour.w,
    camera.colour.xyz,
  )
  return {
    normal: d.vec4f(particleKernelNormal(relative, radius, weight), 0),
    dye: d.vec4f(std.mul(colour, density), density),
  }
})
