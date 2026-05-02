import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { arrayOf, vec2u, vec3f, vec4f } from 'typegpu/data'
import { clamp } from 'typegpu/std'
import { useTimeline } from '@/contexts/TimelineContext'
import { setRenderTimings } from '@/flame/renderStats'
import { createTimestampQuery } from '@/utils/createTimestampQuery'
import { applyTimelineToFlame } from '@/utils/timeline'
import { useCamera } from '../lib/CameraContext'
import { useCanvas } from '../lib/CanvasContext'
import { useRootContext } from '../lib/RootContext'
import { createAnimationFrame } from '../utils/createAnimationFrame'
import { createBlurPipeline } from './blurPipeline'
import { ColorGradingUniforms, createColorGradingPipeline, } from './colorGrading'
import { drawModeToImplFn } from './drawMode'
import { createIFSPipeline } from './ifsPipeline'
import { backgroundColorDefault, backgroundColorDefaultWhite, } from './schema/flameSchema'
import { Bucket } from './types'
import type { TgpuBuffer, WgslArray } from 'typegpu'
import type { v4f } from 'typegpu/data'
import type { Palette } from './colorMap'
import type { FlameDescriptor } from './schema/flameSchema'
import type { ExportImageType } from '@/App'
import type { FlameDescriptor as TimelineFlameDescriptor } from '@/utils/timeline'

const { sqrt, floor } = Math

const OUTPUT_EVERY_FRAME_BATCH_INDEX = 20
const OUTPUT_INTERVAL_BATCH_INDEX = 10

type Flam3Props = {
  quality: number
  pointCountPerBatch: number
  renderInterval: number
  adaptiveFilterEnabled: boolean
  animationEnabled: boolean
  flameDescriptor: FlameDescriptor
  edgeFadeColor: v4f
  onExportImage?: ExportImageType
  setCurrentQuality?: (fn: () => number) => void
  setQualityPointCountLimit?: (fn: () => number) => void
  palette?: Palette
  onEnterAnimation?: () => void
}

