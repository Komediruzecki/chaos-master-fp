/** Two-interface glass transport and board caustic receiver passes. */
import { d, std, tgpu } from 'typegpu'
import { gummyFresnel } from '../GummyBear/gummyMaterial'
import { gummyBoardBevelHit, gummyBoardGlassCastNormal, gummyBoardGlassSupportHit, } from './gummyBoardGlassGeometry'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB } from './gummyBoardGrid'
import { gummyBoardGlassTransmission } from './gummyBoardGridShaders'
import { gummyBoardReceiverLayout, gummyBoardStageLayout, } from './gummyBoardStageLayouts'
import { gummyBoardStudioFloor } from './gummyBoardStageLighting'
import { GUMMY_BOARD_GLASS_FLOOR, GUMMY_BOARD_GLASS_LIGHT_GRID, GUMMY_BOARD_RECEIVER_EXTENT, } from './gummyBoardThemes'

export const GummyBoardGlassPath = d.struct({
  position: d.vec3f,
  direction: d.vec3f,
  transmission: d.vec3f,
  length: d.f32,
  valid: d.f32,
})
/** The exit is intersected after entry refraction. No absorption is assigned to the air gap. */
export const gummyBoardGlassPath = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f],
  GummyBoardGlassPath,
)((point, normal, incident) => {
  'use gpu'
  const result = GummyBoardGlassPath({
    position: d.vec3f(point),
    direction: d.vec3f(0),
    transmission: d.vec3f(0),
    length: 0,
    valid: 0,
  })
  const inside = std.refract(incident, normal, 1 / 1.45)
  if (std.dot(inside, inside) < 0.5) return result
  const origin = std.add(point, std.mul(inside, 0.0005))
  const hit = gummyBoardBevelHit(origin, inside)
  if (hit.w < 0) return result
  result.position = std.add(origin, std.mul(inside, hit.w))
  result.length = hit.w + 0.0005
  const outgoing = std.refract(inside, std.neg(hit.xyz), 1.45)
  // A zero vector denotes total internal reflection; never project it to a receiver.
  if (std.dot(outgoing, outgoing) < 0.5) return result
  result.direction = d.vec3f(outgoing)
  result.transmission = std.mul(
    gummyBoardGlassTransmission(point, normal, result.length),
    (1 - gummyFresnel(std.max(0, std.dot(std.neg(incident), normal)))) *
      (1 - gummyFresnel(std.max(0, std.dot(inside, hit.xyz)))),
  )
  result.valid = 1
  return result
})

const GummyBoardLightRay = d.struct({
  source: d.vec3f,
  floor: d.vec4f,
  energy: d.vec3f,
})
/** Extra samples at the rim resolve the narrow bevel without an expensive full-resolution mesh. */
const gummyBoardGlassLightRay = tgpu.fn(
  [d.vec2f],
  GummyBoardLightRay,
)((grid) => {
  'use gpu'
  const q = std.sub(std.div(grid, GUMMY_BOARD_GLASS_LIGHT_GRID / 2), d.vec2f(1))
  const edge = std.abs(q)
  const horizontal = std.mul(
    std.sign(q),
    std.add(
      std.mul(std.min(std.div(edge, 0.8), d.vec2f(1)), 6.35),
      std.mul(std.max(std.sub(edge, 0.8), d.vec2f(0)), 2.5),
    ),
  )
  const source = d.vec3f(horizontal.x, GUMMY_BOARD_GRID.top, horizontal.y)
  const result = GummyBoardLightRay({
    source,
    floor: d.vec4f(0),
    energy: d.vec3f(0),
  })
  const incident = std.neg(std.normalize(d.vec3f(-0.42, 0.87, 0.26)))
  const origin = std.sub(source, incident)
  const entry = gummyBoardBevelHit(origin, incident)
  if (entry.w < 0) return result
  const point = std.add(origin, std.mul(incident, entry.w))
  const path = gummyBoardGlassPath(
    point,
    gummyBoardGlassCastNormal(point, entry.xyz),
    incident,
  )
  if (path.valid < 0.5 || path.direction.y >= -0.05) return result
  const distance =
    (GUMMY_BOARD_GLASS_FLOOR - path.position.y) / path.direction.y
  if (distance < 0) return result
  result.floor = d.vec4f(
    std.add(path.position, std.mul(path.direction, distance)),
    1,
  )
  result.energy = d.vec3f(path.transmission)
  return result
})

