/** Filled-body transmission, tear shading and optical exit passes. */
import { d, std, tgpu } from 'typegpu'
import { gummyColourAtPoint, gummyVolumeTransmission } from './gummyBands'
import { GUMMY_IOR, gummyEnvironment, gummyFresnel, gummyOpticalPath, gummyUnitNormal, } from './gummyMaterial'
import { gummyExitTag, gummyMatchingExit } from './gummyRuntimeSurfaceMath'
import { gummyCameraLayout, gummyExitFilterLayout, gummySceneLayout, } from './gummyShaderLayouts'
import { gummyTearBody, gummyTearReflection } from './gummyTearMaterial'

export const gummyExitFragment = tgpu.fragmentFn({
  in: { world: d.vec3f, visible: d.f32, rest: d.vec3f, component: d.f32 },
  out: { world: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  // Two exact integer lanes retain identity in rgba16float even beyond2048 fragments.
  const tag = gummyExitTag(input.component)
  return {
    world: d.vec4f(input.world, tag.x),
    rest: d.vec4f(input.rest, tag.y),
  }
})

/** Select the nearest visible component before collecting its back surface. */
export const gummyFrontTagFragment = tgpu.fragmentFn({
  in: { visible: d.f32, component: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  return d.vec4f(gummyExitTag(input.component), 0, 1)
})

/** Other fragments must not replace this pixel's own back exit and optical thickness. */
export const gummyRuntimeExitFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    visible: d.f32,
    rest: d.vec3f,
    component: d.f32,
    pixel: d.builtin.position,
  },
  out: { world: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  const front = std.textureLoad(
    gummyExitFilterLayout.$.fronts,
    d.vec2i(input.pixel.xy),
    0,
  )
  if (!gummyMatchingExit(input.component, front.xy, 1)) std.discard()
  const tag = gummyExitTag(input.component)
  return {
    world: d.vec4f(input.world, tag.x),
    rest: d.vec4f(input.rest, tag.y),
  }
})

/** Diagnostic alpha is zero when the material pass should continue. */
const gummySurfaceDiagnostic = tgpu.fn(
  [d.f32, d.vec3f, d.f32, d.vec3f, d.vec3f, d.vec3f],
  d.vec4f,
)((diagnostic, dye, interior, geometricArea, normal, view) => {
  'use gpu'
  if (diagnostic > 0.5 && diagnostic < 1.5) return d.vec4f(dye, 1)
  if (diagnostic > 1.5 && diagnostic < 2.5) {
    if (interior > 0.5) return d.vec4f(0.01, 0.7, 0.8, 1)
    return d.vec4f(0.8, 0.025, 0.01, 1)
  }
  if (diagnostic > 3.5 && diagnostic < 4.5) {
    let geometric = gummyUnitNormal(geometricArea, normal)
    if (std.dot(geometric, view) < 0) geometric = std.neg(geometric)
    if (std.dot(normal, geometric) < 0) return d.vec4f(1, 0, 1, 1)
    if (std.dot(normal, view) < 0) return d.vec4f(1, 1, 0, 1)
    return d.vec4f(0.015, 0.4, 0.02, 1)
  }
  return d.vec4f(0)
})

const gummyExitDiagnostic = tgpu.fn(
  [d.bool, d.f32, d.f32],
  d.vec4f,
)((matchingExit, exitTag, rayPath) => {
  'use gpu'
  if (matchingExit) return d.vec4f(0.01, 0.7, 0.02, 1)
  if (exitTag <= 0) return d.vec4f(0.01, 0.02, 0.8, 1)
  if (rayPath <= 0) return d.vec4f(0.8, 0.7, 0.01, 1)
  return d.vec4f(0.8, 0.01, 0.02, 1)
})

