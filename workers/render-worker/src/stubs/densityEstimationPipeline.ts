/* eslint-disable */
/**
 * Server-side stub for @/flame/densityEstimationPipeline.
 *
 * Same pipeline as the client, but the compute function is written as a
 * WGSL string template (no typegpu build plugin needed).
 */

import { tgpu } from 'typegpu'
import { arrayOf, builtin, f32, i32, vec2i } from 'typegpu/data'
import { Bucket, BUCKET_FIXED_POINT_MULTIPLIER_INV, FilterParams, } from '@/flame/types'
import type { LayoutEntryToInput, TgpuRoot } from 'typegpu'

const GROUP_SIZE_X = 8
const GROUP_SIZE_Y = 8
const { ceil } = Math

const bindGroupLayout = tgpu.bindGroupLayout({
  textureSize: { uniform: vec2i },
  qualityK: { uniform: f32 },
  estimatorCurve: { uniform: f32 },
  accumulationBuffer: { storage: arrayOf(Bucket), access: 'readonly' },
  filterParamsBuffer: { storage: arrayOf(FilterParams), access: 'mutable' },
})

const DEFAULT_QUALITY_K = 5
const DEFAULT_ESTIMATOR_CURVE = 0.5

export function createDensityEstimationPipeline(
  root: TgpuRoot,
  textureSize: readonly [number, number],
  accumulationBuffer: LayoutEntryToInput<
    (typeof bindGroupLayout)['entries']['accumulationBuffer']
  >,
  filterParamsBuffer: LayoutEntryToInput<
    (typeof bindGroupLayout)['entries']['filterParamsBuffer']
  >,
  qualityK = DEFAULT_QUALITY_K,
  estimatorCurve = DEFAULT_ESTIMATOR_CURVE,
) {
  const textureSizeBuffer = root
    .createBuffer(vec2i, vec2i(...textureSize))
    .$usage('uniform')

  const qualityKBuffer = root.createBuffer(f32, qualityK).$usage('uniform')
  const estimatorCurveBuffer = root
    .createBuffer(f32, estimatorCurve)
    .$usage('uniform')

  const bindGroup = root.createBindGroup(bindGroupLayout, {
    accumulationBuffer,
    filterParamsBuffer,
    textureSize: textureSizeBuffer,
    qualityK: qualityKBuffer,
    estimatorCurve: estimatorCurveBuffer,
  })

  const estimate = tgpu.computeFn({
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

      var densitySum = 0.0;
      let kernelRadius = 1;
      var sampleCount = 0;

      for (var dy = -kernelRadius; dy <= kernelRadius; dy++) {
        for (var dx = -kernelRadius; dx <= kernelRadius; dx++) {
          let nx = clamp(uv.x + dx, 0, textureSize.x - 1);
          let ny = clamp(uv.y + dy, 0, textureSize.y - 1);
          let neighborIdx = ny * textureSize.x + nx;
          densitySum += max(
            f32(layout.$.accumulationBuffer[neighborIdx].count) * ${BUCKET_FIXED_POINT_MULTIPLIER_INV},
            0.001
          );
          sampleCount += 1;
        }
      }

      let avgDensity = densitySum / f32(sampleCount);
      let sigma = clamp(
        layout.$.qualityK * pow(avgDensity, -layout.$.estimatorCurve),
        0.5,
        12.0
      );

      layout.$.filterParamsBuffer[texelIndex].sigma = sigma;
    }
  `.$uses({ layout: bindGroupLayout })

  const pipeline = root
    .createComputePipeline({ compute: estimate })
    .with(bindGroup)

  return {
    run: (pass: GPUComputePassEncoder) => {
      const [width, height] = textureSize
      pipeline
        .with(pass)
        .dispatchWorkgroups(
          ceil(width / GROUP_SIZE_X),
          ceil(height / GROUP_SIZE_Y),
          1,
        )
    },
    setQualityK: (value: number) => {
      qualityKBuffer.write(value)
    },
    setEstimatorCurve: (value: number) => {
      estimatorCurveBuffer.write(value)
    },
  }
}
