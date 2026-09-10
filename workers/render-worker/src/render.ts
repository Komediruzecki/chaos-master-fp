/* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-globals, @typescript-eslint/no-floating-promises, @typescript-eslint/no-redundant-type-constituents */
/**
 * Server-side GPU IFS flame renderer using Deno's native WebGPU runtime.
 *
 * Reuses the exact same typegpu/WGSL shader code as the client application
 * via Deno import map aliases. Camera uniforms are built directly (no SolidJS).
 */

if (
  globalThis.Deno &&
  Deno.build?.os === 'linux' &&
  Deno.env.get('RENDER_WORKER_FORCE_CPU') === 'true'
) {
  const lvpPaths = [
    '/usr/share/vulkan/icd.d/lvp_icd.x86_64.json',
    '/usr/share/vulkan/icd.d/lvp_icd.i686.json',
  ]
  for (const path of lvpPaths) {
    try {
      if (Deno.statSync(path).isFile) {
        Deno.env.set('VK_ICD_FILENAMES', path)
        console.info(
          `[render] Software Vulkan rasterizer forced via ${path} (RENDER_WORKER_FORCE_CPU=true).`,
        )
        break
      }
    } catch {
      // Continue
    }
  }
}

import { oklabToRgb } from '@typegpu/color'
import { registerRuntimeUses, tgpu } from 'typegpu'
import { arrayOf, mat3x3f, vec2f, vec2u, vec3f, vec4f } from 'typegpu/data'
import { mat3, mat4 } from 'wgpu-matrix'
import { createAdaptiveBlurPipeline } from '@/flame/adaptiveBlurPipeline'
import { ColorGradingUniforms, createColorGradingPipeline, } from '@/flame/colorGrading'
import { createDensityEstimationPipeline } from '@/flame/densityEstimationPipeline'
import { drawModeToImplFn } from '@/flame/drawMode'
import { createIFSPipeline } from '@/flame/ifsPipeline'
import { AtomicBucket, Bucket, BUCKET_FIXED_POINT_MULTIPLIER, FilterParams, } from '@/flame/types'
import { Camera2DBindGroupLayout, Camera2DUniforms } from '@/lib/Camera2D'
import { cameraFromFlame, qualityPointLimit as sharedQualityPointLimit, } from '@/flame/renderCost'
import type { Palette } from '@/flame/colorMap'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { CameraContext } from '@/lib/CameraContext'

const { ceil: _ceil, sqrt: _sqrt } = Math
const _IFS_GROUP_SIZE = 64

const MAX_DISPATCHES_PER_BATCH = 200

export interface RenderOptions {
  width: number
  height: number
  /** 0-1 quality slider (1 = highest) */
  quality: number
  /** Point count per individual IFS dispatch */
  pointCountPerBatch?: number
}

export interface RenderResult {
  pixels: Uint8Array
  width: number
  height: number
}

// ── camera helpers ────────────────────────────────────────────────────────

function buildCameraUniforms(
  width: number,
  height: number,
  zoom: number,
  position: [number, number],
): any {
  const aspect = width / height
  const fovy = 1 / zoom
  const [x, y] = position
  const viewMatrix4 = mat4.ortho(
    x - aspect * fovy,
    x + aspect * fovy,
    y - fovy,
    y + fovy,
    0,
    0,
  )
  // Extract columns (x, y, w) to construct mat3x3f
  const col0 = vec3f(viewMatrix4[0], viewMatrix4[1], viewMatrix4[3])
  const col1 = vec3f(viewMatrix4[4], viewMatrix4[5], viewMatrix4[7])
  const col2 = vec3f(viewMatrix4[12], viewMatrix4[13], viewMatrix4[15])
  const viewMatrix = mat3x3f(col0, col1, col2)

  const viewMatrixInverse = mat3.inverse(viewMatrix, mat3x3f())
  return {
    viewMatrix,
    viewMatrixInverse,
    resolution: vec2f(width, height),
    pixelRatio: 1,
  }
}

