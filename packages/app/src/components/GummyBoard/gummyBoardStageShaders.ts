/** Beveled glass transport and a recessed molten/crust material on the shared chess slab. */
import { hash, perlin2d, rotl, scrambleSeed2, u32To01F32 } from '@typegpu/noise'
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment, gummyFresnel } from '../GummyBear/gummyMaterial'
import { gummyBoxHit } from '../GummyBear/gummyPress'
import { gummyCameraLayout, gummyFloorLayout } from '../GummyBear/gummyShaders'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB } from './gummyBoardGrid'
import { gummyBoardGlassInset, gummyBoardGlassTransmission, gummyBoardGridContains, gummyBoardSquareParity, } from './gummyBoardGridShaders'
import { GUMMY_BOARD_GLASS_FLOOR, GUMMY_BOARD_GLASS_LIGHT_GRID, GUMMY_BOARD_LIGHT_EXTENT, GUMMY_BOARD_RECEIVER_EXTENT, } from './gummyBoardThemes'

export { gummyBoardSquareParity } from './gummyBoardGridShaders'

export const GummyBoardStage = d.struct({
  /** World x/z centre, radius and visibility. */
  selection: d.vec4f,
  /** Theme code, material time in seconds, caustics enabled, reserved. */
  material: d.vec4f,
})
export const gummyBoardStageLayout = tgpu.bindGroupLayout({
  stage: { uniform: GummyBoardStage },
})
export const gummyBoardReceiverLayout = tgpu.bindGroupLayout({
  light: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})

export const gummyBoardSquareColour = tgpu.fn(
  [d.vec2f],
  d.vec3f,
)((point) => {
  'use gpu'
  return std.mix(
    d.vec3f(0.76, 0.71, 0.61),
    d.vec3f(0.12, 0.19, 0.2),
    gummyBoardSquareParity(point),
  )
})

export const gummyBoardTileColour = tgpu.fn(
  [d.vec2f, d.f32],
  d.vec3f,
)((point, theme) => {
  'use gpu'
  const alternate = gummyBoardSquareParity(point)
  if (theme < 0.5) return gummyBoardSquareColour(point)
  if (theme < 1.5)
    return std.mix(
      d.vec3f(0.3, 0.34, 0.3),
      d.vec3f(0.027, 0.075, 0.075),
      alternate,
    )
  return std.mix(
    d.vec3f(0.3, 0.16, 0.075),
    d.vec3f(0.033, 0.043, 0.048),
    alternate,
  )
})

/** A quiet studio sweep falls away from the board rather than filling the frame with flat grey. */
export const gummyBoardStudioFloor = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((point, theme) => {
  'use gpu'
  const pool = std.exp(-std.dot(point.xz, point.xz) / 150)
  if (theme < 1.5)
    return std.mix(
      d.vec3f(0.012, 0.017, 0.018),
      d.vec3f(0.039, 0.048, 0.047),
      pool,
    )
  return std.mix(d.vec3f(0.014, 0.011, 0.01), d.vec3f(0.043, 0.03, 0.021), pool)
})

/** Preserve caustic hue under bright overlap and retain enough contact shadow to seat each base. */
export const gummyBoardStageLighting = tgpu.fn(
  [d.vec3f, d.vec4f, d.f32],
  d.vec3f,
)((base, light, theme) => {
  'use gpu'
  if (theme < 0.5)
    return std.add(
      std.mul(base, 1 - std.clamp(light.w, 0, 0.45)),
      std.min(light.xyz, d.vec3f(0.7)),
    )
  const incident = std.mul(std.max(light.xyz, d.vec3f(0)), 0.32)
  const peak = std.max(incident.x, std.max(incident.y, incident.z))
  const caustic = std.div(incident, 1 + peak / 0.2)
  return std.add(std.mul(base, 1 - std.clamp(light.w * 1.55, 0, 0.62)), caustic)
})

