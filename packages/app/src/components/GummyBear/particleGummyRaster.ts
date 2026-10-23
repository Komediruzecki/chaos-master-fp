/** Sphere support rasterization, optical density and particle shadows. */
import { d, std, tgpu } from 'typegpu'
import { gummyAbsorptionAtPoint } from './gummyBands'
import { GUMMY_FLOOR_EXTENT, gummyUnitNormal } from './gummyMaterial'
import { gummyCameraLayout } from './gummyShaderLayouts'
import { particleGummyLayout, particleOpaqueLayout, particleProfileSourceLayout, } from './particleGummyLayouts'
import { particleKernelDensity, particleQuadCorner, particleSmoothChord, particleSphereInterval, } from './particleGummyMath'
import { particleRay, projectedDepth } from './particleGummyProjection'

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
