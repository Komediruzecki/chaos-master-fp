/** Native TypeGPU mesh, glass and point-cloud shaders sharing camera/depth space. */
import { d, std, tgpu } from 'typegpu'
import { boardSpecular, dielectricFresnel, displayColour, GLASS_IOR, GLASS_WALL_THICKNESS, glassAttenuation, studioEnvironment, } from './pawnGlassMaterial'

export const BoardCameraUniform = d.struct({
  viewProjection: d.mat4x4f,
  eye: d.vec4f,
  resolution: d.vec4f,
  scene: d.vec4f,
  pawnCentres: d.arrayOf(d.vec4f, 32),
})
export const cameraLayout = tgpu.bindGroupLayout({
  camera: { uniform: BoardCameraUniform },
})
export const meshLayout = tgpu.vertexLayout(
  d.disarrayOf(
    d.unstruct({
      vertex: d.float32x3,
      normal: d.float32x3,
    }),
  ),
)
export const instanceLayout = tgpu.vertexLayout(
  d.disarrayOf(
    d.unstruct({
      offset: d.float32x4,
      tint: d.float32x4,
      effect: d.float32x4,
    }),
  ),
  'instance',
)
export const fragmentLayout = tgpu.vertexLayout(
  d.disarrayOf(
    d.unstruct({
      vertex: d.float32x3,
      normal: d.float32x3,
      centroid: d.float32x3,
      velocity: d.float32x3,
      angular: d.float32x3,
    }),
  ),
)
export const cloudLayout = tgpu.bindGroupLayout({
  points: { storage: d.arrayOf(d.vec4f) },
  velocity: { storage: d.arrayOf(d.vec4f) },
  colors: { storage: d.arrayOf(d.vec4f) },
  settings: { uniform: d.vec4f },
})
export const glassSceneLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  exits: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
export const displayLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})

const meshOutput = {
  position: d.builtin.position,
  world: d.vec3f,
  surfaceNormal: d.vec3f,
  local: d.vec3f,
  colour: d.vec4f,
  highlight: d.f32,
  objectId: d.f32,
}

export const meshVertex = tgpu.vertexFn({
  in: {
    vertex: d.vec3f,
    normal: d.vec3f,
    offset: d.vec4f,
    tint: d.vec4f,
    effect: d.vec4f,
  },
  out: meshOutput,
})((input) => {
  'use gpu'
  const world = std.add(std.mul(input.vertex, input.offset.w), input.offset.xyz)
  return {
    position: std.mul(cameraLayout.$.camera.viewProjection, d.vec4f(world, 1)),
    world,
    surfaceNormal: input.normal,
    local: input.vertex,
    colour: input.tint,
    highlight: input.effect.y,
    objectId: input.effect.z,
  }
})

