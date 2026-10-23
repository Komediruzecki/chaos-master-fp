/** Projected gummy shadows, caustics and studio compositing. */
import { d, std, tgpu } from 'typegpu'
import { BOARD_TILE_SIZE } from '@/components/PawnBoard/pawnBoardMath'
import { displayColour } from '@/components/PawnBoard/pawnGlassMaterial'
import { gummyAbsorptionAtPoint } from './gummyBands'
import { GUMMY_FLOOR_EXTENT, GUMMY_IOR, gummyEnvironment, gummyTransmission, gummyUnitNormal, } from './gummyMaterial'
import { gummyBoxHit, gummyPressColour, gummyPressRimHit } from './gummyPress'
import { gummyCameraLayout, gummyDisplayLayout, gummyFloorLayout, } from './gummyShaderLayouts'
import { surfaceData } from './gummySurfaceVertex'

const floorOutput = {
  position: d.builtin.position,
  world: d.vec3f,
  normal: d.vec3f,
  visible: d.f32,
  rest: d.vec3f,
}
const floorProjection = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((point, direction) => {
  'use gpu'
  const travel = std.max(point.y, 0.001) / std.max(-direction.y, 0.12)
  return std.add(point, std.mul(direction, travel))
})

export const gummyCausticVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: floorOutput,
})((input) => {
  'use gpu'
  const surface = surfaceData(input.corner)
  const incident = std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26)))
  const normal = gummyUnitNormal(surface.normal, d.vec3f(0, 1, 0))
  const refracted = std.refract(incident, normal, 1 / GUMMY_IOR)
  const floor = floorProjection(surface.world, refracted)
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  let visible = d.f32(surface.visible)
  if (std.dot(normal, std.neg(incident)) < 0.04 || surface.interior > 0.5)
    visible = 0
  if (visible < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    world: surface.world,
    normal,
    visible,
    rest: surface.rest,
  }
})