// Half-space n·p <= w. The bevel stays outside all 64 playable squares.
const slabPlanes = tgpu.const(d.arrayOf(d.vec4f, 10), [
  d.vec4f(1, 0, 0, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(-1, 0, 0, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(0, 1, 0, GUMMY_BOARD_GRID.top),
  d.vec4f(0, -1, 0, -GUMMY_BOARD_SLAB.bottom),
  d.vec4f(0, 0, 1, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(0, 0, -1, GUMMY_BOARD_SLAB.halfExtent),
  d.vec4f(
    1,
    1,
    0,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    -1,
    1,
    0,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    0,
    1,
    1,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
  d.vec4f(
    0,
    1,
    -1,
    GUMMY_BOARD_SLAB.halfExtent - GUMMY_BOARD_SLAB.bevel + GUMMY_BOARD_GRID.top,
  ),
])
/** Exact convex clipping avoids a per-pixel ray-march and handles parallel/inside rays. */
export const gummyBoardBevelHit = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec4f,
)((origin, ray) => {
  'use gpu'
  let near = d.f32(-1e20)
  let far = d.f32(1e20)
  let entryNormal = d.vec3f(0)
  let exitNormal = d.vec3f(0)
  for (let index = d.u32(0); index < 10; index++) {
    const plane = slabPlanes.$[index]!
    const speed = std.dot(plane.xyz, ray)
    const gap = plane.w - std.dot(plane.xyz, origin)
    if (std.abs(speed) < 1e-6) {
      if (gap < 0) return d.vec4f(0, 0, 0, -1)
    } else {
      const distance = gap / speed
      if (speed < 0 && distance > near) {
        near = distance
        entryNormal = std.normalize(plane.xyz)
      } else if (speed > 0 && distance < far) {
        far = distance
        exitNormal = std.normalize(plane.xyz)
      }
      if (near > far) return d.vec4f(0, 0, 0, -1)
    }
  }
  if (far < 0) return d.vec4f(0, 0, 0, -1)
  if (near >= 0) return d.vec4f(entryNormal, near)
  return d.vec4f(exitNormal, far)
})

/** Four small graphite feet make the air gap visible without changing the playable surface. */
export const gummyBoardGlassSupportHit = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec4f,
)((origin, ray) => {
  'use gpu'
  let nearest = d.vec4f(0, 0, 0, -1)
  for (let index = d.u32(0); index < 4; index++) {
    const centre = d.vec2f(
      d.f32(index % 2) * 11.8 - 5.9,
      d.f32(d.u32(index / 2)) * 11.8 - 5.9,
    )
    const hit = gummyBoxHit(
      origin,
      ray,
      d.vec3f(centre.x - 0.19, GUMMY_BOARD_GLASS_FLOOR, centre.y - 0.19),
      d.vec3f(centre.x + 0.19, GUMMY_BOARD_SLAB.bottom, centre.y + 0.19),
    )
    if (hit.w >= 0 && (nearest.w < 0 || hit.w < nearest.w))
      nearest = d.vec4f(hit)
  }
  return nearest
})
const gummyBoardGlassSupportMaterial = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((normal, ray) => {
  'use gpu'
  const diffuse =
    0.6 +
    0.4 * std.max(std.dot(normal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))), 0)
  return std.add(
    std.mul(d.vec3f(0.027, 0.033, 0.035), diffuse),
    std.mul(gummyEnvironment(std.reflect(ray, normal)), 0.012),
  )
})

/** Both directions share the same lightly cast surface; this is a shading-normal approximation. */
export const gummyBoardGlassNormal = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((point, normal) => {
  'use gpu'
  if (normal.y < 0.99) return d.vec3f(normal)
  const grain = perlin2d.sampleWithGradient(
    std.add(std.mul(point.xz, 1.15), d.vec2f(4.7, 8.3)),
  )
  const inset = gummyBoardGlassInset(point.xz)
  return std.normalize(
    std.add(
      normal,
      d.vec3f(
        grain.y * 0.008 + inset.bevel.x,
        0,
        grain.z * 0.008 + inset.bevel.y,
      ),
    ),
  )
})

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
    gummyBoardGlassNormal(point, entry.xyz),
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
  return { position: clip, energy: std.mul(ray.energy, gain * 1.55) }
})
export const gummyBoardGlassLightFragment = tgpu.fragmentFn({
  in: { energy: d.vec3f },
  out: d.vec4f,
})(({ energy }) => {
  'use gpu'
  return d.vec4f(energy, 1)
})