export function Flam3(props: Flam3Props) {
  const camera = useCamera()
  const { root, device } = useRootContext()
  const { context, canvasSize, canvas, canvasFormat } = useCanvas()
  const timeline = useTimeline()

  // Add enter animation mode button state (to be implemented in App.tsx)

  // Create a copy of flameDescriptor that timeline will modify
  const [animatedFlame, setAnimatedFlame] =
    createSignal<TimelineFlameDescriptor>(
      JSON.parse(JSON.stringify(props.flameDescriptor)),
    )

  // Apply timeline values to animatedFlame
  // Must use structuredClone to avoid mutating the original reactive store
  createEffect(() => {
    const flame = JSON.parse(JSON.stringify(props.flameDescriptor))
    if (timeline && props.animationEnabled) {
      applyTimelineToFlame(timeline, flame)
    }
    setAnimatedFlame(flame)
  })

  const backgroundColorFinal = () => {
    if (props.flameDescriptor.renderSettings.backgroundColor === undefined) {
      return props.flameDescriptor.renderSettings.drawMode === 'light'
        ? vec3f(...backgroundColorDefault)
        : vec3f(...backgroundColorDefaultWhite)
    }
    return vec3f(...props.flameDescriptor.renderSettings.backgroundColor)
  }

  const bucketProbabilityInv = () => {
    const size = canvasSize()
    const height = size?.height ?? 600
    const unitSquareArea = (height ** 2 * camera.zoom() ** 2) / 4
    return unitSquareArea
  }

  const qualityPointCountLimit = () => {
    const q = props.quality
    return bucketProbabilityInv() / (q ** 2 - 2 * q + 1)
  }

  const [_accumulatedPointCount, _setAccumulatedPointCount] = createSignal(0)
  const [_batchIndex, _setBatchIndex] = createSignal(0)

  props.setCurrentQuality?.(
    () => 1 - sqrt(bucketProbabilityInv() / _accumulatedPointCount()),
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
      paletteEntryCount: 0,
    })
    .$usage('uniform')

  let outputTextures:
    | {
        accumulationBuffer: ReturnType<typeof root.createBuffer>
        postprocessBuffer: ReturnType<typeof root.createBuffer>
        textureSize: readonly [number, number]
      }
    | undefined = undefined

  // Reactive counter so downstream effects know when buffers change.
  // SolidJS cannot track a plain `let` variable, so the render-loop effect
  // would fire once (seeing undefined) and never re-run.
  // Uses a counter (not boolean) because setOutputTexturesReady(true) is a
  // no-op when already true — the render loop must re-run on every resize.
  const [outputTexturesReady, setOutputTexturesReady] = createSignal(0)

  // Initialize buffers at component mount - they persist until cleanup
  // Use fallback dimensions if canvasSize isn't available yet (ResizeObserver
  // hasn't fired). When it does fire, this effect re-runs with actual size.
  createEffect(() => {
    const size = canvasSize()
    const width = Math.floor(size?.width ?? 800)
    const height = Math.floor(size?.height ?? 600)

    const newTex = {
      accumulationBuffer: root
        .createBuffer(arrayOf(Bucket, width * height))
        .$usage('storage'),
      postprocessBuffer: root
        .createBuffer(arrayOf(Bucket, width * height))
        .$usage('storage'),
      textureSize: [width, height] as const,
    }

    // Old buffers are NOT destroyed — they may still be referenced by in-flight
    // GPU work from other pipelines (blur, color grading). Letting GC handle
    // reclamation avoids "Buffer used while destroyed" errors.
    outputTextures = newTex
    setOutputTexturesReady((prev) => prev + 1)
    return newTex
  })

  // Buffers are intentionally NOT destroyed on cleanup — they may still be
  // referenced by in-flight GPU work. GC handles reclamation safely.

  const colorGradingPipeline = createMemo(() => {
    void outputTexturesReady() // re-run when buffers are created
    const o = outputTextures
    if (!o) {
      return undefined
    }
    const { textureSize, postprocessBuffer, accumulationBuffer } = o
    const typedPostprocessBuffer = postprocessBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >
    const typedAccumulationBuffer = accumulationBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >
    return createColorGradingPipeline(
      root,
      colorGradingUniforms,
      textureSize,
      props.adaptiveFilterEnabled
        ? typedPostprocessBuffer
        : typedAccumulationBuffer,
      canvasFormat,
      drawModeToImplFn[props.flameDescriptor.renderSettings.drawMode],
      props.palette,
    )
  })

  const runBlur = createMemo(() => {
    void outputTexturesReady() // re-run when buffers are created
    const o = outputTextures
    if (!o) {
      return undefined
    }
    const { textureSize, accumulationBuffer, postprocessBuffer } = o
    const typedAccumulationBuffer = accumulationBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >
    const typedPostprocessBuffer = postprocessBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >
    return createBlurPipeline(
      root,
      textureSize,
      typedAccumulationBuffer,
      typedPostprocessBuffer,
    )
  })

  const continueRendering = (accumulatedPointCount: number) => {
    return accumulatedPointCount <= qualityPointCountLimit()
  }

  const timestampQuery = createTimestampQuery(device, [
    'ifsMs',
    'adaptiveFilterMs',
    'colorGradingMs',
  ])

  // Structural fingerprint memo: only changes when shader-affecting properties change.
  // This prevents the IFS pipeline (and its WGSL shaders) from being recreated
  // on every frame when only numeric uniform values change.
  const transformStructure = createMemo(() => {
    const flame = animatedFlame()
    const keys = Object.keys(flame.transforms)
    const structure = keys
      .map((tid) => {
        const tr = flame.transforms[tid]
        const vTypes = Object.keys(tr.variations)
          .map((vid) => tr.variations[vid]?.type)
          .sort()
        return `${tid}:${vTypes.join(',')}`
      })
      .sort()
      .join('|')
    return `${structure}::${flame.renderSettings.colorInitMode}::${flame.renderSettings.pointInitMode}::${flame.renderSettings.skipIters}`
  })

  /**
   * Timeline animation playback loop.
   * When isPlaying is true, advances the frame at the configured FPS rate.
   */
  createEffect(() => {
    if (!timeline || !timeline.isPlaying()) return

    const intervalMs = 1000 / timeline.config().fps
    const intervalId = window.setInterval(() => {
      timeline.advanceFrame()
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
    const result = clamp(floor((frameBudgetMs - paintTimeMs) / ifsMs), 1, 100)
    return result
  }

  createEffect(() => {
    // Subscribe to the signal so this effect re-runs when buffers are ready.
    void outputTexturesReady()
    // Track structural changes only — numeric uniform values are updated
    // via ifsPipeline.update() and don't require pipeline rebuild.
    void transformStructure()

    const tex = outputTextures
    if (!tex) {
      return undefined
    }

    const { textureSize, accumulationBuffer, postprocessBuffer } = tex

    // Add type assertions to satisfy typegpu's strict buffer typing
    const typedAccumulationBuffer = accumulationBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >
    const _typedPostprocessBuffer = postprocessBuffer as TgpuBuffer<
      WgslArray<typeof Bucket>
    >

    const ifsPipeline = createIFSPipeline(
      root,
      camera,
      untrack(animatedFlame).renderSettings.skipIters,
      pointRandomSeeds,
      untrack(animatedFlame).transforms as never,
      textureSize,
      typedAccumulationBuffer,
      untrack(animatedFlame).renderSettings.colorInitMode,
      untrack(animatedFlame).renderSettings.pointInitMode,
    )

    createEffect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ifsPipeline.update(animatedFlame() as any)
      camera.update()
    })

    createEffect(() => {
      colorGradingUniforms.writePartial({
        exposure: 2 * Math.exp(animatedFlame().renderSettings.exposure),
        edgeFadeColor: props.onExportImage ? vec4f(0) : props.edgeFadeColor,
        backgroundColor: vec4f(backgroundColorFinal(), 1),
        vibrancy: animatedFlame().renderSettings.vibrancy,
        paletteEntryCount: props.palette?.entries.length ?? 0,
      })
    })

    createEffect(() => {
      const _ = colorGradingPipeline()
      void props.palette // track palette changes
    })

    const [forceDrawToScreen, setForceDrawToScreen] = createSignal(true)
    const [clearRequested, setClearRequested] = createSignal(true)

    createAnimationFrame(
      (frameId: number) => {
        // Create a new command encoder for each frame
        const encoder = device.createCommandEncoder()

        /**
         * Rendering to screen is expensive because it involves
         * blurring and color grading. We only want to do this
         * in the beginning while the image is still forming.
         * Later on, we can trade off rendering to screen for
         * convergence speed.
         */
        const shouldRenderFinalImage =
          forceDrawToScreen() ||
          _batchIndex() < OUTPUT_EVERY_FRAME_BATCH_INDEX ||
          _batchIndex() % OUTPUT_INTERVAL_BATCH_INDEX === 0 ||
          props.onExportImage !== undefined

        const pointCountPerBatch = props.pointCountPerBatch
        const colorGradingPipeline_ = colorGradingPipeline()
        if (colorGradingPipeline_ === undefined) {
          return
        }

        const timings = timestampQuery.average()
        const iterationCount = continueRendering(_accumulatedPointCount())
          ? timings
            ? estimateIterationCount(timings, shouldRenderFinalImage)
            : 1
          : 0

        if (clearRequested()) {
          encoder.clearBuffer(accumulationBuffer.buffer)
          setClearRequested(false)
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
          for (let i = 0; i < iterationCount; i++) {
            const pass = encoder.beginComputePass({
              timestampWrites: timestampWrites.ifsMs,
            })
            ifsPipeline.run(pass, pointCountPerBatch)
            pass.end()
          }

          _setAccumulatedPointCount(
            _accumulatedPointCount() + pointCountPerBatch * iterationCount,
          )
        }

        if (shouldRenderFinalImage) {
          colorGradingUniforms.writePartial({
            averagePointCountPerBucketInv:
              bucketProbabilityInv() / _accumulatedPointCount(),
          })
          if (props.adaptiveFilterEnabled) {
            const pass = encoder.beginComputePass({
              timestampWrites: timestampWrites.adaptiveFilterMs,
            })
            runBlur()?.(pass)
            pass.end()
          }

          {
            const pass = encoder.beginRenderPass({
              timestampWrites: timestampWrites.colorGradingMs,
              colorAttachments: [
                {
                  loadOp: 'clear',
                  storeOp: 'store',
                  view: context.getCurrentTexture().createView(),
                },
              ],
            })
            colorGradingPipeline_.run(pass)
            pass.end()
          }
        }

        timestampQuery.write(encoder)
        device.queue.submit([encoder.finish()])

        device.queue.onSubmittedWorkDone().then(() => {
          timestampQuery.read(frameId).catch(() => {})
        }).catch(() => {})

        props.onExportImage?.(canvas)

        _setBatchIndex(_batchIndex() + 1)
        setForceDrawToScreen(false)
      },
      continueRendering(_accumulatedPointCount())
        ? () => props.renderInterval
        : 0,
      () => Promise.resolve(device.queue.onSubmittedWorkDone()),
    )
  })
  return null
}