export const gummyCausticFragment = tgpu.fragmentFn({
  in: { world: d.vec3f, normal: d.vec3f, visible: d.f32, rest: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  // Rasterized area compression measures focusing by the simulated surface.
  // This is a single-interface projection, not a two-interface photon tracer.
  const area = std.length(
    std.cross(std.dpdx(input.world), std.dpdy(input.world)),
  )
  const focusing = std.clamp(
    (area * (512 * 512)) / (4 * GUMMY_FLOOR_EXTENT * GUMMY_FLOOR_EXTENT),
    0,
    8,
  )
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const incident = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const flux = std.max(std.dot(normal, incident), 0)
  const transmission = gummyTransmission(
    gummyAbsorptionAtPoint(
      input.rest,
      gummyCameraLayout.$.camera.colour.w,
      gummyCameraLayout.$.camera.absorption.xyz,
    ),
    0.45,
  )
  return d.vec4f(std.mul(transmission, flux * focusing * 0.055), 0)
})

export const gummyShadowVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex },
  out: floorOutput,
})((input) => {
  'use gpu'
  const surface = surfaceData(input.corner)
  const floor = floorProjection(
    surface.world,
    std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
  )
  let clip = d.vec4f(
    floor.x / GUMMY_FLOOR_EXTENT,
    -floor.z / GUMMY_FLOOR_EXTENT,
    0.5,
    1,
  )
  if (surface.visible < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    world: surface.world,
    normal: surface.normal,
    visible: surface.visible,
    rest: surface.rest,
  }
})
export const gummyShadowFragment = tgpu.fragmentFn({
  in: { visible: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  if (input.visible < 0.5) std.discard()
  return d.vec4f(0, 0, 0, 0.18)
})

export const gummyBackgroundFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: { colour: d.vec4f, depth: d.builtin.fragDepth },
})((input) => {
  'use gpu'
  const ndc = d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1)
  const far = std.mul(gummyCameraLayout.$.camera.inverseViewProjection, ndc)
  const ray = std.normalize(
    std.sub(std.div(far.xyz, far.w), gummyCameraLayout.$.camera.eye.xyz),
  )
  let colour = std.mix(
    d.vec3f(0.68, 0.62, 0.53),
    d.vec3f(0.83, 0.8, 0.74),
    std.smoothstep(-0.2, 0.6, ray.y),
  )
  let depth = d.f32(1)
  if (ray.y < -0.001) {
    const t = -gummyCameraLayout.$.camera.eye.y / ray.y
    if (t > 0) {
      const world = std.add(gummyCameraLayout.$.camera.eye.xyz, std.mul(ray, t))
      const clip = std.mul(
        gummyCameraLayout.$.camera.viewProjection,
        d.vec4f(world, 1),
      )
      depth = std.clamp(clip.z / clip.w, 0, 1)
      const floorUv = std.add(
        std.div(world.xz, 2 * GUMMY_FLOOR_EXTENT),
        d.vec2f(0.5),
      )
      let light = d.vec4f(0)
      if (floorUv.x > 0 && floorUv.x < 1 && floorUv.y > 0 && floorUv.y < 1) {
        for (const x of std.range(-1, 2)) {
          for (const y of std.range(-1, 2)) {
            light = std.add(
              light,
              std.textureSampleLevel(
                gummyFloorLayout.$.light,
                gummyFloorLayout.$.sampler,
                std.add(floorUv, std.mul(d.vec2f(d.f32(x), d.f32(y)), 0.0039)),
                0,
              ),
            )
          }
        }
        light = std.div(light, 9)
      }
      const visibility = 1 - std.clamp(light.w, 0, 0.38)
      let floorColour = d.vec3f(0.72, 0.65, 0.55)
      if (gummyCameraLayout.$.camera.surface.y > 0.5) {
        // Align the inspected piece with a square centre using the board's tile scale.
        const square = std.floor(
          std.add(std.div(world.xz, BOARD_TILE_SIZE), d.vec2f(0.5)),
        )
        if (square.x >= -4 && square.x < 4 && square.y >= -4 && square.y < 4) {
          const alternate = std.fract((square.x + square.y) * 0.5) * 2
          floorColour = std.mix(
            d.vec3f(0.74, 0.7, 0.61),
            d.vec3f(0.13, 0.18, 0.2),
            alternate,
          )
        }
      }
      colour = std.add(
        std.mul(floorColour, visibility),
        std.min(light.xyz, d.vec3f(0.7)),
      )
    }
  }
  const press = gummyCameraLayout.$.camera.press
  if (press.z > 0.5) {
    const hit = gummyPressRimHit(gummyCameraLayout.$.camera.eye.xyz, ray, press)
    if (hit.w >= 0) {
      const world = std.add(
        gummyCameraLayout.$.camera.eye.xyz,
        std.mul(ray, hit.w),
      )
      const clip = std.mul(
        gummyCameraLayout.$.camera.viewProjection,
        d.vec4f(world, 1),
      )
      const plateDepth = clip.z / clip.w
      if (plateDepth >= 0 && plateDepth < depth) {
        depth = plateDepth
        colour = gummyPressColour(hit.xyz, ray)
      }
    }
  }
  return { colour: d.vec4f(colour, 1), depth }
})

export const gummyDisplayFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  let colour = d.vec3f(
    std.textureSampleLevel(
      gummyDisplayLayout.$.scene,
      gummyDisplayLayout.$.sampler,
      input.uv,
      0,
    ).xyz,
  )
  const press = gummyCameraLayout.$.camera.press
  if (press.z > 0.5) {
    const far = std.mul(
      gummyCameraLayout.$.camera.inverseViewProjection,
      d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1),
    )
    const ray = std.normalize(
      std.sub(std.div(far.xyz, far.w), gummyCameraLayout.$.camera.eye.xyz),
    )
    const hit = gummyBoxHit(
      gummyCameraLayout.$.camera.eye.xyz,
      ray,
      d.vec3f(-press.y, press.x, -press.y),
      d.vec3f(press.y, press.x + press.w, press.y),
    )
    if (hit.w >= 0 && std.abs(hit.y) > 0.5) {
      const world = std.add(
        gummyCameraLayout.$.camera.eye.xyz,
        std.mul(ray, hit.w),
      )
      if (
        std.abs(world.x) < press.y - 0.035 &&
        std.abs(world.z) < press.y - 0.035
      ) {
        // A lightly reflecting inspection window; keep the deforming material visible below it.
        const reflection = std.min(
          gummyEnvironment(std.reflect(ray, hit.xyz)),
          d.vec3f(2),
        )
        const fresnel = 0.025 + 0.12 * std.pow(1 - std.abs(ray.y), 5)
        colour = std.mix(
          std.mul(colour, d.vec3f(0.98, 0.995, 1)),
          reflection,
          fresnel,
        )
      }
    }
  }
  return d.vec4f(
    displayColour(colour, gummyCameraLayout.$.camera.resolution.w),
    1,
  )
})