/** The map is irradiance on a matte receiver beneath the glass, not a glowing glass texture. */
const gummyBoardGlassReceiver = tgpu.fn(
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

export const GummyBoardLavaField = d.struct({
  height: d.f32,
  crack: d.f32,
  core: d.f32,
  grain: d.f32,
  gradient: d.vec2f,
})
/** Mix both axes: independent X/Y hashes produce a rectangular lattice even with random spacing. */
export const gummyBoardLavaSite = tgpu.fn(
  [d.vec2f],
  d.vec2f,
)((cell) => {
  'use gpu'
  const seed = scrambleSeed2(std.add(cell, d.vec2f(37.1, 19.3)))
  const random = d.vec2f(
    u32To01F32(hash(seed.x ^ seed.y)),
    u32To01F32(hash(rotl(seed.x, 16) ^ seed.y)),
  )
  return std.add(cell, std.add(d.vec2f(0.1), std.mul(random, 0.8)))
})
/** Stationary cellular fracture boundaries leave broad dark crust plates between narrow fissures. */
export const gummyBoardLavaField = tgpu.fn(
  [d.vec2f],
  GummyBoardLavaField,
)((point) => {
  'use gpu'
  const coarse = std.add(std.mul(point, 0.62), d.vec2f(2.37, 5.19))
  const warp = d.vec2f(
    perlin2d.sample(std.mul(coarse, 0.8)),
    perlin2d.sample(std.add(std.mul(coarse, 0.8), d.vec2f(8.1, 3.7))),
  )
  const p = std.add(coarse, std.mul(warp, 0.23))
  const cell = std.floor(p)
  let first = d.f32(20)
  let second = d.f32(20)
  let firstDelta = d.vec2f(0)
  let secondDelta = d.vec2f(0)
  for (const x of std.range(-1, 2)) {
    for (const y of std.range(-1, 2)) {
      const neighbour = std.add(cell, d.vec2f(d.f32(x), d.f32(y)))
      const delta = std.sub(gummyBoardLavaSite(neighbour), p)
      const distance = std.dot(delta, delta)
      if (distance < first) {
        second = first
        secondDelta = d.vec2f(firstDelta)
        first = distance
        firstDelta = d.vec2f(delta)
      } else if (distance < second) {
        second = distance
        secondDelta = d.vec2f(delta)
      }
    }
  }
  const grain = perlin2d.sampleWithGradient(
    std.add(std.mul(point, 4.5), d.vec2f(11.1, 6.7)),
  )
  const gap = std.max(
    0,
    (std.sqrt(second) - std.sqrt(first)) * 0.5 + grain.x * 0.006,
  )
  const width = 0.014 + 0.006 * perlin2d.sample(std.mul(coarse, 0.47))
  const crack = 1 - std.smoothstep(width, width + 0.04, gap)
  const core = 1 - std.smoothstep(width * 0.2, width, gap)
  const gradient = std.sub(
    std.div(firstDelta, std.max(std.sqrt(first), 0.01)),
    std.div(secondDelta, std.max(std.sqrt(second), 0.01)),
  )
  const lip =
    std.smoothstep(width * 0.5, width * 1.5, gap) *
    (1 - std.smoothstep(width * 1.5, width + 0.045, gap))
  return GummyBoardLavaField({
    height: grain.x * 0.004 - crack * 0.045,
    crack,
    core,
    grain: grain.x,
    gradient: std.add(std.mul(grain.yz, 0.018), std.mul(gradient, lip * 0.18)),
  })
})

export const gummyBoardLavaMaterial = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32],
  d.vec3f,
)((point, normal, ray, time) => {
  'use gpu'
  const field = gummyBoardLavaField(std.add(point.xz, d.vec2f(point.y * 0.37)))
  let surfaceNormal = d.vec3f(normal)
  if (normal.y > 0.99)
    surfaceNormal = std.normalize(
      std.add(normal, d.vec3f(-field.gradient.x, 0, -field.gradient.y)),
    )
  const diffuse =
    0.42 +
    0.58 *
      std.max(
        std.dot(surfaceNormal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
        0,
      )
  let base = d.vec3f(0.022, 0.028, 0.031)
  if (normal.y > 0.99 && gummyBoardGridContains(point.xz))
    base = std.mix(
      d.vec3f(0.105, 0.074, 0.052),
      base,
      gummyBoardSquareParity(point.xz),
    )
  base = std.mul(
    base,
    diffuse * (0.78 + 0.4 * field.grain) * (1 - field.crack * 0.8),
  )
  // A short parallax offset seats the moving molten layer below the stationary crust.
  const under = std.add(
    point.xz,
    std.mul(ray.xz, 0.035 / std.max(0.25, -ray.y)),
  )
  const flow = perlin2d.sample(
    std.add(std.mul(under, 3.2), d.vec2f(-time * 0.14, time * 0.047)),
  )
  const heat = std.clamp(0.68 + flow * 0.42, 0.35, 1)
  const molten = std.mix(
    d.vec3f(0.9, 0.055, 0.002),
    d.vec3f(2.8, 0.65, 0.035),
    heat * field.core,
  )
  const emission = std.mul(molten, field.core * heat + field.crack * 0.012)
  const roughness = std.clamp(
    0.72 + field.grain * 0.12 - field.crack * 0.2,
    0.45,
    0.85,
  )
  const reflection = std.mix(
    gummyEnvironment(std.reflect(ray, surfaceNormal)),
    gummyEnvironment(surfaceNormal),
    roughness * 0.65,
  )
  const fresnel = gummyFresnel(std.max(0, std.dot(std.neg(ray), surfaceNormal)))
  // Local warm spill is an authored approximation; no claim of emissive global illumination.
  const spill = std.mul(
    d.vec3f(0.07, 0.009, 0.001),
    field.crack * (1 - field.core),
  )
  return std.add(
    std.add(base, std.add(emission, spill)),
    std.mul(reflection, fresnel * (1 - roughness) * 0.3 + 0.003),
  )
})

/** Glass follows a second interface to the lower receiver; classic keeps its original material. */
export const gummyBoardStageMaterial = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32],
  d.vec3f,
)((point, normal, ray, theme, time) => {
  'use gpu'
  const edge = std.max(std.abs(point.x), std.abs(point.z))
  const top = normal.y > 0.99
  let base = d.vec3f(0.055, 0.095, 0.1)
  if (theme < 0.5) {
    if (top) {
      base = d.vec3f(0.11, 0.16, 0.16)
      if (gummyBoardGridContains(point.xz))
        base = gummyBoardSquareColour(point.xz)
      else if (edge < GUMMY_BOARD_GRID.halfExtent + GUMMY_BOARD_SLAB.bevel)
        base = d.vec3f(0.43, 0.31, 0.13)
    }
    return base
  }
  if (theme > 1.5) return gummyBoardLavaMaterial(point, normal, ray, time)
  const surfaceNormal = gummyBoardGlassNormal(point, normal)
  const reflection = gummyEnvironment(std.reflect(ray, surfaceNormal))
  const path = gummyBoardGlassPath(point, surfaceNormal, ray)
  let behind = d.vec3f(0.018, 0.035, 0.04)
  if (path.valid > 0.5 && path.direction.y < -0.001) {
    const distance =
      (GUMMY_BOARD_GLASS_FLOOR - path.position.y) / path.direction.y
    if (distance > 0)
      behind = gummyBoardGlassReceiver(
        std.add(path.position, std.mul(path.direction, distance)),
      )
    // Start just above the contact plane so rounding cannot put this ray inside a foot.
    const foot = gummyBoardGlassSupportHit(
      std.sub(path.position, std.mul(path.direction, 0.0005)),
      path.direction,
    )
    if (foot.w >= 0 && foot.w < distance)
      behind = gummyBoardGlassSupportMaterial(foot.xyz, path.direction)
  }
  const fresnel = gummyFresnel(std.max(0, std.dot(std.neg(ray), surfaceNormal)))
  if (path.valid < 0.5) return d.vec3f(reflection)
  let glass = std.add(
    std.mul(behind, path.transmission),
    std.mul(reflection, fresnel),
  )
  if (top && gummyBoardGridContains(point.xz)) {
    const inset = gummyBoardGlassInset(point.xz)
    // Frost is a local surface response: its square boundaries stay at y=0
    // while transmitted light can move independently on the lower receiver.
    const diffuse =
      0.55 +
      0.45 *
        std.max(
          std.dot(surfaceNormal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
          0,
        )
    glass = std.mix(
      glass,
      std.mul(inset.colour, diffuse),
      inset.frost * (1 - fresnel),
    )
    glass = std.mix(
      glass,
      std.add(std.mul(reflection, 0.075), d.vec3f(0.008, 0.019, 0.021)),
      inset.seam * 0.72,
    )
  }
  return glass
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
  let colour = std.mix(
    d.vec3f(0.61, 0.57, 0.51),
    d.vec3f(0.82, 0.79, 0.73),
    std.smoothstep(-0.2, 0.6, ray.y),
  )
  let base = d.vec3f(0.64, 0.59, 0.5)
  if (theme > 0.5) {
    colour = std.mix(
      d.vec3f(0.02, 0.027, 0.03),
      d.vec3f(0.062, 0.069, 0.07),
      std.smoothstep(-0.2, 0.6, ray.y),
    )
    base = d.vec3f(0.022, 0.03, 0.031)
    if (theme > 1.5) base = d.vec3f(0.03, 0.022, 0.016)
  }
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
    const uv = std.add(
      std.div(world.xz, 2 * GUMMY_BOARD_LIGHT_EXTENT),
      d.vec2f(0.5),
    )
    if (boardTop && uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1) {
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
