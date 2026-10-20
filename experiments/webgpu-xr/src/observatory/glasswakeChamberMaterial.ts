// Analytic opaque obsidian and porcelain lighting shares the model pass and one retained uniform.
import { d, std, tgpu } from 'typegpu'
import { bookLayout } from '../almanac/bookShaders'
import { chamberLight } from './glasswakeChamber'
import { GLASSWAKE_CENTER } from './scene'
import type { TgpuRoot } from 'typegpu'
import type { ModelMaterial } from './modelPass'
import type { GlasswakePresentation } from './scene'

export const GlasswakeChamberLighting = d.struct({ levels: d.vec4f })
export const glasswakeChamberMaterialLayout = tgpu.bindGroupLayout({
  lighting: { uniform: GlasswakeChamberLighting },
})
const corePosition = d.vec3f(
  GLASSWAKE_CENTER[0],
  GLASSWAKE_CENTER[1],
  GLASSWAKE_CENTER[2],
)

// A bounded dielectric highlight makes actual bevels legible without transmission,
// environment textures, surface noise, emissive cracks or an additional render pass.
const chamberSurfaceLight = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32, d.vec3f],
  d.vec3f,
)((normal, toEye, light, albedo, roughness, specularWeight, radiance) => {
  'use gpu'
  const halfway = std.normalize(light.add(toEye))
  const nl = std.max(d.f32(0), std.dot(normal, light))
  const nh = std.max(d.f32(0), std.dot(normal, halfway))
  const vh = std.max(d.f32(0), std.dot(toEye, halfway))
  const power = std.mix(180, 8, roughness * roughness)
  const distribution = ((power + 8) / (8 * Math.PI)) * std.pow(nh, power)
  const f0 = 0.04 * specularWeight
  const fresnel = f0 + (1 - f0) * std.pow(1 - vh, 5)
  return albedo
    .mul((1 - fresnel) / Math.PI)
    .add(d.vec3f(fresnel * distribution))
    .mul(radiance)
    .mul(nl)
})

export const glasswakeChamberFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    normal: d.vec3f,
    color: d.vec4f,
    surface: d.vec4f,
    front: d.builtin.frontFacing,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = bookLayout.$.camera
  let normal = std.normalize(input.normal)
  if (!input.front) normal = normal.mul(-1)

  if (camera.eye.w > 0.5) {
    // Clay exposes geometry alone: no material colour, score light or underside fade.
    const key = std.max(
      d.f32(0),
      std.dot(normal, std.normalize(d.vec3f(-0.5, 0.8, 0.6))),
    )
    return d.vec4f(d.vec3f(0.25, 0.28, 0.31).mul(0.16 + key * 0.8), 1)
  }

  const toEye = std.normalize(camera.eye.xyz.sub(input.world))
  const albedo = input.color.rgb
  const roughness = std.clamp(input.surface.y, 0.18, 0.95)
  const specularWeight = std.clamp(input.surface.w, 0.0, 1.0)
  const hemisphere = 0.055 + 0.075 * std.max(d.f32(0), normal.y)
  let color = albedo.mul(d.vec3f(0.38, 0.46, 0.64)).mul(hemisphere)

  const coreDelta = corePosition.sub(input.world)
  const distanceSquared = std.dot(coreDelta, coreDelta)
  const lightStrength = glasswakeChamberMaterialLayout.$.lighting.levels.x
  const coreRadiance = d
    .vec3f(1, 0.8, 0.56)
    .mul((3.2 * lightStrength) / (1 + 0.8 * distanceSquared))
  color = color.add(
    chamberSurfaceLight(
      normal,
      toEye,
      coreDelta.mul(std.inverseSqrt(std.max(0.0001, distanceSquared))),
      albedo,
      roughness,
      specularWeight,
      coreRadiance,
    ),
  )
  color = color.add(
    chamberSurfaceLight(
      normal,
      toEye,
      std.normalize(d.vec3f(-0.55, 0.62, 0.56)),
      albedo,
      roughness,
      specularWeight,
      d.vec3f(0.58, 0.46, 0.35),
    ),
  )
  color = color.add(
    chamberSurfaceLight(
      normal,
      toEye,
      std.normalize(d.vec3f(0.4, 0.75, -0.53)),
      albedo,
      roughness,
      specularWeight,
      d.vec3f(0.16, 0.25, 0.46),
    ),
  )

  const grazing = std.pow(
    1 - std.clamp(std.dot(normal, toEye), d.f32(0), d.f32(1)),
    4,
  )
  color = color.add(d.vec3f(0.1, 0.12, 0.2).mul(grazing * (1 - roughness)))
  // Ignore modelVertex's generic fill; warm porcelain is lit by the core above.
  const voidFade = 0.08 + 0.92 * std.smoothstep(-1.3, -0.05, input.world.y)
  return d.vec4f(color.mul(voidFade), 1)
})

/** One light buffer and binding for the caldera; no GPU device or audio ownership. */
export function createGlasswakeChamberMaterial(root: TgpuRoot) {
  const buffer = root.createBuffer(GlasswakeChamberLighting)
  try {
    const lighting = buffer.$usage('uniform')
    const bindGroup = root.createBindGroup(glasswakeChamberMaterialLayout, {
      lighting,
    })
    const material: ModelMaterial = {
      fragment: glasswakeChamberFragment,
      bindGroup,
    }
    const raw = new Float32Array(4)
    let previous = Number.NaN
    let disposed = false
    return {
      material,
      update(presentation: GlasswakePresentation, motion: boolean) {
        if (disposed) return
        const strength = chamberLight(presentation, motion)
        if (strength === previous) return
        raw[0] = strength
        lighting.write(raw.buffer)
        previous = strength
      },
      get bytes() {
        return disposed ? 0 : d.sizeOf(GlasswakeChamberLighting)
      },
      dispose() {
        if (disposed) return
        disposed = true
        lighting.destroy()
      },
    }
  } catch (error) {
    buffer.destroy()
    throw error
  }
}