/** Only focused excess belongs over the studio's existing illumination. Fade the
 * unresolved slab rim instead of drawing its projection as a second board. */
export const gummyBoardGlassFocus = tgpu.fn(
  [d.f32, d.vec2f],
  d.f32,
)((gain, source) => {
  'use gpu'
  const edge = std.max(std.abs(source.x), std.abs(source.y))
  const interior =
    1 -
    std.smoothstep(
      GUMMY_BOARD_GRID.halfExtent - 0.3,
      GUMMY_BOARD_SLAB.halfExtent - 0.15,
      edge,
    )
  return std.min(std.max(gain - 1, 0), 3) * interior
})

/** Static board-only two-interface transport. Piece caustics retain their existing approximation. */
export const gummyBoardGlassLightVertex = tgpu.vertexFn({
  in: { vertex: d.builtin.vertexIndex },
  out: { position: d.builtin.position, energy: d.vec3f },
})(({ vertex }) => {
  'use gpu'
  const cell = d.u32(vertex / 6)
  const origin = d.vec2f(
    d.f32(cell % GUMMY_BOARD_GLASS_LIGHT_GRID),
    d.f32(d.u32(cell / GUMMY_BOARD_GLASS_LIGHT_GRID)),
  )
  let a = d.vec2f(origin)
  const b = std.add(origin, d.vec2f(1, 0))
  let c = std.add(origin, d.vec2f(0, 1))
  if (vertex % 6 >= 3) {
    a = std.add(origin, d.vec2f(1, 1))
    c = std.add(origin, d.vec2f(0, 1))
  }
  const ra = gummyBoardGlassLightRay(a)
  const rb = gummyBoardGlassLightRay(b)
  const rc = gummyBoardGlassLightRay(c)
  const incoming = std.abs(
    std.cross(std.sub(rb.source, ra.source), std.sub(rc.source, ra.source)).y,
  )
  const area = std.abs(
    std.cross(
      std.sub(rb.floor.xyz, ra.floor.xyz),
      std.sub(rc.floor.xyz, ra.floor.xyz),
    ).y,
  )
  let ray = GummyBoardLightRay(ra)
  if (vertex % 3 === 1) ray = GummyBoardLightRay(rb)
  if (vertex % 3 === 2) ray = GummyBoardLightRay(rc)
  let clip = d.vec4f(
    ray.floor.x / GUMMY_BOARD_RECEIVER_EXTENT,
    -ray.floor.z / GUMMY_BOARD_RECEIVER_EXTENT,
    0.5,
    1,
  )
  let gain = d.f32(0)
  if (ra.floor.w * rb.floor.w * rc.floor.w > 0.5 && area > 0.000001)
    gain = std.min(incoming / area, 10)
  else clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    energy: std.mul(ray.energy, gummyBoardGlassFocus(gain, ray.source.xz)),
  }
})
export const gummyBoardGlassLightFragment = tgpu.fragmentFn({
  in: { energy: d.vec3f },
  out: d.vec4f,
})(({ energy }) => {
  'use gpu'
  return d.vec4f(energy, 1)
})

/** The map is irradiance on a matte receiver beneath the glass, not a glowing glass texture. */
export const gummyBoardGlassReceiver = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((point) => {
  'use gpu'
  const uv = std.add(
    std.div(point.xz, 2 * GUMMY_BOARD_RECEIVER_EXTENT),
    d.vec2f(0.5),
  )
  let light = d.vec3f(0)
  if (
    gummyBoardStageLayout.$.stage.material.z > 0.5 &&
    uv.x > 0 &&
    uv.x < 1 &&
    uv.y > 0 &&
    uv.y < 1
  )
    light = std.textureSampleLevel(
      gummyBoardReceiverLayout.$.light,
      gummyBoardReceiverLayout.$.sampler,
      uv,
      0,
    ).xyz
  const towardLight = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  if (
    gummyBoardGlassSupportHit(
      std.add(point, std.mul(towardLight, 0.001)),
      towardLight,
    ).w >= 0
  )
    light = std.mul(light, 0.08)
  return std.add(
    gummyBoardStudioFloor(point, 1),
    std.mul(light, d.vec3f(0.045, 0.043, 0.041)),
  )
})
