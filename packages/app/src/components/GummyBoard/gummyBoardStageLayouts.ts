/** Shared board material uniforms and caustic receiver bindings. */
import { d, tgpu } from 'typegpu'

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
