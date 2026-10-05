/** World-space MPM surface optics with the nearest exit, carried dye and smooth field normals. */
import { d, std, tgpu } from 'typegpu'
import { gummyColourAtPoint, gummyVolumeTransmission } from './gummyBands'
import { GUMMY_IOR, gummyEnvironment, gummyFresnel, gummyOpticalPath, gummyUnitNormal, } from './gummyMaterial'
import { gummyCameraLayout } from './gummyShaders'
import { MarchingGummyVertex } from './marchingGummySurfaceShaders'

export const marchingGummyMeshLayout = tgpu.bindGroupLayout({
  vertices: { storage: d.arrayOf(MarchingGummyVertex) },
})
export const marchingGummyOpaqueLayout = tgpu.bindGroupLayout({
  depth: { texture: d.textureDepth2d() },
})
export const marchingGummyFrontLayout = tgpu.bindGroupLayout({
  front: { texture: d.texture2d(d.f32) },
})
export const marchingGummyCompositeLayout = tgpu.bindGroupLayout({
  front: { texture: d.texture2d(d.f32) },
  rest: { texture: d.texture2d(d.f32) },
  exit: { texture: d.texture2d(d.f32) },
  scene: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})

const surfaceVaryings = { world: d.vec3f, normal: d.vec3f, rest: d.vec3f }
export const marchingGummyVertex = tgpu.vertexFn({
  in: { id: d.builtin.vertexIndex },
  out: { position: d.builtin.position, ...surfaceVaryings },
})((input) => {
  'use gpu'
  const vertex = marchingGummyMeshLayout.$.vertices[input.id]!
  return {
    position: std.mul(
      gummyCameraLayout.$.camera.viewProjection,
      d.vec4f(vertex.position.xyz, 1),
    ),
    world: d.vec3f(vertex.position.xyz),
    normal: d.vec3f(vertex.normal.xyz),
    rest: d.vec3f(vertex.rest.xyz),
  }
})

export const marchingGummyFrontFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, ...surfaceVaryings },
  out: { front: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  const towardEye = std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world)
  if (std.dot(input.normal, towardEye) <= 0) std.discard()
  const opaque = std.textureLoad(
    marchingGummyOpaqueLayout.$.depth,
    d.vec2i(input.pixel.xy),
    0,
  )
  if (input.pixel.z > opaque) std.discard()
  return {
    front: d.vec4f(
      gummyUnitNormal(input.normal, towardEye),
      std.length(towardEye),
    ),
    rest: d.vec4f(input.rest, 1),
  }
})

/** The nearest back-facing hit after the front avoids counting a gap to a distant blob as jelly. */
export const marchingGummyExitFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, ...surfaceVaryings },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const towardEye = std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world)
  const front = std.textureLoad(
    marchingGummyFrontLayout.$.front,
    d.vec2i(input.pixel.xy),
    0,
  )
  const distance = std.length(towardEye)
  if (
    front.w <= 0 ||
    std.dot(input.normal, towardEye) >= 0 ||
    distance < front.w - 0.004
  )
    std.discard()
  return d.vec4f(input.rest, distance)
})

/** The workbench uses its camera material; instanced scenes may select optics by surface identity. */
export const MarchingGummyMaterial = d.struct({
  absorption: d.vec4f,
  colour: d.vec4f,
  absorptionTint: d.vec3f,
  scale: d.f32,
})
export const marchingGummyMaterialSlot = tgpu.slot<
  (identity: number) => d.InferGPU<typeof MarchingGummyMaterial>
>(() => {
  'use gpu'
  return MarchingGummyMaterial({
    absorption: gummyCameraLayout.$.camera.absorption,
    colour: gummyCameraLayout.$.camera.colour,
    absorptionTint: d.vec3f(1),
    scale: 1,
  })
})

export const marchingGummyComposite = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const pixel = d.vec2i(std.mul(input.uv, camera.resolution.xy))
  const background = std.textureSampleLevel(
    marchingGummyCompositeLayout.$.scene,
    marchingGummyCompositeLayout.$.sampler,
    input.uv,
    0,
  ).xyz
  const front = std.textureLoad(marchingGummyCompositeLayout.$.front, pixel, 0)
  if (front.w <= 0) return d.vec4f(background, 1)
  const far = std.mul(
    camera.inverseViewProjection,
    d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1),
  )
  const ray = std.normalize(std.sub(std.div(far.xyz, far.w), camera.eye.xyz))
  const world = std.add(camera.eye.xyz, std.mul(ray, front.w))
  const normal = gummyUnitNormal(front.xyz, std.neg(ray))
  const noL = std.max(
    std.dot(normal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
    0,
  )
  if (camera.resolution.z > 0.5)
    return d.vec4f(std.mul(d.vec3f(0.59, 0.5, 0.4), 0.45 + 0.55 * noL), 1)
  const restSample = std.textureLoad(
    marchingGummyCompositeLayout.$.rest,
    pixel,
    0,
  )
  const rest = restSample.xyz
  const material = marchingGummyMaterialSlot.$(restSample.w)
  const exit = std.textureLoad(marchingGummyCompositeLayout.$.exit, pixel, 0)
  let exitRest = d.vec3f(rest)
  let chord = d.f32(camera.absorption.w * material.scale * 0.5)
  if (exit.w >= front.w) {
    exitRest = d.vec3f(exit.xyz)
    chord = std.max(
      exit.w - front.w,
      camera.absorption.w * material.scale * 0.1,
    )
  }
  const noV = std.max(std.dot(std.neg(ray), normal), 0)
  const refracted = std.refract(ray, normal, 1 / GUMMY_IOR)
  const path = gummyOpticalPath(chord, noV, std.dot(refracted, normal), 0)
  const transmission = std.pow(
    gummyVolumeTransmission(
      rest,
      exitRest,
      path,
      material.colour.w,
      material.absorption.xyz,
    ),
    material.absorptionTint,
  )
  const projected = std.mul(
    camera.viewProjection,
    d.vec4f(std.add(world, std.mul(refracted, std.min(path, 0.8))), 1),
  )
  const uv = d.vec2f(
    (projected.x / projected.w) * 0.5 + 0.5,
    0.5 - (projected.y / projected.w) * 0.5,
  )
  let behind = d.vec3f(background)
  if (projected.w > 0 && uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1)
    behind = std.textureSampleLevel(
      marchingGummyCompositeLayout.$.scene,
      marchingGummyCompositeLayout.$.sampler,
      uv,
      0,
    ).xyz
  const colour = gummyColourAtPoint(
    rest,
    material.colour.w,
    material.colour.xyz,
  )
  const scatter =
    (0.045 + 0.12 * noL + 0.06 * (1 - noV) * (1 - noV)) *
    (1 - std.exp(-path * 3))
  const body = std.add(std.mul(behind, transmission), std.mul(colour, scatter))
  const reflection = std.min(
    gummyEnvironment(std.reflect(ray, normal)),
    d.vec3f(5),
  )
  const fresnel = gummyFresnel(noV)
  return d.vec4f(
    std.add(std.mul(body, 1 - fresnel), std.mul(reflection, fresnel)),
    1,
  )
})
