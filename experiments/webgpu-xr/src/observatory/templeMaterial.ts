// Mineral stone, metal inlays and two score-led lights share the existing model vertex contract.
import { d, std, tgpu } from 'typegpu'
import { bookLayout } from '../almanac/bookShaders'
import { TEMPLE_DURATION_SECONDS, TEMPLE_SCORE, TEMPLE_SECTIONS, } from '../journey/templeScore'
import type { TemplePresentation } from './temple'

export interface TempleLightLevels {
  warm: number
  cool: number
  confluence: number
  seal: number
}

/** Mineral lighting v1: each light rises once through its authored score section.
 * No wall clock, frame delta or audio loudness enters this envelope; stopping the
 * transport freezes it and replaying the same phrase gives the same light.
 */
export function templeLighting(state: TemplePresentation): TempleLightLevels {
  const progress = state.revealed
    ? 1
    : Number.isFinite(state.progress)
      ? Math.max(0, Math.min(1, state.progress))
      : 0
  const beat = (progress * TEMPLE_DURATION_SECONDS * TEMPLE_SCORE.tempo) / 60
  const rise = (section: (typeof TEMPLE_SECTIONS)[number]) => {
    const value = state.active
      ? Math.max(
          0,
          Math.min(
            1,
            (beat - section.startBeat) / (section.endBeat - section.startBeat),
          ),
        )
      : 0
    return value * value * (3 - 2 * value)
  }
  return {
    warm: rise(TEMPLE_SECTIONS[0]),
    cool: rise(TEMPLE_SECTIONS[1]),
    confluence: rise(TEMPLE_SECTIONS[2]),
    seal: rise(TEMPLE_SECTIONS[3]),
  }
}

export const TempleLighting = d.struct({ levels: d.vec4f })
export const templeMaterialLayout = tgpu.bindGroupLayout({
  lighting: { uniform: TempleLighting },
})

// Normalized Blinn distribution with Schlick Fresnel: directional metal and enamel
// highlights, bounded roughness and no environment-map or shadow-map claim.
const templeLight = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32, d.vec3f],
  d.vec3f,
)((normal, toEye, light, albedo, metal, roughness, radiance) => {
  'use gpu'
  const halfway = std.normalize(light.add(toEye))
  const nl = std.max(d.f32(0), std.dot(normal, light))
  const nh = std.max(d.f32(0), std.dot(normal, halfway))
  const vh = std.max(d.f32(0), std.dot(toEye, halfway))
  const power = std.mix(140, 7, roughness * roughness)
  const distribution = ((power + 8) / (8 * Math.PI)) * std.pow(nh, power)
  const f0 = std.mix(d.vec3f(0.04), albedo, metal)
  const fresnel = f0.add(
    d
      .vec3f(1)
      .sub(f0)
      .mul(std.pow(1 - vh, 5)),
  )
  const diffuse = albedo.mul((1 - metal) / Math.PI).mul(d.vec3f(1).sub(fresnel))
  return diffuse.add(fresnel.mul(distribution)).mul(radiance).mul(nl)
})

