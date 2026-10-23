/** Board background ray tracing, floor lighting and selection overlay. */
import { d, std, tgpu } from 'typegpu'
import { gummyBoxHit } from '../GummyBear/gummyPress'
import { gummyCameraLayout, gummyFloorLayout, } from '../GummyBear/gummyShaderLayouts'
import { gummyBoardBevelHit, gummyBoardGlassSupportHit, gummyBoardGlassSupportMaterial, } from './gummyBoardGlassGeometry'
import { gummyBoardGlassReceiver } from './gummyBoardGlassOptics'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB } from './gummyBoardGrid'
import { gummyBoardStageLayout } from './gummyBoardStageLayouts'
import { gummyBoardStageLighting, gummyBoardStudioFloor, } from './gummyBoardStageLighting'
import { gummyBoardStageMaterial } from './gummyBoardStageMaterial'
import { GUMMY_BOARD_GLASS_FLOOR, GUMMY_BOARD_LIGHT_EXTENT, } from './gummyBoardThemes'

/** Sample the piece light footprint only on the playable top surface. */
const gummyBoardTopLight = tgpu.fn(
  [d.vec3f],
  d.vec4f,
)((world) => {
  'use gpu'
  let light = d.vec4f(0)
  const uv = std.add(
    std.div(world.xz, 2 * GUMMY_BOARD_LIGHT_EXTENT),
    d.vec2f(0.5),
  )
  if (uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1) {
    for (const x of std.range(-1, 2)) {
      for (const y of std.range(-1, 2)) {
        light = std.add(
          light,
          std.textureSampleLevel(
            gummyFloorLayout.$.light,
            gummyFloorLayout.$.sampler,
            std.add(
              uv,
              std.div(
                d.vec2f(d.f32(x), d.f32(y)),
                d.vec2f(std.textureDimensions(gummyFloorLayout.$.light)),
              ),
            ),
            0,
          ),
        )
      }
    }
    light = std.div(light, 9)
  }
  return light
})

/** Theme backdrop and floor base before the ray reaches board geometry. */
const gummyBoardBackdrop = tgpu.fn(
  [d.f32, d.f32],
  d.struct({ colour: d.vec3f, base: d.vec3f }),
)((theme, rayY) => {
  'use gpu'
  let colour = std.mix(
    d.vec3f(0.61, 0.57, 0.51),
    d.vec3f(0.82, 0.79, 0.73),
    std.smoothstep(-0.2, 0.6, rayY),
  )
  let base = d.vec3f(0.64, 0.59, 0.5)
  if (theme > 0.5) {
    colour = std.mix(
      d.vec3f(0.02, 0.027, 0.03),
      d.vec3f(0.062, 0.069, 0.07),
      std.smoothstep(-0.2, 0.6, rayY),
    )
    base = d.vec3f(0.022, 0.03, 0.031)
    if (theme > 1.5) base = d.vec3f(0.03, 0.022, 0.016)
  }
  return { colour, base }
})

export const gummyBoardBackgroundFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: { colour: d.vec4f, depth: d.builtin.fragDepth },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const theme = gummyBoardStageLayout.$.stage.material.x
  const far = std.mul(
    camera.inverseViewProjection,
    d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1),
  )
  const ray = std.normalize(std.sub(std.div(far.xyz, far.w), camera.eye.xyz))
  const backdrop = gummyBoardBackdrop(theme, ray.y)
  let colour = d.vec3f(backdrop.colour)
  let base = d.vec3f(backdrop.base)
  let depth = d.f32(1)
  let distance = d.f32(-1)
  let boardTop = d.bool(false)
  let boardHit = d.bool(false)
  let floorHeight = d.f32(GUMMY_BOARD_SLAB.bottom)
  if (theme > 0.5 && theme < 1.5) floorHeight = GUMMY_BOARD_GLASS_FLOOR
  if (ray.y < -0.001) distance = (floorHeight - camera.eye.y) / ray.y
  let box = gummyBoxHit(
    camera.eye.xyz,
    ray,
    d.vec3f(
      -GUMMY_BOARD_SLAB.halfExtent,
      GUMMY_BOARD_SLAB.bottom,
      -GUMMY_BOARD_SLAB.halfExtent,
    ),
    d.vec3f(
      GUMMY_BOARD_SLAB.halfExtent,
      GUMMY_BOARD_GRID.top,
      GUMMY_BOARD_SLAB.halfExtent,
    ),
  )
  if (theme > 0.5) box = gummyBoardBevelHit(camera.eye.xyz, ray)
  if (box.w >= 0 && (distance < 0 || box.w < distance)) {
    distance = box.w
    boardHit = true
    const point = std.add(camera.eye.xyz, std.mul(ray, distance))
    boardTop = box.y > 0.99
    base = gummyBoardStageMaterial(
      point,
      box.xyz,
      ray,
      theme,
      gummyBoardStageLayout.$.stage.material.y,
    )
  }
  if (theme > 0.5 && theme < 1.5) {
    const foot = gummyBoardGlassSupportHit(camera.eye.xyz, ray)
    if (foot.w >= 0 && (distance < 0 || foot.w < distance)) {
      distance = foot.w
      boardHit = true
      boardTop = false
      base = gummyBoardGlassSupportMaterial(foot.xyz, ray)
    }
  }
  if (distance > 0) {
    const world = std.add(camera.eye.xyz, std.mul(ray, distance))
    if (theme > 0.5 && !boardHit) {
      base = gummyBoardStudioFloor(world, theme)
      if (theme < 1.5) base = gummyBoardGlassReceiver(world)
    }
    const clip = std.mul(camera.viewProjection, d.vec4f(world, 1))
    depth = std.clamp(clip.z / clip.w, 0, 1)
    let light = d.vec4f(0)
    if (boardTop) light = gummyBoardTopLight(world)
    colour = gummyBoardStageLighting(base, light, theme)
    const selection = gummyBoardStageLayout.$.stage.selection
    if (boardTop && selection.w > 0.5) {
      const ring =
        1 -
        std.smoothstep(
          0.018,
          0.038,
          std.abs(std.length(std.sub(world.xz, selection.xy)) - selection.z),
        )
      colour = std.mix(colour, d.vec3f(0.3, 0.9, 0.83), ring * 0.7)
    }
  }
  return { colour: d.vec4f(colour, 1), depth }
})