export const boardFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    surfaceNormal: d.vec3f,
    local: d.vec3f,
    colour: d.vec4f,
    highlight: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = std.normalize(input.surfaceNormal)
  const view = std.normalize(
    std.sub(cameraLayout.$.camera.eye.xyz, input.world),
  )
  const light = std.normalize(d.vec3f(-0.45, 0.9, 0.4))
  const reflected = std.reflect(std.neg(view), normal)
  const diffuse = std.max(std.dot(normal, light), 0)
  let baseColour = d.vec3f(input.colour.xyz)
  let roughness = d.f32(0.26)
  let specularWeight = d.f32(1)
  let reflectionWeight = d.f32(0.55)
  if (cameraLayout.$.camera.resolution.z > 0.5) {
    baseColour = d.vec3f(0.01, 0.011, 0.012)
    roughness = 0.65
    specularWeight = 0.2
    reflectionWeight = 0.1
  }
  const specular = boardSpecular(normal, view, light, roughness)
  const fresnel = dielectricFresnel(std.max(std.dot(normal, view), 0), 1.5)
  let grain =
    0.99 + 0.01 * std.sin(input.world.x * 7.31) * std.sin(input.world.z * 9.17)
  if (cameraLayout.$.camera.resolution.z > 0.5) grain = 1
  let visibility = d.f32(1)
  if (normal.y > 0.5) {
    // Authored soft contact/height shadows, not traced caustics from the glass.
    for (const index of std.range(32)) {
      if (d.f32(index) < cameraLayout.$.camera.scene.x) {
        const centre = cameraLayout.$.camera.pawnCentres[index]!
        const contact = std.sub(input.world.xz, centre.xz)
        const contactShadow = std.exp(-std.dot(contact, contact) / 0.26) * 0.32
        const projected = std.sub(centre.xz, std.mul(light.xz, 0.75 / light.y))
        const delta = std.sub(input.world.xz, projected)
        const raisedShadow = std.exp(-std.dot(delta, delta) / 0.58) * 0.18
        visibility *= 1 - std.max(contactShadow, raisedShadow)
      }
    }
  }
  let colour = std.mul(baseColour, (0.2 + 0.8 * diffuse * visibility) * grain)
  colour = std.add(
    colour,
    std.mul(d.vec3f(2.1, 1.98, 1.8), specular * visibility * specularWeight),
  )
  colour = std.add(
    colour,
    std.mul(
      studioEnvironment(reflected, roughness + 0.02),
      fresnel * reflectionWeight,
    ),
  )
  const edge = std.smoothstep(
    0.74,
    0.79,
    std.max(std.abs(input.local.x), std.abs(input.local.z)),
  )
  if (normal.y > 0.5) {
    colour = std.add(
      colour,
      std.mul(d.vec3f(0.08, 0.7, 0.8), input.highlight * (0.22 + 0.78 * edge)),
    )
  }
  return d.vec4f(colour, 1)
})

export const glassFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    surfaceNormal: d.vec3f,
    local: d.vec3f,
    colour: d.vec4f,
    highlight: d.f32,
    objectId: d.f32,
    screen: d.builtin.position,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = std.normalize(input.surfaceNormal)
  const view = std.normalize(
    std.sub(cameraLayout.$.camera.eye.xyz, input.world),
  )
  const incident = std.neg(view)
  const noV = std.max(std.dot(normal, view), 0.02)
  const reflected = std.reflect(incident, normal)
  const interfaceFresnel = dielectricFresnel(noV, GLASS_IOR)
  // Thin parallel wall pair: aggregate reflection includes its second boundary.
  let fresnel = (2 * interfaceFresnel) / (1 + interfaceFresnel)
  const inside = std.refract(incident, normal, 1 / GLASS_IOR)
  const uv = std.div(input.screen.xy, cameraLayout.$.camera.resolution.xy)
  const exit = std.textureLoad(
    glassSceneLayout.$.exits,
    d.vec2i(input.screen.xy),
    0,
  )
  let normalThickness = d.f32(GLASS_WALL_THICKNESS)
  if (std.abs(exit.w - input.objectId) < 0.1) {
    // Inner near-wall hit ends the first glass wall. Never include the air cavity.
    normalThickness = std.clamp(
      std.length(std.sub(exit.xyz, input.local)) * noV,
      0.006,
      0.036,
    )
  }
  let path = d.f32(0)
  let sampleUv = d.vec2f(uv)
  if (std.dot(inside, inside) > 0.000001) {
    path = normalThickness / std.max(std.abs(std.dot(inside, normal)), 0.12)
    // A reciprocal exit preserves direction, with this bounded lateral shift.
    const probe = std.add(input.world, std.mul(inside, path))
    const clip = std.mul(
      cameraLayout.$.camera.viewProjection,
      d.vec4f(probe, 1),
    )
    const refractedUv = std.add(
      std.mul(std.div(clip.xy, std.max(clip.w, 0.001)), d.vec2f(0.5, -0.5)),
      d.vec2f(0.5),
    )
    if (
      clip.w > 0 &&
      refractedUv.x > 0.002 &&
      refractedUv.x < 0.998 &&
      refractedUv.y > 0.002 &&
      refractedUv.y < 0.998
    )
      sampleUv = d.vec2f(refractedUv)
  } else {
    // WGSL refract returns zero for total internal reflection.
    fresnel = 1
  }
  const transmitted = std.textureSampleLevel(
    glassSceneLayout.$.scene,
    glassSceneLayout.$.sampler,
    sampleUv,
    0,
  ).xyz
  const attenuationColour = std.mix(d.vec3f(1), input.colour.xyz, 0.12)
  const attenuation = glassAttenuation(attenuationColour, 0.6, path * 2)
  const transmission = std.mul(std.mul(transmitted, attenuation), 1 - fresnel)
  let reflection = std.mul(studioEnvironment(reflected, 0.055), fresnel)
  reflection = std.add(
    reflection,
    std.mul(d.vec3f(0.08, 0.5, 0.58), input.highlight * fresnel * 0.15),
  )
  // Coverage is opaque; optical transmission already replaces the scene once.
  return d.vec4f(std.add(transmission, reflection), 1)
})