export const templeFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    local: d.vec3f,
    normal: d.vec3f,
    color: d.vec4f,
    surface: d.vec4f,
    front: d.builtin.frontFacing,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = bookLayout.$.camera
  const levels = templeMaterialLayout.$.lighting.levels
  let normal = std.normalize(input.normal)
  if (!input.front) normal = normal.mul(-1)
  const toEye = std.normalize(camera.eye.xyz.sub(input.world))
  const metal = input.surface.x
  const stone = 1 - std.smoothstep(0.18, 0.28, metal)
  const roughness = std.clamp(input.surface.y + stone * 0.12, 0.22, 0.92)
  const local = input.world.add(d.vec3f(0, 0, 12))

  // Stable world-space mineral layers and grain. Derivative filtering removes
  // detail before its frequency becomes subpixel, including narrow viewports.
  const grainCoordinates = local.mul(64)
  const grainFootprint = std.max(
    std.length(std.dpdx(grainCoordinates)),
    std.length(std.dpdy(grainCoordinates)),
  )
  const grain =
    std.sin(grainCoordinates.x + grainCoordinates.y * 0.7) *
    std.sin(grainCoordinates.z * 0.83 - grainCoordinates.y)
  const grainWeight = (1 - std.smoothstep(0.35, 1.8, grainFootprint)) * 0.045
  const veinCoordinate =
    std.dot(local, d.vec3f(1.8, 2.3, 3.1)) +
    std.sin(local.y * 2.1 + local.z) * 0.7 +
    std.sin(local.x * 4.2 - local.y) * 0.23
  const veinFootprint =
    std.abs(std.dpdx(veinCoordinate)) + std.abs(std.dpdy(veinCoordinate))
  const vein =
    (1 -
      std.smoothstep(
        0.035,
        0.13 + veinFootprint,
        std.abs(std.sin(veinCoordinate)),
      )) *
    (1 - std.smoothstep(0.2, 0.9, veinFootprint))
  let albedo = input.color.rgb.mul(1 - stone * 0.38)
  albedo = albedo.mul(1 + stone * (grain * grainWeight + vein * 0.22))

  const hemisphere = 0.055 + 0.075 * std.max(d.f32(0), normal.y)
  let color = albedo.mul(d.vec3f(0.36, 0.5, 0.7)).mul(hemisphere)
  const left = camera.leftDock.xyz.add(d.vec3f(0, 1.3, 1.7)).sub(input.world)
  const right = camera.rightDock.xyz.add(d.vec3f(0, 1.4, 1.5)).sub(input.world)
  const warmFalloff = 14 / (5 + std.dot(left, left))
  const coolFalloff = 14 / (5 + std.dot(right, right))
  color = color.add(
    templeLight(
      normal,
      toEye,
      std.normalize(left),
      albedo,
      metal,
      roughness,
      d.vec3f(3.8, 2.15, 0.88).mul(warmFalloff * (0.12 + levels.x * 0.88)),
    ),
  )
  color = color.add(
    templeLight(
      normal,
      toEye,
      std.normalize(right),
      albedo,
      metal,
      roughness,
      d.vec3f(0.38, 2.1, 2.55).mul(coolFalloff * (0.08 + levels.y * 0.92)),
    ),
  )
  color = color.add(
    templeLight(
      normal,
      toEye,
      std.normalize(d.vec3f(0.15, 0.76, -0.64)),
      albedo,
      metal,
      roughness,
      d.vec3f(0.48, 0.72, 1.05).mul(0.25 + levels.z * 1.5),
    ),
  )

  // Broad reflection is restrained on face-on stone and catches beveled metal edges.
  const grazing = std.pow(1 - std.max(d.f32(0), std.dot(normal, toEye)), 4)
  const reflected = std.reflect(toEye.mul(-1), normal)
  const skyReflection =
    0.035 + std.pow(std.max(d.f32(0), reflected.y), 3) * 0.19
  color = color.add(
    albedo
      .mul(d.vec3f(0.5, 0.71, 0.86))
      .mul((metal * skyReflection + grazing * 0.035) * (0.4 + levels.z * 0.6)),
  )

  // modelVertex adds fill for the other worlds. Remove it here: mineral stone
  // must be lit by its surfaces, while authored inlays can carry the score light.
  const inheritedFill = 0.035 + std.max(d.f32(0), normal.y) * 0.16
  const emission = std.max(d.f32(0), input.surface.z - inheritedFill)
  const teal = std.smoothstep(0.04, 0.25, input.color.g - input.color.r)
  const motifLight = std.mix(levels.x, levels.y, teal)
  color = color.add(
    albedo.mul(emission * (1 - stone) * (0.14 + motifLight * 0.86)),
  )

  if (camera.eye.w > 0.5) {
    // Clay remains a geometry inspection mode, independent of authored color.
    const key = std.max(
      d.f32(0),
      std.dot(normal, std.normalize(d.vec3f(-0.5, 0.8, 0.6))),
    )
    color = d.vec3f(0.25, 0.28, 0.31).mul(0.16 + key * 0.8)
  }
  return d.vec4f(color, 1)
})
