/* eslint-disable */
/**
 * Server-side stub for @/flame/adaptiveBlurPipeline.
 *
 * Same pipeline as the client, but compute functions are written as
 * WGSL string templates (no typegpu build plugin needed).
 */

import { tgpu } from 'typegpu'
import { arrayOf, builtin, f32, i32, u32, vec2i } from 'typegpu/data'
import { Bucket, FilterParams } from '@/flame/types'
import type { LayoutEntryToInput, TgpuRoot } from 'typegpu'

const GROUP_SIZE_X = 8
const GROUP_SIZE_Y = 8
const { ceil: ceilMath } = Math
const MAX_SIGMA = 12

// Horizontal pass: accumulationBuffer → tempBuffer
const hBlurBindGroupLayout = tgpu.bindGroupLayout({
  textureSize: { uniform: vec2i },
  accumulationBuffer: { storage: arrayOf(Bucket), access: 'readonly' },
  filterParamsBuffer: { storage: arrayOf(FilterParams), access: 'readonly' },
  tempBuffer: { storage: arrayOf(Bucket), access: 'mutable' },
})

// Vertical pass: tempBuffer → postprocessBuffer
const vBlurBindGroupLayout = tgpu.bindGroupLayout({
  textureSize: { uniform: vec2i },
  tempBuffer: { storage: arrayOf(Bucket), access: 'readonly' },
  filterParamsBuffer: { storage: arrayOf(FilterParams), access: 'readonly' },
  postprocessBuffer: { storage: arrayOf(Bucket), access: 'mutable' },
})

export function createAdaptiveBlurPipeline(
  root: TgpuRoot,
  textureSize: readonly [number, number],
  accumulationBuffer: LayoutEntryToInput<
    (typeof hBlurBindGroupLayout)['entries']['accumulationBuffer']
  >,
  filterParamsBuffer: LayoutEntryToInput<
    (typeof hBlurBindGroupLayout)['entries']['filterParamsBuffer']
  >,
  postprocessBuffer: LayoutEntryToInput<
    (typeof vBlurBindGroupLayout)['entries']['postprocessBuffer']
  >,
) {
  const [width, height] = textureSize
  const pixelCount = width * height

  const textureSizeBuffer = root
    .createBuffer(vec2i, vec2i(...textureSize))
    .$usage('uniform')

  const tempBuffer = root
    .createBuffer(arrayOf(Bucket, pixelCount))
    .$usage('storage')

  // ── Horizontal pass ──
  const hBindGroup = root.createBindGroup(hBlurBindGroupLayout, {
    accumulationBuffer,
    filterParamsBuffer,
    tempBuffer,
    textureSize: textureSizeBuffer,
  })

  const hBlur = tgpu.computeFn({
    in: { globalInvocationId: builtin.globalInvocationId },
    workgroupSize: [GROUP_SIZE_X, GROUP_SIZE_Y, 1],
  }) /* wgsl */ `
    (globalInvocationId: vec3u) {
      let uv = vec2i(globalInvocationId.xy);
      let textureSize = layout.$.textureSize;
      if (uv.x >= textureSize.x || uv.y >= textureSize.y) {
        return;
      }
      let texelIndex = uv.y * textureSize.x + uv.x;
      let sigma = layout.$.filterParamsBuffer[texelIndex].sigma;
      let radius = i32(ceil(sigma * 3.0));
      let clampedRadius = clamp(radius, 1, ${MAX_SIGMA * 3});

      var totalCount = 0.0;
      var totalColorA = 0.0;
      var totalColorB = 0.0;
      var totalWeight = 0.0;

      for (var dx = -clampedRadius; dx <= clampedRadius; dx++) {
        let sx = clamp(uv.x + dx, 0, textureSize.x - 1);
        let sampleIdx = uv.y * textureSize.x + sx;
        let sample = layout.$.accumulationBuffer[sampleIdx];

        let dist = f32(dx);
        let weight = exp(-(dist * dist) / (2.0 * sigma * sigma));

        totalCount += f32(sample.count) * weight;
        totalColorA += f32(sample.color.a) * weight;
        totalColorB += f32(sample.color.b) * weight;
        totalWeight += weight;
      }

      layout.$.tempBuffer[texelIndex].count = u32(max(0.0, totalCount / totalWeight));
      layout.$.tempBuffer[texelIndex].color.a = i32(totalColorA / totalWeight);
      layout.$.tempBuffer[texelIndex].color.b = i32(totalColorB / totalWeight);
    }
  `.$uses({ layout: hBlurBindGroupLayout })

  const hPipeline = root
    .createComputePipeline({ compute: hBlur })
    .with(hBindGroup)

  // ── Vertical pass ──
  const vBindGroup = root.createBindGroup(vBlurBindGroupLayout, {
    tempBuffer,
    filterParamsBuffer,
    postprocessBuffer,
    textureSize: textureSizeBuffer,
  })

  const vBlur = tgpu.computeFn({
    in: { globalInvocationId: builtin.globalInvocationId },
    workgroupSize: [GROUP_SIZE_X, GROUP_SIZE_Y, 1],
  }) /* wgsl */ `
    (globalInvocationId: vec3u) {
      let uv = vec2i(globalInvocationId.xy);
      let textureSize = layout.$.textureSize;
      if (uv.x >= textureSize.x || uv.y >= textureSize.y) {
        return;
      }
      let texelIndex = uv.y * textureSize.x + uv.x;
      let sigma = layout.$.filterParamsBuffer[texelIndex].sigma;
      let radius = i32(ceil(sigma * 3.0));
      let clampedRadius = clamp(radius, 1, ${MAX_SIGMA * 3});

      var totalCount = 0.0;
      var totalColorA = 0.0;
      var totalColorB = 0.0;
      var totalWeight = 0.0;

      for (var dy = -clampedRadius; dy <= clampedRadius; dy++) {
        let sy = clamp(uv.y + dy, 0, textureSize.y - 1);
        let sampleIdx = sy * textureSize.x + uv.x;
        let sample = layout.$.tempBuffer[sampleIdx];

        let dist = f32(dy);
        let weight = exp(-(dist * dist) / (2.0 * sigma * sigma));

        totalCount += f32(sample.count) * weight;
        totalColorA += f32(sample.color.a) * weight;
        totalColorB += f32(sample.color.b) * weight;
        totalWeight += weight;
      }

      layout.$.postprocessBuffer[texelIndex].count = u32(max(0.0, totalCount / totalWeight));
      layout.$.postprocessBuffer[texelIndex].color.a = i32(totalColorA / totalWeight);
      layout.$.postprocessBuffer[texelIndex].color.b = i32(totalColorB / totalWeight);
    }
  `.$uses({ layout: vBlurBindGroupLayout })

  const vPipeline = root
    .createComputePipeline({ compute: vBlur })
    .with(vBindGroup)

  return {
    run: (pass: GPUComputePassEncoder) => {
      hPipeline
        .with(pass)
        .dispatchWorkgroups(
          ceilMath(width / GROUP_SIZE_X),
          ceilMath(height / GROUP_SIZE_Y),
          1,
        )
      vPipeline
        .with(pass)
        .dispatchWorkgroups(
          ceilMath(width / GROUP_SIZE_X),
          ceilMath(height / GROUP_SIZE_Y),
          1,
        )
    },
    destroy: () => {
      tempBuffer.destroy()
    },
  }
}