/** Local coordinates improve Float16 precision for the small wall thickness. */
export const glassExitFragment = tgpu.fragmentFn({
  in: { local: d.vec3f, objectId: d.f32 },
  out: d.vec4f,
})((input) => {
  'use gpu'
  return d.vec4f(input.local, input.objectId)
})

export const backgroundFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const centre = std.sub(input.uv, d.vec2f(0.5, 0.42))
  const halo = std.exp(-std.dot(centre, centre) * 4)
  if (cameraLayout.$.camera.resolution.z > 0.5)
    return d.vec4f(
      std.mix(
        d.vec3f(0.0025, 0.0025, 0.0028),
        d.vec3f(0.008, 0.008, 0.009),
        halo,
      ),
      1,
    )
  return d.vec4f(
    std.mix(d.vec3f(0.009, 0.013, 0.021), d.vec3f(0.032, 0.045, 0.067), halo),
    1,
  )
})

export const displayFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const hdr = std.textureSampleLevel(
    displayLayout.$.scene,
    displayLayout.$.sampler,
    input.uv,
    0,
  ).xyz
  return d.vec4f(displayColour(hdr, cameraLayout.$.camera.resolution.w), 1)
})

/** Cut faces scatter more light than the intact polished envelope. */
export const shardFragment = tgpu.fragmentFn({
  in: {
    world: d.vec3f,
    surfaceNormal: d.vec3f,
    local: d.vec3f,
    colour: d.vec4f,
    highlight: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = std.normalize(input.surfaceNormal)
  const view = std.normalize(
    std.sub(cameraLayout.$.camera.eye.xyz, input.world),
  )
  const light = std.normalize(d.vec3f(-0.45, 0.9, 0.4))
  const diffuse = std.abs(std.dot(normal, light))
  const fresnel = std.pow(1 - std.abs(std.dot(normal, view)), 3)
  const glint = std.pow(
    std.abs(std.dot(normal, std.normalize(std.add(light, view)))),
    24,
  )
  const impact = std.exp(-input.highlight * 6)
  const body = std.mul(input.colour.xyz, 0.55 + 0.45 * diffuse + 0.7 * impact)
  const cuts = std.mul(
    d.vec3f(0.75, 0.88, 1),
    0.08 + 0.32 * fresnel + 1.5 * glint + 0.6 * impact,
  )
  const alpha = std.clamp((0.45 + 0.35 * fresnel) * input.colour.w, 0, 0.88)
  return d.vec4f(std.add(body, cuts), alpha)
})

const rotate = tgpu.fn(
  [d.vec3f, d.vec3f],
  d.vec3f,
)((p, angle) => {
  'use gpu'
  const sx = std.sin(angle.x)
  const cx = std.cos(angle.x)
  const sy = std.sin(angle.y)
  const cy = std.cos(angle.y)
  const sz = std.sin(angle.z)
  const cz = std.cos(angle.z)
  const x = d.vec3f(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z)
  const y = d.vec3f(cy * x.x + sy * x.z, x.y, -sy * x.x + cy * x.z)
  return d.vec3f(cz * y.x - sz * y.y, sz * y.x + cz * y.y, y.z)
})

export const fragmentVertex = tgpu.vertexFn({
  in: {
    vertex: d.vec3f,
    normal: d.vec3f,
    centroid: d.vec3f,
    velocity: d.vec3f,
    angular: d.vec3f,
    offset: d.vec4f,
    tint: d.vec4f,
    effect: d.vec4f,
  },
  out: meshOutput,
})((input) => {
  'use gpu'
  const age = std.max(input.effect.x, 0)
  const spinAge = (1 - std.exp(-age * 0.6)) / 0.6
  const angles = std.mul(input.angular, spinAge)
  const centre = std.add(input.centroid, std.mul(input.velocity, spinAge))
  centre.y = std.max(
    input.centroid.y + input.velocity.y * age - 4.9 * age * age,
    0.08,
  )
  const world = std.add(
    std.add(rotate(input.vertex, angles), centre),
    input.offset.xyz,
  )
  const fade = 1 - std.smoothstep(1.2, 1.7, age)
  return {
    position: std.mul(cameraLayout.$.camera.viewProjection, d.vec4f(world, 1)),
    world,
    surfaceNormal: rotate(input.normal, angles),
    local: input.vertex,
    colour: d.vec4f(input.tint.xyz, input.tint.w * fade * 1.55),
    highlight: age,
    objectId: 0,
  }
})

const corners = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(-1, 1),
  d.vec2f(-1, 1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
])
export const cloudVertex = tgpu.vertexFn({
  in: {
    index: d.builtin.vertexIndex,
    offset: d.vec4f,
    tint: d.vec4f,
    effect: d.vec4f,
  },
  out: { position: d.builtin.position, uv: d.vec2f, colour: d.vec4f },
})((input) => {
  'use gpu'
  const id = d.u32(input.index / 6)
  const uv = corners.$[input.index % 6]!
  let point = cloudLayout.$.points[id]!.xyz
  let alpha = cloudLayout.$.settings.x
  let size = d.f32(1.15)
  if (input.effect.x >= 0) {
    const age = input.effect.x
    point = std.add(point, std.mul(cloudLayout.$.velocity[id]!.xyz, age))
    point.y = std.max(point.y - 3.8 * age * age, 0.015)
    alpha =
      (0.5 + 0.3 * std.exp(-age * 7)) * (1 - std.smoothstep(0.75, 1.6, age))
    size = 2.2
  }
  const world = std.add(point, input.offset.xyz)
  const clip = std.mul(cameraLayout.$.camera.viewProjection, d.vec4f(world, 1))
  if (cloudLayout.$.settings.z > 0.5) {
    // Fixed-pixel splats accumulate quadratically with distance. Compensate
    // only new coloured clouds; legacy side-tinted point intensity is retained.
    const distanceScale = 4.2 / std.max(clip.w, 0.2)
    alpha *= std.clamp(distanceScale * distanceScale, 0.02, 4)
    if (input.effect.x >= 0) alpha *= cloudLayout.$.settings.x / 0.22
  }
  clip.x += (uv.x * size * clip.w) / cameraLayout.$.camera.resolution.x
  clip.y += (uv.y * size * clip.w) / cameraLayout.$.camera.resolution.y
  const storedColour = cloudLayout.$.colors[id]!
  let colour = std.mul(input.tint.xyz, 1.8)
  if (storedColour.w > 0)
    colour = std.mul(storedColour.xyz, cloudLayout.$.settings.y)
  return {
    position: clip,
    uv,
    colour: d.vec4f(colour, alpha),
  }
})
export const cloudFragment = tgpu.fragmentFn({
  in: {
    uv: d.vec2f,
    colour: d.vec4f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const alpha = std.max(1 - std.dot(input.uv, input.uv), 0) * input.colour.w
  return d.vec4f(input.colour.xyz, alpha)
})
