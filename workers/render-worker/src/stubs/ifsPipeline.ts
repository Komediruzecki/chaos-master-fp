/* eslint-disable */
/**
 * Server-side stub for @/flame/ifsPipeline.
 *
 * Same pipeline as the client, but compute functions are written as
 * WGSL string templates (no typegpu build plugin needed).
 *
 * typegpu's runtime .$uses() does NOT resolve transitive dependencies,
 * so flame functions and RNG must be directly referenced in the main
 * compute shader template string. The executeRandomFlame indirection
 * used in the client build-plugin path is replaced with inlined
 * flame selection so every flameFn name appears in the main template.
 */

import { tgpu } from 'typegpu'
import { arrayOf, builtin, f32, i32, struct, u32, vec2f, vec2i, vec2u, } from 'typegpu/data'
import { AffineParams, transformAffine } from '@/flame/affineTranform'
import { colorInitModeToImplFn } from '@/flame/colorInitMode'
import { pointInitModeToImplFn } from '@/flame/pointInitMode'
import { createFlameWgsl, extractFlameUniforms, } from '@/flame/transformFunction'
import { AtomicBucket, BUCKET_FIXED_POINT_MULTIPLIER, Point, } from '@/flame/types'
import { camera2DWorldToClip } from '@/lib/Camera2D'
import { hash, random, randomState, setSeed } from '@/shaders/random'
import { recordEntries, recordKeys } from '@/utils/record'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'
import type { Vec2u, WgslArray } from 'typegpu/data'
import type { ColorInitMode } from '@/flame/colorInitMode'
import type { PointInitMode } from '@/flame/pointInitMode'
import type { FlameDescriptor, TransformRecord, } from '@/flame/schema/flameSchema'
import type { CameraContext } from '@/lib/CameraContext'

const IFS_GROUP_SIZE = 64

const pipelineCache = new Map<
  string,
  {
    FlameUniforms: ReturnType<typeof struct>
    bindGroupLayout: ReturnType<typeof tgpu.bindGroupLayout>
    // typegpu 0.11 narrows compute fns by their concrete builtin record, which
    // no longer widens back to the generic ReturnType — the cache doesn't care.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ifsCompute: any
  }
>()

