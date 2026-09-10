/**
 * Server-side runtime stub for @/lib/Camera2D.
 *
 * The real Camera2D.tsx contains SolidJS JSX that Deno can't execute at runtime.
 * This stub provides typegpu struct/bind group layout definitions and functions
 * using the WGSL string API (no build plugin needed).
 */

import { tgpu } from 'typegpu'
import { f32, mat3x3f, struct, vec2f } from 'typegpu/data'

export const Camera2DUniforms = struct({
  viewMatrix: mat3x3f,
  viewMatrixInverse: mat3x3f,
  resolution: vec2f,
  pixelRatio: f32,
}).$name('Camera2DUniforms')

export const Camera2DBindGroupLayout = tgpu
  .bindGroupLayout({
    camera2DUniforms: { uniform: Camera2DUniforms },
  })
  .$name('Camera2DBindGroupLayout')

export const camera2DWorldToClip = tgpu.fn([vec2f], vec2f) /* wgsl */ `
  (world: vec2f) -> vec2f {
    let camera2DUniforms = layout.$.camera2DUniforms;
    let clip = camera2DUniforms.viewMatrix * vec3(world, 1);
    return clip.xy / clip.z;
  }
`.$uses({ layout: Camera2DBindGroupLayout })

export const camera2DClipToWorld = tgpu.fn([vec2f], vec2f) /* wgsl */ `
  (clip: vec2f) -> vec2f {
    let camera2DUniforms = layout.$.camera2DUniforms;
    let world = camera2DUniforms.viewMatrixInverse * vec3(clip, 1);
    return world.xy / world.z;
  }
`.$uses({ layout: Camera2DBindGroupLayout })
