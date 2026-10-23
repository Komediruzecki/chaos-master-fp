/** Shared bind groups for particle surface reconstruction. */
import { d, tgpu } from 'typegpu'

export const particleGummyLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  support: { uniform: d.vec4f }, // radius, volume normalization, world depth range, maximum filter radius
})
export const particleOpaqueLayout = tgpu.bindGroupLayout({
  depth: { texture: d.textureDepth2d() },
})
export const particleProfileSourceLayout = tgpu.bindGroupLayout({
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
})
export const particleFilterLayout = tgpu.bindGroupLayout({
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  source: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
})
export const particleCompositeLayout = tgpu.bindGroupLayout({
  depth: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  original: { texture: d.texture2d(d.f32), sampleType: 'unfilterable-float' },
  normal: { texture: d.texture2d(d.f32) },
  optical: { texture: d.texture2d(d.f32) },
  dye: { texture: d.texture2d(d.f32) },
  scene: { texture: d.texture2d(d.f32) },
  sceneDepth: { texture: d.textureDepth2d() },
  sampler: { sampler: 'filtering' },
})