function createCameraContext(
  root: ReturnType<typeof tgpu.initFromDevice>,
  width: number,
  height: number,
  zoom: number,
  position: [number, number],
): CameraContext {
  const uniformsBuffer = root
    .createBuffer(
      Camera2DUniforms,
      buildCameraUniforms(width, height, zoom, position),
    )
    .$usage('uniform')

  const bindGroup = root.createBindGroup(Camera2DBindGroupLayout, {
    camera2DUniforms: uniformsBuffer,
  })

  return {
    bindGroup,
    update: () => {},
    BindGroupLayout: Camera2DBindGroupLayout,
    wgsl: {} as never,
    js: {} as never,
    zoom: () => zoom,
    position: () => ({ x: position[0], y: position[1] }) as never,
    setPosition: (_pos) => ({ x: position[0], y: position[1] }) as never,
  }
}

// ── point budget ───────────────────────────────────────────────────────────

function computeBatchSize(width: number, height: number): number {
  const pixelCount = width * height
  // Each dispatch launches ceil(points / GROUP) workgroups × ceil(GROUP, 1) groups.
  // Target ~10K-20K points per dispatch for GPU efficiency.
  return Math.max(1024, Math.min(32_768, pixelCount >> 1))
}

// ── palette ────────────────────────────────────────────────────────────────

function convertPalette(flame: FlameDescriptor): Palette | undefined {
  const raw = (flame as Record<string, unknown>).palette
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const entries = p.entries
  if (!Array.isArray(entries) || entries.length === 0) return undefined
  return {
    id: (p.id as string) ?? 'server-palette',
    name: (p.name as string) ?? 'Palette',
    entries: entries.map((e: Record<string, unknown>, i: number) => ({
      id: (e.id as string) ?? `entry-${i}`,
      position: (e.position as number) ?? i / entries.length,
      a: (e.a as number) ?? 0,
      b: (e.b as number) ?? 0,
    })),
    source: (p.source as Palette['source']) ?? 'imported',
  }
}

function getBackgroundColor(flame: FlameDescriptor): [number, number, number] {
  const bg = flame.renderSettings?.backgroundColor
  if (bg && Array.isArray(bg) && bg.length === 3) {
    return [bg[0] as number, bg[1] as number, bg[2] as number]
  }
  const isPaint = flame.renderSettings?.drawMode !== 'light'
  return isPaint ? [1, 1, 1] : [0, 0, 0]
}

// ── main render function ──────────────────────────────────────────────────

