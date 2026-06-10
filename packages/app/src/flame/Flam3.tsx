import { createEffect, createMemo, createSignal, onCleanup, untrack, } from 'solid-js'
import { arrayOf, vec2u, vec3f, vec4f } from 'typegpu/data'
import { clamp } from 'typegpu/std'
import { useTimeline } from '@/contexts/TimelineContext'
import { DEBUG_MODE, DEBUG_VRAM } from '@/defaults'
import { accumulatedPointCount, animationExportRunning, exportQuality, setAccumulatedPointCountGlobal, setRenderTimings, } from '@/flame/renderStats'
import { deepClone } from '@/utils/clone'
import { createTimestampQuery } from '@/utils/createTimestampQuery'
import { recordEntries } from '@/utils/record'
import { applyTimelineToFlame } from '@/utils/timeline'
import { useCamera } from '../lib/CameraContext'
import { useCanvas } from '../lib/CanvasContext'
import { useRootContext } from '../lib/RootContext'
import { createAnimationFrame } from '../utils/createAnimationFrame'
import { createAdaptiveBlurPipeline } from './adaptiveBlurPipeline'
import { ColorGradingUniforms, createColorGradingPipeline, } from './colorGrading'
import { createDensityEstimationPipeline } from './densityEstimationPipeline'
import { drawModeToImplFn } from './drawMode'
import { createIFSPipeline } from './ifsPipeline'
import { backgroundColorDefault, backgroundColorDefaultWhite, } from './schema/flameSchema'
import { Bucket, BUCKET_FIXED_POINT_MULTIPLIER, FilterParams } from './types'
import type { v4f } from 'typegpu/data'
import type { Palette } from './colorMap'
import type { FlameDescriptor } from './schema/flameSchema'
import type { ExportImageType } from '@/App'
import type { FlameDescriptor as TimelineFlameDescriptor } from '@/utils/timeline'

const { sqrt, floor } = Math
const { performance } = globalThis

const OUTPUT_EVERY_FRAME_BATCH_INDEX = 20
const OUTPUT_INTERVAL_BATCH_INDEX = 10

// Export driver tuning. During exports the render loop is driven by a
// self-scheduling async loop instead of requestAnimationFrame: rAF cadence is
// owned by the browser compositor, which Chrome collapses under sustained GPU
// queue pressure (and stops entirely in background tabs) — that stalled long
// ultra-quality exports. The export loop submits one bounded chunk at a time
// and awaits queue.onSubmittedWorkDone(), so the GPU queue stays shallow and
// the chunk wall time is an accurate measure of its GPU cost.
const EXPORT_TARGET_CHUNK_MS = 12
const EXPORT_INITIAL_ITERATIONS = 2
const EXPORT_MAX_ITERATIONS = 256
const EXPORT_IDLE_DELAY_MS = 8
const EXPORT_PRESENT_INTERVAL_MS = 250

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

type RenderTickResult = {
  iterations: number
  presented: boolean
  hadWork: boolean
}

type Flam3Props = {
  quality: number
  pointCountPerBatch: number
  renderInterval: number
  adaptiveFilterEnabled: boolean
  animationEnabled: boolean
  flameDescriptor: FlameDescriptor
  edgeFadeColor: v4f
  onExportImage?: ExportImageType
  /** Marks the main workspace renderer: exports (animation/still) switch its
   *  render loop from rAF to the async export driver. Preview instances must
   *  not set this. */
  isExportRenderer?: boolean
  setCurrentQuality?: (fn: () => number) => void
  setQualityPointCountLimit?: (fn: () => number) => void
  palette?: () => Palette | undefined
  outputAlpha?: boolean
  onAccumulatedPointCount?: (count: number) => void
  blendFlame?: FlameDescriptor
  blendWeight?: number
}

