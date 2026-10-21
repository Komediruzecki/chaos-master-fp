// Triplanar linear surface maps turn shallow authored height into a world-space surface gradient.
import { d, std, tgpu } from 'typegpu'
import { bookDetailLayout } from './bookDetailResources'
import { bookSurfaceKind } from './bookSurface'

// The book keeps its original finish. Architectural instances override this
// compile-time profile while sharing the same filtered sampling and bump math.
export const surfaceKindSlot = tgpu.slot(bookSurfaceKind)
export const bookBindingSlot = tgpu.slot(true)
export const SurfaceFinish = d.struct({
  repeat: d.vec3f,
  height: d.vec3f,
  contrast: d.vec3f,
  environment: d.vec3f,
  roughness: d.f32,
  slope: d.f32,
})
export const surfaceFinishSlot = tgpu.accessor(
  SurfaceFinish,
  SurfaceFinish({
    repeat: d.vec3f(0.48),
    height: d.vec3f(0.004, 0.012, 0.0006),
    contrast: d.vec3f(0.2, 0.15, 0.06),
    environment: d.vec3f(0.15, 0.6, 1),
    roughness: 0.2,
    slope: 0.28,
  }),
)

const Surface = d.struct({
  normal: d.vec3f,
  albedo: d.vec3f,
  rough: d.f32,
  environment: d.f32,
})
const signature = [
  d.vec3f,
  d.vec3f,
  d.vec3f,
  d.vec3f,
  d.f32,
  d.u32,
  d.u32,
] as const
const untextured = tgpu.fn(
  [...signature],
  Surface,
)((_local, _world, normal, albedo, rough, _kind, _clay) => {
  'use gpu'
  return Surface({ normal, albedo, rough, environment: 1 })
})
// Other Observatory meshes retain their original shader and acquire no texture binding.
export const bookDetailSlot = tgpu.slot(untextured)
export const bookDetailedSlot = tgpu.slot(false)

export const texturedBookSurface = tgpu.fn(
  [...signature],
  Surface,
)((local, world, normal, albedo, rough, kind, clay) => {
  'use gpu'
  const dx = std.dpdx(local)
  const dy = std.dpdy(local)
  const wx = std.dpdx(world)
  const wy = std.dpdy(world)
  // Derivative geometry normals keep mapping in object space even when the book is transformed.
  const axis = std.abs(std.cross(dx, dy))
  const unit = axis.div(
    std.max(std.max(axis.x, axis.y), std.max(axis.z, 0.0000000001)),
  )
  const powers = unit.mul(unit).mul(unit).mul(unit)
  const weight = powers.div(std.max(powers.x + powers.y + powers.z, 0.00001))
  // The 2.8-unit spread is authored without metre scale: 0.48 gives about six repeats.
  const finish = surfaceFinishSlot.$
  let repeat = finish.repeat.x
  if (kind === 2) repeat = finish.repeat.y
  else if (kind === 3) repeat = finish.repeat.z
  const uv = local.div(repeat)
  const du = dx.div(repeat)
  const dv = dy.div(repeat)
  const layer = d.i32(std.clamp(d.i32(kind) - 1, 0, 2))
  // Explicit gradients give stable mips and anisotropic filtering at grazing angles.
  const tx = std.textureSampleGrad(
    bookDetailLayout.$.surfaceMap,
    bookDetailLayout.$.surfaceSampler,
    uv.zy,
    layer,
    du.zy,
    dv.zy,
  )
  const ty = std.textureSampleGrad(
    bookDetailLayout.$.surfaceMap,
    bookDetailLayout.$.surfaceSampler,
    uv.xz,
    layer,
    du.xz,
    dv.xz,
  )
  const tz = std.textureSampleGrad(
    bookDetailLayout.$.surfaceMap,
    bookDetailLayout.$.surfaceSampler,
    uv.xy,
    layer,
    du.xy,
    dv.xy,
  )
  const texel = tx.mul(weight.x).add(ty.mul(weight.y)).add(tz.mul(weight.z))
  // Derivatives are evaluated uniformly, including smooth materials and clay mode.
  const hx = std.dpdx(texel.x)
  const hy = std.dpdy(texel.x)
  const r1 = std.cross(wy, normal)
  const r2 = std.cross(normal, wx)
  const determinant = std.dot(wx, r1)
  let result = Surface({ normal, albedo, rough, environment: 1 })
  if (kind > 0 && clay === 0) {
    let height = finish.height.x
    let contrast = finish.contrast.x
    let environment = finish.environment.x
    if (kind === 2) {
      height = finish.height.y
      contrast = finish.contrast.y
      environment = finish.environment.y
    } else if (kind === 3) {
      height = finish.height.z
      contrast = finish.contrast.z
      environment = finish.environment.z
    }
    // Scale the height with the instance, preserving the same finish in both book views.
    const scale = std.sqrt(
      (std.dot(wx, wx) + std.dot(wy, wy)) /
        std.max(std.dot(dx, dx) + std.dot(dy, dy), 0.000000000001),
    )
    let perturbed = d.vec3f(normal)
    if (std.abs(determinant) > 0.000000000000000001) {
      const gradient = r1
        .mul(hx)
        .add(r2.mul(hy))
        .mul((height * scale) / determinant)
      const bounded = gradient.mul(
        std.min(
          d.f32(1),
          finish.slope / std.max(std.length(gradient), 0.00001),
        ),
      )
      perturbed = std.normalize(normal.sub(bounded))
    }
    result = Surface({
      normal: perturbed,
      albedo: albedo.mul(1 + (texel.z - 128 / 255) * contrast),
      rough: std.clamp(
        rough + (texel.y - 128 / 255) * finish.roughness,
        0.08,
        0.98,
      ),
      environment,
    })
  }
  return result
})