export async function renderFlameGPU(
  flame: FlameDescriptor,
  options: RenderOptions,
  onProgress?: (progress: number) => void,
  deviceParam?: GPUDevice,
): Promise<RenderResult> {
  const { width, height, quality } = options
  const pixelCount = width * height

  // 1. Initialize WebGPU
  let device = deviceParam
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('No WebGPU adapter found on this system')
    console.info('[render] Adapter:', adapter.info.description)

    // Raise the device limits to whatever the adapter supports — MUST mirror
    // the client (packages/app/src/lib/WebgpuAdapter.ts). With the WebGPU
    // DEFAULTS (128 MiB maxStorageBufferBindingSize) the 4K accumulation
    // buffer (3840*2160*16B = 126.6 MiB + padding) fails to allocate, which
    // surfaced as "Buffer allocation failed: not enough memory left" for every
    // 3840x2160 render while 2560x1440 (59 MB) worked.
    device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize:
          adapter.limits.maxComputeWorkgroupStorageSize,
      },
    })

    // Machine-readable line consumed by handler.py so every job's output
    // records which GPU actually ran it (guards against a silent CPU
    // fallback going unnoticed).
    console.error(
      `ADAPTER:${JSON.stringify({
        description: adapter.info.description,
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
        maxBufferSize: device.limits.maxBufferSize,
      })}`,
    )
  } else {
    console.info('[render] Using pre-allocated device')
  }

  device.lost.then((info) => {
    console.error('[render] GPU device lost:', info.message)
  })

  // 2. Initialize typegpu
  const root = tgpu.initFromDevice({ device })

  // 3. Compute point budget
  const pointCountPerBatch =
    options.pointCountPerBatch ?? computeBatchSize(width, height)
  const renderCamera = cameraFromFlame(flame)
  const qualityPointLimit = sharedQualityPointLimit(
    { width, height, quality },
    renderCamera,
  )
  const totalDispatches = Math.ceil(qualityPointLimit / pointCountPerBatch)
  console.info(
    `[render] ${width}x${height} quality=${quality.toFixed(2)} ` +
      `points=${qualityPointLimit.toExponential(0)} batches=${totalDispatches}`,
  )

  // 4. Create camera
  const cameraSettings = flame.renderSettings?.camera ?? {
    zoom: 1,
    position: [0, 0],
  }
  const camera = createCameraContext(
    root,
    width,
    height,
    cameraSettings.zoom ?? 1,
    cameraSettings.position ?? [0, 0],
  )

  // 5. Allocate buffers
  // Log the request up front: an OOM further down is only interpretable
  // next to the sizes that were actually asked for.
  console.error(
    `ALLOC:${JSON.stringify({
      pixelCount,
      accumulationMB: +((pixelCount * 16) / 1e6).toFixed(1),
      postprocessMB: +((pixelCount * 16) / 1e6).toFixed(1),
      filterParamsMB: +((pixelCount * 4) / 1e6).toFixed(1),
    })}`,
  )

  // Allocate each buffer inside its OWN error scope: a bare "not enough
  // memory left" is unactionable without knowing WHICH size failed (a
  // per-allocation driver ceiling looks identical to a full GPU otherwise).
  async function allocGuarded<T>(
    label: string,
    bytes: number,
    make: () => T,
  ): Promise<T> {
    device!.pushErrorScope('out-of-memory')
    device!.pushErrorScope('validation')
    const buffer = make()
    // typegpu materializes GPUBuffers lazily — touch it inside the scope.
    void (buffer as { buffer?: unknown }).buffer
    const validationError = await device!.popErrorScope()
    const oomError = await device!.popErrorScope()
    const err = validationError ?? oomError
    if (err) {
      throw new Error(
        `Buffer allocation failed for ${label} (${(bytes / 1e6).toFixed(1)}MB): ${err.message}`,
      )
    }
    return buffer
  }

  const pointRandomSeeds = await allocGuarded(
    'pointRandomSeeds',
    pointCountPerBatch * 8,
    () =>
      root.createBuffer(arrayOf(vec2u, pointCountPerBatch)).$usage('storage'),
  )

  const accumulationBuffer = await allocGuarded(
    'accumulationBuffer',
    pixelCount * 16,
    () =>
      root.createBuffer(arrayOf(AtomicBucket, pixelCount)).$usage('storage'),
  )

  const postprocessBuffer = await allocGuarded(
    'postprocessBuffer',
    pixelCount * 16,
    () => root.createBuffer(arrayOf(Bucket, pixelCount)).$usage('storage'),
  )

  const filterParamsBuffer = await allocGuarded(
    'filterParamsBuffer',
    pixelCount * 4,
    () =>
      root.createBuffer(arrayOf(FilterParams, pixelCount)).$usage('storage'),
  )

  // 6. Build IFS pipeline
  const skipIters = Math.floor(flame.renderSettings?.skipIters ?? 20)

  const ifsPipeline = createIFSPipeline(
    root,
    device,
    camera,
    skipIters,
    pointRandomSeeds,
    flame.transforms as never,
    [width, height],
    accumulationBuffer,
    flame.renderSettings?.colorInitMode as any,
    flame.renderSettings?.pointInitMode as any,
  )

  device.pushErrorScope('validation')
  ifsPipeline.update(flame as any)
  {
    const updateError = await device.popErrorScope()
    if (updateError) {
      throw new Error(`Flame uniforms write failed: ${updateError.message}`)
    }
  }

  // 7. Build post-processing pipelines
  const deQuality = flame.renderSettings?.densityEstimationQuality ?? 5
  const qualityK = deQuality > 1 ? deQuality : 0.5 + (1 - deQuality) * 19.5
  const estimatorCurve = flame.renderSettings?.estimatorCurve ?? 0.5

  const densityPipeline = createDensityEstimationPipeline(
    root,
    [width, height],
    accumulationBuffer,
    filterParamsBuffer,
    qualityK,
    estimatorCurve,
  )

  const blurPipeline = createAdaptiveBlurPipeline(
    root,
    [width, height],
    accumulationBuffer,
    filterParamsBuffer,
    postprocessBuffer,
  )

  // 8. Build color grading pipeline
  const palette = convertPalette(flame)
  const colorGradingValues = {
    averagePointCountPerBucketInv: 0,
    exposure: 2 * Math.exp(flame.renderSettings?.exposure ?? 1),
    backgroundColor: vec4f(...getBackgroundColor(flame), 1),
    edgeFadeColor: vec4f(0, 0, 0, 0),
    vibrancy: flame.renderSettings?.vibrancy ?? 0.5,
    palettePhase: flame.renderSettings?.palettePhase ?? 0,
    paletteSpeed: flame.renderSettings?.paletteSpeed ?? 0.5,
    paletteEntryCount: palette?.entries.length ?? 0,
    contrast: flame.renderSettings?.contrast ?? 1,
    gamma: flame.renderSettings?.gamma ?? 2.2,
    highlightPower: flame.renderSettings?.highlightPower ?? 0.5,
    outputAlpha: 0,
    paletteMode: flame.renderSettings?.paletteMode ?? 0,
    depthColorPower: flame.renderSettings?.depthColorPower ?? 0.0,
    lightDirection: vec4f(
      ...(flame.renderSettings?.lightDirection ?? [-0.5, 0.5, -1.0]),
      0.0,
    ),
    lightPower: flame.renderSettings?.lightPower ?? 0.0,
  }

  const colorGradingUniformsBuffer = root
    .createBuffer(ColorGradingUniforms, colorGradingValues)
    .$usage('uniform')

  // The color-grading fragment references these as free identifiers; register
  // them so the extraction wrapper can $uses-inject the runtime instances
  // (the app build resolves them via unplugin instead).
  const drawModeImpl = (drawModeToImplFn as any)[
    flame.renderSettings?.drawMode ?? 'light'
  ]
  registerRuntimeUses({ drawMode: drawModeImpl, oklabToRgb })

  const colorGradingPipeline = createColorGradingPipeline(
    root,
    colorGradingUniformsBuffer,
    [width, height],
    postprocessBuffer,
    'rgba8unorm' as GPUTextureFormat,
    drawModeImpl,
    palette,
  )

  // 9. Allocate offscreen render target
  const offscreenTexture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: 16 | 1, // RENDER_ATTACHMENT | COPY_SRC
  })

  // 10. Run IFS iteration batches
  let remainingDispatches = totalDispatches
  let batchIdx = 0
  let accumulatedPoints = 0

  while (remainingDispatches > 0) {
    const dispatchesInBatch = Math.min(
      remainingDispatches,
      MAX_DISPATCHES_PER_BATCH,
    )
    // Surface silent pipeline/bind validation failures on the first batch —
    // an invalid compute pipeline otherwise just no-ops into a blank image.
    if (batchIdx === 0) device.pushErrorScope('validation')
    const encoder = device.createCommandEncoder()

    if (batchIdx === 0) {
      encoder.clearBuffer(accumulationBuffer.buffer)
    }

    {
      const pass = encoder.beginComputePass()
      for (let i = 0; i < dispatchesInBatch; i++) {
        ifsPipeline.run(pass, pointCountPerBatch)
      }
      pass.end()
    }

    device.queue.submit([encoder.finish()])
    if (batchIdx === 0) {
      const validationError = await device.popErrorScope()
      if (validationError) {
        throw new Error(
          `IFS pipeline validation failed: ${validationError.message}`,
        )
      }
    }

    remainingDispatches -= dispatchesInBatch
    batchIdx++
    accumulatedPoints += dispatchesInBatch * pointCountPerBatch
    onProgress?.(Math.min(accumulatedPoints / qualityPointLimit, 0.9))
  }

  // Debug readback (RENDER_DEBUG=1): sums the accumulation + postprocess
  // buffers so a blank output can be blamed on the right stage (IFS not
  // plotting vs density/blur not filling vs color grading). Cheap enough to
  // keep for RunPod field debugging.
  async function debugSumBuffer(
    label: string,
    src: GPUBuffer,
    byteLength: number,
  ) {
    const rb = device!.createBuffer({ size: byteLength, usage: 8 | 1 })
    const enc = device!.createCommandEncoder()
    enc.copyBufferToBuffer(src, 0, rb, 0, byteLength)
    device!.queue.submit([enc.finish()])
    await rb.mapAsync(1)
    const words = new Uint32Array(rb.getMappedRange())
    let countSum = 0
    let nonZero = 0
    // Bucket stride = 4 words (count, z, color.a, color.b); count is word 0.
    for (let i = 0; i < words.length; i += 4) {
      const c = words[i]!
      if (c !== 0) nonZero++
      countSum += c
    }
    console.info(
      `[render][debug] ${label}: countSum=${countSum} nonZeroBuckets=${nonZero}/${words.length / 4}`,
    )
    rb.unmap()
    rb.destroy()
  }
  if (Deno.env.get('RENDER_DEBUG') === '1') {
    await debugSumBuffer(
      'accumulation',
      accumulationBuffer.buffer,
      pixelCount * 16,
    )
  }

  // 11. Post-processing + final render
  {
    const skipItersFactor = 1 + skipIters * 0.05
    colorGradingValues.averagePointCountPerBucketInv =
      ((height * height) / 4 / accumulatedPoints) * skipItersFactor
    colorGradingUniformsBuffer.write(colorGradingValues)

    device.pushErrorScope('validation')
    // Density estimation + adaptive blur
    {
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      densityPipeline.run(pass)
      blurPipeline.run(pass)
      pass.end()
      device.queue.submit([encoder.finish()])
    }
    {
      const validationError = await device.popErrorScope()
      if (validationError) {
        throw new Error(
          `Post-process pipeline validation failed: ${validationError.message}`,
        )
      }
    }
    if (Deno.env.get('RENDER_DEBUG') === '1') {
      await debugSumBuffer(
        'postprocess (after DE/blur)',
        postprocessBuffer.buffer,
        pixelCount * 16,
      )
    }

    device.pushErrorScope('validation')
    const encoder = device.createCommandEncoder()

    // Color grading → offscreen texture
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: offscreenTexture.createView(),
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      colorGradingPipeline.run(pass)
      pass.end()
    }

    // Copy to readback buffer
    const bytesPerRow = width * 4
    // WebGPU requires bytesPerRow to be a multiple of 256
    const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256
    const bufferSize = alignedBytesPerRow * height

    const readbackBuffer = device.createBuffer({
      size: bufferSize,
      usage: 8 | 1, // COPY_DST | MAP_READ
    })

    encoder.copyTextureToBuffer(
      { texture: offscreenTexture },
      {
        buffer: readbackBuffer,
        bytesPerRow: alignedBytesPerRow,
        rowsPerImage: height,
      },
      [width, height],
    )

    device.queue.submit([encoder.finish()])
    {
      const validationError = await device.popErrorScope()
      if (validationError) {
        throw new Error(
          `Color grading pipeline validation failed: ${validationError.message}`,
        )
      }
    }

    await readbackBuffer.mapAsync(1) // MAP_READ
    const mapped = new Uint8Array(readbackBuffer.getMappedRange())

    // Unpack from aligned rows to tightly packed RGBA
    const pixels = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row++) {
      const srcStart = row * alignedBytesPerRow
      const dstStart = row * bytesPerRow
      pixels.set(mapped.subarray(srcStart, srcStart + bytesPerRow), dstStart)
    }

    readbackBuffer.unmap()
    readbackBuffer.destroy()
    offscreenTexture.destroy()

    onProgress?.(1)

    console.info(
      `[render] Complete: ${accumulatedPoints} points, ${batchIdx} batches`,
    )
    return { pixels, width, height }
  }
}