export function Flam3(props: Flam3Props) {
  const camera = useCamera()
  const { root, device } = useRootContext()
  const { context, canvasSize, canvas, canvasFormat } = useCanvas()
  const timeline = useTimeline()

  const [animatedFlame, setAnimatedFlame] =
    createSignal<TimelineFlameDescriptor>(deepClone(props.flameDescriptor))

  const backgroundColorFinal = () => {
    const bg = props.flameDescriptor.renderSettings.backgroundColor
    const isPaint = props.flameDescriptor.renderSettings.drawMode !== 'light'

    if (bg === undefined) {
      return isPaint
        ? vec3f(...backgroundColorDefaultWhite)
        : vec3f(...backgroundColorDefault)
    }

    // User explicitly chose a color -- respect it, no auto-swap.
    return vec3f(...bg)
  }

  const bucketProbabilityInv = () => {
    const size = canvasSize()
    const height = size.height
    const unitSquareArea = (height ** 2 * camera.zoom() ** 2) / 4
    return unitSquareArea
  }

  /** u32-safe point cap: prevents per-bucket atomic overflow at high quality */
  const safeQualityCap = () => {
    const size = canvasSize()
    const totalBuckets = size.width * size.height
    const MAX_U32 = 0xffffffff
    const maxPointsPerBucket = Math.floor(
      MAX_U32 / BUCKET_FIXED_POINT_MULTIPLIER,
    )
    // Conservative concentration factor — hottest buckets may be 25x above average
    const concentrationFactor = 25
    return Math.floor((maxPointsPerBucket * totalBuckets) / concentrationFactor)
  }

  const qualityPointCountLimit = () => {
    const q = props.quality
    const rawLimit = bucketProbabilityInv() / (q ** 2 - 2 * q + 1)
    return Math.min(rawLimit, safeQualityCap())
  }

  props.setCurrentQuality?.(
    () => 1 - sqrt(bucketProbabilityInv() / accumulatedPointCount()),
  )
  props.setQualityPointCountLimit?.(qualityPointCountLimit)

  const pointRandomSeeds = root
    .createBuffer(arrayOf(vec2u, props.pointCountPerBatch))
    .$usage('storage')

  const colorGradingUniforms = root
    .createBuffer(ColorGradingUniforms, {
      averagePointCountPerBucketInv: 0,
      exposure: 1,
      backgroundColor: vec4f(0, 0, 0, 0),
      edgeFadeColor: vec4f(0, 0, 0, 0.8),
      vibrancy: 0.5,
      palettePhase: 0,
      paletteSpeed: 0.5,
      paletteEntryCount: 0,
      contrast: 1,
      gamma: 2.2,
      highlightPower: 0.5,
      outputAlpha: 0,
      paletteMode: 0,
    })
    .$usage('uniform')

  const outputTextures = createMemo(() => {
    const { width, height } = canvasSize()
    if (width * height === 0) {
      return
    }

    const accumulationBuffer = root
      .createBuffer(arrayOf(Bucket, width * height))
      .$usage('storage')

    const postprocessBuffer = root
      .createBuffer(arrayOf(Bucket, width * height))
      .$usage('storage')

    const filterParamsBuffer = root
      .createBuffer(arrayOf(FilterParams, width * height))
      .$usage('storage')

    onCleanup(() => {
      accumulationBuffer.destroy()
      postprocessBuffer.destroy()
      filterParamsBuffer.destroy()
    })

    return {
      accumulationBuffer,
      postprocessBuffer,
      filterParamsBuffer,
      textureSize: [width, height] as const,
    }
  })

  const colorGradingPipeline = createMemo(() => {
    const o = outputTextures()
    if (!o) {
      return undefined
    }
    const { textureSize, postprocessBuffer, accumulationBuffer } = o
    const typedPostprocessBuffer = postprocessBuffer
    const typedAccumulationBuffer = accumulationBuffer
    return createColorGradingPipeline(
      root,
      colorGradingUniforms,
      textureSize,
      props.adaptiveFilterEnabled
        ? typedPostprocessBuffer
        : typedAccumulationBuffer,
      canvasFormat,
      drawModeToImplFn[props.flameDescriptor.renderSettings.drawMode],
      props.palette?.(),
    )
  })

  // Create adaptive filter pipelines only when output buffers change (e.g. resize).
  // Quality/curve uniform updates are handled separately below to avoid
  // recreating GPU pipelines on every slider change.
  const runAdaptiveFilter = createMemo(() => {
    const o = outputTextures()
    if (!o) {
      return undefined
    }
    const {
      textureSize,
      accumulationBuffer,
      postprocessBuffer,
      filterParamsBuffer,
    } = o
    const storedQuality =
      animatedFlame().renderSettings.densityEstimationQuality ?? 5
    const qualityK =
      storedQuality > 1 ? storedQuality : 0.5 + (1 - storedQuality) * 19.5
    const estimatorCurve = animatedFlame().renderSettings.estimatorCurve ?? 0.5
    const densityPipeline = createDensityEstimationPipeline(
      root,
      textureSize,
      accumulationBuffer,
      filterParamsBuffer,
      qualityK,
      estimatorCurve,
    )
    const blurPipeline = createAdaptiveBlurPipeline(
      root,
      textureSize,
      accumulationBuffer,
      filterParamsBuffer,
      postprocessBuffer,
    )
    return {
      run: (pass: GPUComputePassEncoder) => {
        densityPipeline.run(pass)
        blurPipeline.run(pass)
      },
      densityPipeline,
    }
  })

  // Update density estimation uniforms without recreating pipelines.
  createEffect(() => {
    const filter = runAdaptiveFilter()
    if (!filter) return
    const storedQuality =
      animatedFlame().renderSettings.densityEstimationQuality ?? 5
    // Map 0-1 quality slider (1=best) to qualityK (0.5=best, 20=worst).
    // Values > 1 are old-format direct qualityK for backward compatibility.
    const qualityK =
      storedQuality > 1 ? storedQuality : 0.5 + (1 - storedQuality) * 19.5
    const estimatorCurve = animatedFlame().renderSettings.estimatorCurve ?? 0.5
    filter.densityPipeline.setQualityK(qualityK)
    filter.densityPipeline.setEstimatorCurve(estimatorCurve)
  })

  const continueRendering = (accumulatedPointCount: number) => {
    return accumulatedPointCount <= qualityPointCountLimit()
  }

  // True while an export (animation or still) should drive this renderer via
  // the async export loop instead of requestAnimationFrame. Only the main
  // workspace renderer opts in via isExportRenderer.
  const exportDriverActive = createMemo(
    () =>
      (props.isExportRenderer ?? false) &&
      (animationExportRunning() || exportQuality() !== undefined),
  )

  const timestampQuery = createTimestampQuery(device, [
    'ifsMs',
    'adaptiveFilterMs',
    'colorGradingMs',
  ])

  // Also returns the flame snapshot so the pipeline creation uses the exact same
  // value — re-reading untrack(animatedFlame) separately can return a different
  // flame when outputTextures() memo re-evaluation causes nested effect flushes.
  const parameterFingerprint = createMemo(() => {
    const flame = animatedFlame()
    const bf = props.blendFlame
    return JSON.stringify({
      transforms: recordEntries(flame.transforms).map(([tid, t]) => ({
        tid,
        variations: recordEntries(t.variations).map(([vid, v]) => ({
          vid,
          type: v.type,
        })),
      })),
      ...(bf && {
        blendTransforms: recordEntries(bf.transforms).map(([tid, t]) => ({
          tid,
          variations: recordEntries(t.variations).map(([vid, v]) => ({
            vid,
            type: v.type,
          })),
        })),
      }),
      colorInitMode: flame.renderSettings.colorInitMode,
      pointInitMode: flame.renderSettings.pointInitMode,
      skipIters: Math.floor(flame.renderSettings.skipIters),
    })
  })

  // Clone flame descriptor and apply timeline keyframes.
  // Explicitly read renderSettings and transforms sub-properties so SolidJS
  // tracks them reliably. JSON.stringify on a store proxy may miss deep paths.
  let cloneRunCount = 0
  createEffect(() => {
    const rs = props.flameDescriptor.renderSettings
    const _rs = {
      exposure: rs.exposure,
      vibrancy: rs.vibrancy,
      palettePhase: rs.palettePhase,
      paletteSpeed: rs.paletteSpeed,
      contrast: rs.contrast,
      gamma: rs.gamma,
      highlightPower: rs.highlightPower,
      skipIters: rs.skipIters,
      drawMode: rs.drawMode,
      colorInitMode: rs.colorInitMode,
      pointInitMode: rs.pointInitMode,
      backgroundColor: rs.backgroundColor,
      camera: rs.camera,
    }
    const _tids = Object.keys(props.flameDescriptor.transforms)
    const flame = deepClone(props.flameDescriptor)
    const enabled = props.animationEnabled
    const hasTracks = timeline ? timeline.tracks().length : 0
    // Read currentFrame in the reactive scope so scrubbing triggers re-run.
    const frame = timeline?.currentFrame() ?? 0
    const isActive = timeline?.isPlaying() || timeline?.isScrubbing()
    if (timeline && enabled && hasTracks > 0 && isActive) {
      applyTimelineToFlame(timeline, flame)
      cloneRunCount++
      if (cloneRunCount <= 3 || cloneRunCount % 90 === 0) {
        if (DEBUG_MODE) {
          console.info(
            `[flam3-clone] run #${cloneRunCount}`,
            `frame=${frame}`,
            `tracks=${hasTracks}`,
            `enabled=${enabled}`,
            `exposure=${_rs.exposure}`,
          )
        }
      }
    } else {
      cloneRunCount++
      if (cloneRunCount <= 3) {
        if (DEBUG_MODE) {
          console.info(
            `[flam3-clone] run #${cloneRunCount}`,
            '(no timeline apply)',
            `enabled=${enabled}`,
            `hasTracks=${hasTracks}`,
            `exposure=${_rs.exposure}`,
          )
        }
      }
    }
    setAnimatedFlame(flame)
  })

  /**
   * Timeline animation playback loop.
   * When isPlaying is true, advances the frame at the configured FPS rate.
   */
  createEffect(() => {
    if (!timeline || !timeline.isPlaying()) {
      if (DEBUG_MODE) {
        console.info('[flam3-playback] stopped (isPlaying=false)')
      }
      return
    }

    const cfg = timeline.config()
    const intervalMs = 1000 / cfg.fps
    if (DEBUG_MODE) {
      console.info(
        `[flam3-playback] starting interval: fps=${cfg.fps} intervalMs=${
          intervalMs
        } tracks=${timeline.tracks().length}`,
      )
    }
    const intervalId = window.setInterval(() => {
      for (let i = 0; i < cfg.timeScale; i++) {
        timeline.advanceFrame()
      }
    }, intervalMs)

    onCleanup(() => {
      clearInterval(intervalId)
    })
  })

  function estimateIterationCount(
    timings: NonNullable<ReturnType<typeof timestampQuery.average>>,
    shouldRenderFinalImage: boolean,
  ) {
    const { ifsMs, adaptiveFilterMs, colorGradingMs } = timings
    if (ifsMs <= 0) {
      return 1
    }
    const frameBudgetMs = 14
    const paintTimeMs =
      Number(shouldRenderFinalImage) *
      (colorGradingMs + Number(props.adaptiveFilterEnabled) * adaptiveFilterMs)
    return clamp(floor((frameBudgetMs - paintTimeMs) / ifsMs), 1, 100)
  }

  // Main render loop — follows the main branch pattern with plain `let` variables
  // inside an outer effect, using rafLoop.redraw() for reactive triggers.
  createEffect(() => {
    const fingerprint = parameterFingerprint()
    const o = outputTextures()
    if (!o || !fingerprint) {
      return undefined
    }

    const { textureSize, accumulationBuffer } = o
    const flame = untrack(animatedFlame)
    const typedAccumulationBuffer = accumulationBuffer

    const ifsPipeline = createIFSPipeline(
      root,
      camera,
      Math.floor(flame.renderSettings.skipIters),
      pointRandomSeeds,
      flame.transforms as never,
      textureSize,
      typedAccumulationBuffer,
      flame.renderSettings.colorInitMode,
      flame.renderSettings.pointInitMode,
      props.blendFlame?.transforms as never,
    )

    let batchIndex = 0
    let accumulatedPointCount_ = 0
    let lastExportRenderedPointCount = -1
    let forceDrawToScreen = false
    let clearRequested = true
    // Interactive estimator state: last iteration count, used to cap growth.
    let lastInteractiveIterationCount = 1
    // Export driver state: chunk size adapted from measured chunk wall time,
    // and the wall-clock time of the last canvas present.
    let exportIterationCount = EXPORT_INITIAL_ITERATIONS
    let lastPresentMs = 0

    // Update IFS pipeline uniforms when animatedFlame changes.
    createEffect(() => {
      const flame = animatedFlame()

      ifsPipeline.update(
        flame as FlameDescriptor,
        props.blendFlame,
        props.blendWeight,
      )
    })

    const accumulationFingerprint = createMemo(() => {
      const flame = animatedFlame()
      const bf = props.blendFlame
      return JSON.stringify({
        transforms: flame.transforms,
        finalTransform: flame.finalTransform,
        colorInitMode: flame.renderSettings.colorInitMode,
        pointInitMode: flame.renderSettings.pointInitMode,
        skipIters: flame.renderSettings.skipIters,
        drawMode: flame.renderSettings.drawMode,
        ...(bf && { blendTransforms: bf.transforms }),
        blendWeight: props.blendWeight,
      })
    })

    // Reset accumulation when any structural or rendering parameter changes
    // (weights, affine, colors, etc.) but ignore color grading post-processing.
    createEffect(() => {
      accumulationFingerprint()
      resetAccumulation()
    })

    // Reset accumulation on animation frame change during playback or scrubbing.
    // Without this, IFS points from different frames accumulate together.
    createEffect(() => {
      if (!timeline) return
      timeline.currentFrame()
      if (
        timeline.isPlaying() ||
        timeline.isScrubbing() ||
        animationExportRunning()
      ) {
        resetAccumulation()
      }
    })

    // Reset accumulation on camera pan/zoom.
    createEffect(() => {
      camera.update()
      if (!animationExportRunning()) resetAccumulation()
    })

    function resetAccumulation() {
      batchIndex = 0
      accumulatedPointCount_ = 0
      lastExportRenderedPointCount = -1
      // Only update the global counter from the main renderer, not preview instances.
      // Preview Flam3 instances provide onAccumulatedPointCount and must not clobber
      // the global signal (which drives the progress bar and quality pills).
      if (!props.onAccumulatedPointCount) {
        setAccumulatedPointCountGlobal(0)
      }
      clearRequested = true
      rafLoop.redraw()
    }

    // Update color grading uniforms.
    createEffect(() => {
      colorGradingUniforms.writePartial({
        exposure: 2 * Math.exp(animatedFlame().renderSettings.exposure),
        edgeFadeColor: props.onExportImage ? vec4f(0) : props.edgeFadeColor,
        backgroundColor: vec4f(backgroundColorFinal(), 1),
        vibrancy: animatedFlame().renderSettings.vibrancy,
        palettePhase: animatedFlame().renderSettings.palettePhase,
        paletteSpeed: animatedFlame().renderSettings.paletteSpeed,
        paletteEntryCount: props.palette?.()?.entries.length ?? 0,
        contrast: animatedFlame().renderSettings.contrast ?? 1,
        gamma: animatedFlame().renderSettings.gamma ?? 2.2,
        highlightPower: animatedFlame().renderSettings.highlightPower ?? 0.5,
        outputAlpha: props.outputAlpha ? 1 : 0,
        paletteMode: animatedFlame().renderSettings.paletteMode ?? 0,
      })
      rafLoop.redraw()
      forceDrawToScreen = true
    })

    // Redraw when color grading pipeline or palette changes.
    createEffect(() => {
      const _ = colorGradingPipeline()
      void props.palette?.()
      rafLoop.redraw()
      forceDrawToScreen = true
    })

    // One render tick: submit a bounded amount of IFS work and, when due, the
    // final-image passes. Shared by the interactive rAF driver and the async
    // export driver. Returns what was submitted so the export driver can pace
    // and size the next chunk.
    function renderTick(frameId: number): RenderTickResult {
      const currentExportCb = props.onExportImage
      const exportMode = exportDriverActive()

      const pointCountPerBatch = props.pointCountPerBatch
      const colorGradingPipeline_ = colorGradingPipeline()
      if (colorGradingPipeline_ === undefined) {
        return { iterations: 0, presented: false, hadWork: false }
      }

      const timings = timestampQuery.average()

      // Periodic preview cadence: batch-indexed when vsync paced (interactive),
      // wall-clock during exports (the export loop tick rate varies with chunk
      // size, so batch counting would present far too often).
      const periodicPresentDue = exportMode
        ? performance.now() - lastPresentMs >= EXPORT_PRESENT_INTERVAL_MS
        : batchIndex < OUTPUT_EVERY_FRAME_BATCH_INDEX ||
          batchIndex % OUTPUT_INTERVAL_BATCH_INDEX === 0

      let iterationCount = 0
      if (continueRendering(accumulatedPointCount_)) {
        if (exportMode) {
          iterationCount = exportIterationCount
        } else if (timings) {
          // Cap growth at 1.5x per tick: without GPU timestamps the ifsMs
          // fallback measures submit→completion wall latency, which on an
          // empty queue under-reports the true cost and would otherwise slam
          // the iteration count straight to the maximum, saturating the GPU
          // queue (Chrome reacts by collapsing the rAF cadence).
          const estimated = estimateIterationCount(
            timings,
            forceDrawToScreen || periodicPresentDue,
          )
          iterationCount = Math.min(
            estimated,
            Math.max(4, Math.ceil(lastInteractiveIterationCount * 1.5)),
          )
          lastInteractiveIterationCount = iterationCount
        } else {
          iterationCount = 1
        }
      }

      const accumulatedAfter =
        accumulatedPointCount_ + pointCountPerBatch * iterationCount

      // Export readiness is decided with the post-accumulation count so the
      // final color-graded render and the capture happen in the same
      // submission — the captured canvas can never lag the accumulation.
      const isExportReady =
        currentExportCb !== undefined && !continueRendering(accumulatedAfter)

      const shouldRenderFinalImage =
        forceDrawToScreen ||
        (isExportReady
          ? accumulatedAfter !== lastExportRenderedPointCount
          : periodicPresentDue)

      const hadWork =
        clearRequested || iterationCount > 0 || shouldRenderFinalImage

      if (!hadWork) {
        // Nothing to submit — still report state so export capture, progress
        // and cancellation keep flowing while the export driver idles.
        currentExportCb?.(canvas, {
          finalImageReady:
            isExportReady &&
            lastExportRenderedPointCount === accumulatedPointCount_,
        })
        return { iterations: 0, presented: false, hadWork: false }
      }

      const encoder = device.createCommandEncoder()

      if (clearRequested) {
        clearRequested = false
        encoder.clearBuffer(accumulationBuffer.buffer)
      }

      if (timings) {
        setRenderTimings({
          ...timings,
          adaptiveFilterMs: props.adaptiveFilterEnabled
            ? timings.adaptiveFilterMs
            : 0,
        })
      }

      const timestampWrites = timestampQuery.timestampWrites(frameId)

      {
        const passDesc: GPUComputePassDescriptor = timestampWrites.ifsMs
          ? { timestampWrites: timestampWrites.ifsMs }
          : {}

        const pass = encoder.beginComputePass(passDesc)
        for (let i = 0; i < iterationCount; i++) {
          ifsPipeline.run(pass, pointCountPerBatch)
        }
        pass.end()

        accumulatedPointCount_ = accumulatedAfter
      }

      if (!props.onAccumulatedPointCount) {
        setAccumulatedPointCountGlobal(accumulatedPointCount_)
      }
      props.onAccumulatedPointCount?.(accumulatedPointCount_)

      if (shouldRenderFinalImage) {
        if (isExportReady) {
          lastExportRenderedPointCount = accumulatedPointCount_
        }
        lastPresentMs = performance.now()
        const skipItersFactor =
          1 + animatedFlame().renderSettings.skipIters * 0.05
        colorGradingUniforms.writePartial({
          averagePointCountPerBucketInv:
            (bucketProbabilityInv() / accumulatedPointCount_) * skipItersFactor,
        })
        if (props.adaptiveFilterEnabled) {
          const passDesc: GPUComputePassDescriptor =
            timestampWrites.adaptiveFilterMs
              ? { timestampWrites: timestampWrites.adaptiveFilterMs }
              : {}
          const pass = encoder.beginComputePass(passDesc)
          runAdaptiveFilter()?.run(pass)
          pass.end()
        }

        {
          const passDesc: GPURenderPassDescriptor = {
            ...(timestampWrites.colorGradingMs
              ? { timestampWrites: timestampWrites.colorGradingMs }
              : {}),
            colorAttachments: [
              {
                loadOp: 'clear',
                storeOp: 'store',
                view: context.getCurrentTexture().createView(),
              },
            ],
          }
          const pass = encoder.beginRenderPass(passDesc)
          colorGradingPipeline_.run(pass)
          pass.end()
        }
      }

      timestampQuery.write(encoder, Math.max(iterationCount, 1))
      device.queue.submit([encoder.finish()])

      if (
        (DEBUG_MODE || DEBUG_VRAM) &&
        batchIndex > 0 &&
        batchIndex % 10 === 0
      ) {
        const rs = animatedFlame().renderSettings
        const paletteSpeed = rs.paletteSpeed ?? 0.5
        const palettePhase = rs.palettePhase ?? 0
        const paletteMode = rs.paletteMode ?? 0
        const vibrancy = rs.vibrancy
        const skipItersFactor = 1 + rs.skipIters * 0.05
        const avgInv =
          (bucketProbabilityInv() / accumulatedPointCount_) * skipItersFactor

        console.info(
          `[ColorGrading Debug] Frame ${batchIndex} | Mode: ${paletteMode} | Speed: ${paletteSpeed.toFixed(2)} | Phase: ${palettePhase.toFixed(2)} | Vibrancy: ${vibrancy.toFixed(2)} | AvgInv: ${avgInv.toExponential(2)}`,
        )

        const paletteScale = 0.02 + paletteSpeed * 0.298
        console.info(` -> paletteScale = ${paletteScale.toFixed(4)}`)

        const mockCounts = [100, 10000, 1000000] // raw counts for low, med, high density
        for (const count of mockCounts) {
          const adjustedCount = count * avgInv * 0.1
          const logDensity = Math.min(
            Math.max(Math.log(adjustedCount + 1), 0),
            10,
          )

          if (paletteMode === 0) {
            const logDensityNorm =
              (logDensity * paletteScale + palettePhase) % 1.0
            const normPositive =
              logDensityNorm < 0 ? logDensityNorm + 1.0 : logDensityNorm
            console.info(
              `    count=${count} (adj=${adjustedCount.toFixed(4)}) -> logDens=${logDensity.toFixed(4)} -> paletteIdxNorm=${normPositive.toFixed(4)}`,
            )
          } else {
            const logDensityNorm = (logDensity * paletteScale) % 1.0
            const normPositive =
              logDensityNorm < 0 ? logDensityNorm + 1.0 : logDensityNorm
            const hueAngle = palettePhase * Math.PI * 2
            const cosH = Math.cos(hueAngle)
            const sinH = Math.sin(hueAngle)
            console.info(
              `    count=${count} (adj=${adjustedCount.toFixed(4)}) -> logDens=${logDensity.toFixed(4)} -> baseIdxNorm=${normPositive.toFixed(4)}, rotAng=${hueAngle.toFixed(2)} (cos=${cosH.toFixed(2)}, sin=${sinH.toFixed(2)})`,
            )
          }
        }
      }

      if (currentExportCb) {
        currentExportCb(canvas, {
          finalImageReady:
            isExportReady &&
            lastExportRenderedPointCount === accumulatedPointCount_,
        })
      }

      device.queue
        .onSubmittedWorkDone()
        .then(() => timestampQuery.read(frameId))
        .catch(() => {})

      batchIndex += 1
      forceDrawToScreen = false
      return {
        iterations: iterationCount,
        presented: shouldRenderFinalImage,
        hadWork: true,
      }
    }

    const rafLoop = createAnimationFrame(
      (frameId) => {
        renderTick(frameId)
      },
      () =>
        continueRendering(accumulatedPointCount_)
          ? props.renderInterval
          : Infinity,
      () => device.queue.onSubmittedWorkDone(),
      exportDriverActive,
    )

    // Export driver: replaces the rAF loop while an export runs. The loop
    // awaits each submission, so at most one chunk is in flight — the browser
    // compositor never sees a deep GPU queue (no rAF collapse in Chrome), the
    // export keeps running in background tabs, and chunk wall time is a valid
    // measurement to size the next chunk with.
    createEffect(() => {
      if (!exportDriverActive()) return

      let disposed = false
      onCleanup(() => {
        disposed = true
      })

      exportIterationCount = EXPORT_INITIAL_ITERATIONS
      let exportFrameId = 0

      const loop = async () => {
        // Leave the effect's tracking scope before the first tick so signal
        // reads inside renderTick don't become dependencies of this effect.
        await Promise.resolve()

        while (!disposed) {
          const startMs = performance.now()
          const tick = renderTick(exportFrameId++)

          if (!tick.hadWork) {
            // Waiting for a capture or the next frame's descriptor.
            await sleep(EXPORT_IDLE_DELAY_MS)
            continue
          }

          try {
            await device.queue.onSubmittedWorkDone()
          } catch {
            // Device lost — stop driving; the app-level handler takes over.
            break
          }

          if (tick.iterations > 0 && !tick.presented) {
            // Size the next chunk toward the GPU-time budget, growing at most
            // 2x per step. Presentation ticks are skipped: their wall time
            // includes the filter/grading passes and would undershoot.
            const chunkMs = Math.max(performance.now() - startMs, 0.5)
            const perIterationMs = chunkMs / tick.iterations
            exportIterationCount = Math.max(
              1,
              Math.min(
                Math.floor(EXPORT_TARGET_CHUNK_MS / perIterationMs),
                exportIterationCount * 2,
                EXPORT_MAX_ITERATIONS,
              ),
            )
          }
        }
      }
      void loop()
    })

    // When quality changes (up or down), force a redraw so the interval function
    // re-evaluates continueRendering() with the updated point limit. Without this,
    // quality downgrades may not immediately stop rendering because the RAF interval
    // callback reads props.quality outside SolidJS tracking context.
    createEffect(() => {
      const q = props.quality
      void q
      rafLoop.redraw()
    })
  })
  return null
}
