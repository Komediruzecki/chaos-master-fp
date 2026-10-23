/** Cellular crust, molten fissures and lava surface shading. */
import { hash, perlin2d, rotl, scrambleSeed2, u32To01F32 } from '@typegpu/noise'
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment, gummyFresnel } from '../GummyBear/gummyMaterial'
import { gummyBoardGridContains, gummyBoardSquareParity, } from './gummyBoardGridShaders'

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
