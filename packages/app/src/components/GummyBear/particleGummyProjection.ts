/** Camera ray and depth projection shared by particle optical passes. */
import { d, std, tgpu } from 'typegpu'
import { gummyUnitNormal } from './gummyMaterial'
import { gummyCameraLayout } from './gummyShaderLayouts'

export const particleRay = tgpu.fn(
  [d.vec2f],
  d.vec3f,
)((pixel) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const uv = std.div(pixel, camera.resolution.xy)
  const far = std.mul(
    camera.inverseViewProjection,
    d.vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 1, 1),
  )
  return gummyUnitNormal(
    std.sub(std.div(far.xyz, far.w), camera.eye.xyz),
    d.vec3f(0, 0, -1),
  )
})

export const projectedDepth = tgpu.fn(
  [d.vec3f],
  d.f32,
)((world) => {
  'use gpu'
  const clip = std.mul(
    gummyCameraLayout.$.camera.viewProjection,
    d.vec4f(world, 1),
  )
  return clip.z / clip.w
})