export const gummyFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    normal: d.vec3f,
    visible: d.f32,
    interior: d.f32,
    pixel: d.builtin.position,
    rest: d.vec3f,
    component: d.f32,
    support: d.f32,
    torn: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const geometricArea = std.cross(std.dpdx(input.world), std.dpdy(input.world))
  if (input.visible < 0.5) std.discard()
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const view = std.normalize(
    std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world),
  )
  const incident = std.neg(view)
  const noV = std.max(std.dot(normal, view), 0.005)
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const noL = std.max(std.dot(normal, light), 0)
  const fresnel = gummyFresnel(noV)
  const reflected = gummyEnvironment(std.reflect(incident, normal))
  const mode = gummyCameraLayout.$.camera.colour.w
  const dye = gummyColourAtPoint(
    input.rest,
    mode,
    gummyCameraLayout.$.camera.colour.xyz,
  )
  const diagnostic = gummyCameraLayout.$.camera.eye.w
  const debugColour = gummySurfaceDiagnostic(
    diagnostic,
    dye,
    input.interior,
    geometricArea,
    normal,
    view,
  )
  if (debugColour.w > 0.5) return debugColour
  if (gummyCameraLayout.$.camera.resolution.z > 0.5) {
    const clay = std.mul(dye, 0.3 + 0.7 * noL)
    return d.vec4f(std.add(clay, std.mul(reflected, fresnel * 0.12)), 1)
  }
  const uv = std.div(input.pixel.xy, gummyCameraLayout.$.camera.resolution.xy)
  const exit = std.textureLoad(
    gummySceneLayout.$.exits,
    d.vec2i(input.pixel.xy),
    0,
  )
  const rayPath = std.dot(std.sub(exit.xyz, input.world), incident)
  const exitRest = std.textureLoad(
    gummySceneLayout.$.restExits,
    d.vec2i(input.pixel.xy),
    0,
  )
  let restEnd = d.vec3f(input.rest)
  const matchingExit = gummyMatchingExit(
    input.component,
    d.vec2f(exit.w, exitRest.w),
    rayPath,
  )
  if (diagnostic > 4.5 && diagnostic < 5.5) {
    return gummyExitDiagnostic(matchingExit, exit.w, rayPath)
  }
  if (matchingExit) restEnd = d.vec3f(exitRest.xyz)
  let thickness = d.f32(0.04)
  if (input.support > 0) thickness = std.clamp(input.support, 0.0001, 2.4)
  if (matchingExit) thickness = std.clamp(rayPath, 0.015, 2.4)
  const inside = std.refract(incident, normal, 1 / GUMMY_IOR)
  // A screen-space approximation: measured body thickness bends a probe through
  // the volume. It cannot reconstruct occluded geometry or multiple ray exits.
  const path = gummyOpticalPath(
    thickness,
    noV,
    std.dot(inside, normal),
    input.interior,
  )
  if (diagnostic > 5.5 && diagnostic < 6.5) {
    const grey = std.clamp(path, 0, 1)
    return d.vec4f(grey, grey, grey, 1)
  }
  const probe = std.add(input.world, std.mul(inside, path))
  const clip = std.mul(
    gummyCameraLayout.$.camera.viewProjection,
    d.vec4f(probe, 1),
  )
  let sampleUv = d.vec2f(uv)
  if (clip.w > 0.001) {
    const projected = std.add(
      std.mul(std.div(clip.xy, clip.w), d.vec2f(0.5, -0.5)),
      d.vec2f(0.5),
    )
    sampleUv = std.clamp(projected, d.vec2f(0.002), d.vec2f(0.998))
  }
  const scene = std.textureSampleLevel(
    gummySceneLayout.$.scene,
    gummySceneLayout.$.sampler,
    sampleUv,
    0,
  ).xyz
  const absorption = gummyVolumeTransmission(
    input.rest,
    restEnd,
    path,
    mode,
    gummyCameraLayout.$.camera.absorption.xyz,
  )
  const transmitted = std.mul(scene, absorption)
  // Soft coloured in-scattering approximates a short diffusion path. The mesh
  // geometry supplies the face and silhouette; this term never changes shape.
  const scattering = std.mul(
    dye,
    (0.035 + 0.09 * noL + 0.06 * std.pow(1 - noV, 2)) *
      (1 - std.exp(-path * 3)),
  )
  let body = std.add(transmitted, scattering)
  // After a crack, inherited skin and new caps meet on the same thin piece.
  // Carry its wet surface pigment across that real adjacency instead of giving
  // the inherited side neutral transmission while its cap remains strongly dyed.
  // This appearance term leaves untouched bulk optics and optical path unchanged.
  if (input.interior < 0.5 && input.torn > 0)
    body = std.mix(body, gummyTearBody(body, dye, noL), input.torn)
  let colour = std.add(std.mul(body, 1 - fresnel), std.mul(reflected, fresnel))
  if (diagnostic > 2.5 && diagnostic < 3.5) colour = d.vec3f(body)
  if (input.interior > 0.5) {
    // Torn gel has a rough, dyed surface, rather than a polished glass cut.
    // This broad reflection and local scattering are an appearance approximation;
    // transmission above still uses the measured volume and material coordinates.
    let roughReflection = std.mix(reflected, gummyEnvironment(normal), 0.65)
    // Runtime cuts have real component metadata. Their rough lobe follows the
    // reflection ray; legacy cohesive caps retain their original material.
    let tornBody = std.mix(body, std.mul(dye, 0.5 + 0.5 * noL), 0.7)
    if (input.component > 0.5) {
      roughReflection = gummyTearReflection(std.reflect(incident, normal))
      tornBody = gummyTearBody(body, dye, noL)
    }
    const roughFresnel = gummyFresnel(0.25 + 0.75 * noV)
    colour = std.add(
      std.mul(tornBody, 1 - roughFresnel),
      std.mul(roughReflection, roughFresnel),
    )
    if (diagnostic > 2.5 && diagnostic < 3.5) colour = d.vec3f(tornBody)
  }
  return d.vec4f(colour, 1)
})
