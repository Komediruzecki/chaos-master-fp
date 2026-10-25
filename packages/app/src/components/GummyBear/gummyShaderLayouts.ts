/** Shared uniform schemas and bind groups for gummy mesh rendering. */
import { d, tgpu } from 'typegpu'

export const GummyCamera = d.struct({
  viewProjection: d.mat4x4f,
  inverseViewProjection: d.mat4x4f,
  eye: d.vec4f,
  resolution: d.vec4f,
  absorption: d.vec4f,
  colour: d.vec4f,
  press: d.vec4f,
  surface: d.vec4f,
})
export const gummyCameraLayout = tgpu.bindGroupLayout({
  camera: { uniform: GummyCamera },
})
export const gummyMeshLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  faces: { storage: d.arrayOf(d.vec4u) },
  damage: { storage: d.arrayOf(d.f32) },
  normals: { storage: d.arrayOf(d.vec4f) },
  corners: { storage: d.arrayOf(d.vec4f) },
  flatEdges: { storage: d.arrayOf(d.vec4u) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  metadata: { storage: d.arrayOf(d.vec4u) },
})
export const gummyNormalsLayout = tgpu.bindGroupLayout({
  positions: { storage: d.arrayOf(d.vec4f) },
  faces: { storage: d.arrayOf(d.vec4u) },
  restNormals: { storage: d.arrayOf(d.vec4f) },
  restPositions: { storage: d.arrayOf(d.vec4f) },
  ranges: { storage: d.arrayOf(d.vec2u) },
  adjacent: { storage: d.arrayOf(d.vec2u) },
  normals: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  damage: { storage: d.arrayOf(d.f32) },
})
export const gummySceneLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  exits: { texture: d.texture2d(d.f32) },
  restExits: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
export const gummyExitFilterLayout = tgpu.bindGroupLayout({
  fronts: { texture: d.texture2d(d.f32) },
})
export const gummyFloorLayout = tgpu.bindGroupLayout({
  light: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
export const gummyDisplayLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  sampler: { sampler: 'filtering' },
})