export function createIFSPipeline(
  root: TgpuRoot,
  device: any,
  camera: CameraContext,
  insideShaderCount: number,
  pointRandomSeeds: TgpuBuffer<WgslArray<Vec2u>> & StorageFlag,
  transforms: TransformRecord,
  outputTextureDimension: readonly [number, number],
  accumulationBuffer: TgpuBuffer<WgslArray<typeof AtomicBucket>> & StorageFlag,
  colorInitType: ColorInitMode = 'colorInitZero',
  pointInitType: PointInitMode = 'pointInitUnitDisk',
  blendTransforms?: TransformRecord,
) {
  let globId = 'IFS-PIP-'
  const isBlending = blendTransforms !== undefined
  const sig = JSON.stringify({
    insideShaderCount,
    colorInitType,
    pointInitType,
    transforms: recordEntries(transforms).map(([_, tr]) => ({
      ...tr,
      variations: recordEntries(tr.variations).map(([vid, v]) => ({
        vid,
        type: v.type,
      })),
    })),
    ...(isBlending && {
      blendTransforms: recordEntries(blendTransforms).map(([_, tr]) => ({
        ...tr,
        variations: recordEntries(tr.variations).map(([vid, v]) => ({
          vid,
          type: v.type,
        })),
      })),
    }),
  })

  let cached = pipelineCache.get(sig)
  if (!cached) {
    if (isBlending) {
      throw new Error('Blending not yet implemented for server-side rendering')
    }

    // ---- Non-blending path ----
    const flames = Object.fromEntries(
      recordEntries(transforms).map(([tid, tr]) => {
        globId += tid
        return [tid, createFlameWgsl(tr as any)]
      }),
    )

    const flamesObj = Object.fromEntries(
      recordKeys(transforms).map((tid) => [`flame${tid}`, flames[tid]!.fnImpl]),
    )
    const keys = recordKeys(transforms)
    const FlameUniforms = struct(
      keys.length > 0
        ? Object.fromEntries(
            keys.map((tid) => [`flame${tid}`, flames[tid]!.Uniforms]),
          )
        : { _dummy: f32 },
    )

    const bindGroupLayout = tgpu.bindGroupLayout({
      pointRandomSeeds: { storage: arrayOf(vec2u), access: 'mutable' },
      flameUniforms: { storage: FlameUniforms, access: 'readonly' },
      outputTextureDimension: { uniform: vec2i },
      finalTransform: { uniform: AffineParams },
      accumulationBuffer: { storage: arrayOf(AtomicBucket), access: 'mutable' },
    })

    const colorInitMode = colorInitModeToImplFn[colorInitType]
    const pointInitMode = pointInitModeToImplFn[pointInitType]

    // Inline flame selection directly in the main template so every flameFn
    // name appears in the WGSL string that typegpu scans for .$uses() resolution.
    const flameSelectionInline = recordKeys(transforms)
      .map(
        (tid) =>
          `if (!selected) { let flameUniforms = layout.$.flameUniforms.flame${tid}; probabilitySum += flameUniforms.probability; if (flameIndex < probabilitySum) { point = flame${tid}(point, flameUniforms); selected = true; } }`,
      )
      .join('\n')

    const ifsCompute = tgpu.computeFn({
      in: {
        numWorkgroups: builtin.numWorkgroups,
        workgroupId: builtin.workgroupId,
        localInvocationIndex: builtin.localInvocationIndex,
      },
      workgroupSize: [IFS_GROUP_SIZE, 1, 1],
    }) /* wgsl */ `
      (numWorkgroups: vec3u, workgroupId: vec3u, localInvocationIndex: u32) {
        let outputTextureDimension = layout.$.outputTextureDimension;
        let workgroupIndex = workgroupId.x + workgroupId.y * numWorkgroups.x + workgroupId.z * numWorkgroups.x * numWorkgroups.y;
        let pointIndex = workgroupIndex * ${IFS_GROUP_SIZE}u + localInvocationIndex;
        if (pointIndex >= arrayLength(&layout.$.pointRandomSeeds)) { return; }
        let pointSeed = layout.$.pointRandomSeeds[pointIndex];
        let seed = pointSeed + hash(pointIndex);
        setSeed(seed);
        var point: Point;
        point.position = pointInitMode(pointIndex);
        point.color = colorInitMode(point.position);
        for (var i = 0u; i < ${insideShaderCount}u; i++) {
          let flameIndex = random();
          var probabilitySum = f32(0);
          var selected = false;
          ${flameSelectionInline}
        }
        point.position = transformAffine(layout.$.finalTransform, point.position);
        let clip = camera2DWorldToClip(point.position);
        let outputTextureDimensionF = vec2f(outputTextureDimension);
        let screen = outputTextureDimensionF * (clip * vec2f(0.5, -0.5) + 0.5);
        layout.$.pointRandomSeeds[pointIndex] = vec2u(randomState);
        let jittered = screen + pointInitMode(pointIndex);
        if (!(jittered.x >= 0.0 && jittered.y >= 0.0 && jittered.x < outputTextureDimensionF.x && jittered.y < outputTextureDimensionF.y)) { return; }
        let screenI = vec2i(jittered);
        let pixelIndex = screenI.y * outputTextureDimension.x + screenI.x;
        atomicAdd(&layout.$.accumulationBuffer[pixelIndex].count, ${BUCKET_FIXED_POINT_MULTIPLIER}u);
        atomicAdd(&layout.$.accumulationBuffer[pixelIndex].color.a, i32(point.color.x * ${BUCKET_FIXED_POINT_MULTIPLIER}.0));
        atomicAdd(&layout.$.accumulationBuffer[pixelIndex].color.b, i32(point.color.y * ${BUCKET_FIXED_POINT_MULTIPLIER}.0));
      }
    `.$uses({
      ...flamesObj,
      Point,
      random,
      hash,
      setSeed,
      transformAffine,
      camera2DWorldToClip,
      pointInitMode,
      colorInitMode,
      randomState,
      layout: bindGroupLayout,
    })

    cached = { FlameUniforms, bindGroupLayout, ifsCompute }
    pipelineCache.set(sig, cached)
  }

  const { FlameUniforms, bindGroupLayout, ifsCompute } = cached

  const flameUniformsBuffer = root.createBuffer(FlameUniforms).$usage('storage')
  const outputTextureDimensionBuffer = root
    .createBuffer(vec2i, vec2i(...outputTextureDimension))
    .$usage('uniform')
  const finalTransformBuffer = root
    .createBuffer(AffineParams, { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 })
    .$usage('uniform')

  const bindGroup = root.createBindGroup(bindGroupLayout, {
    pointRandomSeeds,
    flameUniforms: flameUniformsBuffer,
    outputTextureDimension: outputTextureDimensionBuffer,
    finalTransform: finalTransformBuffer,
    accumulationBuffer,
  })

  const ifsPipeline = root
    .createComputePipeline({ compute: ifsCompute })
    .with(camera.bindGroup)
    .with(bindGroup)

  ifsPipeline.$name(globId)
  return {
    run: (pass: GPUComputePassEncoder, pointCount: number) => {
      ifsPipeline
        .with(pass)
        .dispatchWorkgroups(
          Math.ceil(pointCount / (IFS_GROUP_SIZE * IFS_GROUP_SIZE)),
          IFS_GROUP_SIZE,
          1,
        )
    },
    update: (
      flameDescriptor: FlameDescriptor,
      blendFlameDescriptor?: FlameDescriptor,
      blendWeight?: number,
    ) => {
      if (isBlending && blendFlameDescriptor) {
        throw new Error(
          'Blending not yet implemented for server-side rendering',
        )
      } else {
        const uniforms = extractFlameUniforms(flameDescriptor as any)
        if (Object.keys(uniforms).length === 0) {
          flameUniformsBuffer.write({ _dummy: 0 })
        } else {
          flameUniformsBuffer.write(uniforms)
        }
      }
      finalTransformBuffer.write(
        (flameDescriptor.finalTransform ?? {
          a: 1,
          b: 0,
          c: 0,
          d: 0,
          e: 1,
          f: 0,
        }) as {
          a: number
          b: number
          c: number
          d: number
          e: number
          f: number
        },
      )
    },
  }
}
