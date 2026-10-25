/** Native point clouds and glass share a deterministic, queued renderer for preview and video export. */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { resolveNativeCinemaReceipt } from '@/pages/GummyBoard/nativeCinemaRecipe'
import { bindGummyGpuErrors } from '../GummyBear/gummyGpuErrors'
import { createPawnBoardRenderer } from '../PawnBoard/pawnBoardRenderer'
import { NATIVE_CINEMA_DURATION, nativeCinemaCamera, nativeCinemaTime, } from './nativeCinemaCamera'
import { createNativeCinemaCapture } from './nativeCinemaCapture'
import { createNativeCinemaResources } from './nativeCinemaResources'
import { nativeMatchFrame } from './nativeFractalMatchFrame'
import { useCollectionClouds } from './useCollectionClouds'
import type { CinemaPlaybackController } from '../GummyBoard/cinemaPlaybackController'
import type { CollectionCloud } from './collectionCloudWorker'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

export type NativeFractalCinemaController = CinemaPlaybackController & {
  readState(): {
    displayTime: number
    effectTime: number
    beforeFen: string
    afterFen: string
    pieces: ReturnType<typeof nativeMatchFrame>
  }
}

type CaptureSize = { width: number; height: number }
type Props = {
  recipe: NativeCinemaRecipe
  onController(controller: NativeFractalCinemaController | undefined): void
  onProgress(time: number, playing: boolean): void
  onReady(ready: boolean): void
  onError(message: string): void
}

/** Retain the renderer across shot edits and cache two bounded sampling results for comparisons. */
export function NativeFractalCinemaScene(props: Props) {
  const quality = createMemo(() =>
    props.recipe.quality === 'fine' ? 'high' : 'normal',
  )
  const source = useCollectionClouds(
    () => props.recipe.nativeCollection.id,
    quality,
    { maxEntries: 2, maxBytes: 32 * 1024 * 1024, includeSolids: true },
  )
  const [captureSize, setCaptureSize] = createSignal<CaptureSize>()
  const [visible, setVisible] = createSignal(true)
  createEffect(() => {
    const error = source.error()
    if (error)
      untrack(() => {
        props.onError(error)
      })
  })
  return (
    <AutoCanvas
      pixelRatio={1}
      fixedResolution={captureSize()}
      onVisibilityChange={setVisible}
      role="img"
      ariaLabel="Fractal chess cinematic capture preview"
    >
      <NativeCinemaCanvas
        {...props}
        clouds={source.clouds()}
        sourceKey={source.resultKey()}
        shell={source.shell()}
        solidShell={source.solidShell()}
        solids={source.solids()}
        solidError={source.solidError()}
        visible={visible()}
        setCaptureSize={setCaptureSize}
      />
    </AutoCanvas>
  )
}

function NativeCinemaCanvas(
  props: Props & {
    clouds: CollectionCloud[]
    sourceKey: string
    shell?: FractalStudyGlass
    solidShell?: FractalStudyGlass
    solids?: WindowRookFracture[]
    solidError: string
    visible: boolean
    setCaptureSize(size: CaptureSize | undefined): void
  },
) {
  const { root, device } = useLiveRootContext()
  const { canvas, context, canvasFormat, canvasSize } = useCanvas()
  let recipe = untrack(() => props.recipe)
  let receipt = resolveNativeCinemaReceipt(recipe)
  let look = {
    collectionId: recipe.nativeCollection.id,
    enclosure: recipe.nativeCollection.enclosure,
    scale: recipe.scale,
  }
  let renderer: ReturnType<typeof createPawnBoardRenderer> | undefined
  let capture: ReturnType<typeof createNativeCinemaCapture> | undefined
  let disposed = false,
    ready = false,
    loaded = false,
    playing = false
  let failure: string | undefined
  let displayTime = 0,
    previous = 0,
    raf = 0,
    pendingActions = 0
  let queue = Promise.resolve()
  let revision = 0
  let upload: ReturnType<typeof createNativeCinemaResources> | undefined

  function stopFrame() {
    cancelAnimationFrame(raf)
    raf = 0
    previous = 0
  }

  function fail(cause: unknown) {
    if (disposed || failure) return
    failure = cause instanceof Error ? cause.message : String(cause)
    playing = false
    ready = false
    stopFrame()
    untrack(() => {
      props.onReady(false)
      props.onError(failure!)
      props.onProgress(displayTime, false)
    })
  }
  const releaseErrors = bindGummyGpuErrors(device, fail)
  try {
    renderer = createPawnBoardRenderer(root, device, context, canvasFormat)
    upload = createNativeCinemaResources(renderer)
  } catch (cause) {
    fail(cause)
  }

  function assertLive() {
    if (disposed) throw new Error('This shot has been replaced.')
    if (failure) throw new Error(failure)
  }

  function schedule() {
    if (
      !disposed &&
      !failure &&
      playing &&
      ready &&
      !pendingActions &&
      !raf &&
      props.visible &&
      !document.hidden
    )
      raf = requestAnimationFrame((now) => {
        void frame(now)
      })
  }

  function enqueue<T>(action: () => Promise<T>) {
    pendingActions++
    const pending = queue
      .then(async () => {
        assertLive()
        return await action()
      })
      .finally(() => {
        pendingActions--
        schedule()
      })
    queue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }

  function paused<T>(action: () => Promise<T>) {
    playing = false
    stopFrame()
    return enqueue(action)
  }

  const pieces = () =>
    nativeMatchFrame(receipt, nativeCinemaTime(displayTime), look).map(
      (piece) =>
        recipe.fracture === 'connected' &&
        look.collectionId === 'lattice-court' &&
        piece.role === 'rook'
          ? {
              ...piece,
              solidKey: piece.cloudKey,
              glassKey: piece.glassKey ? `${piece.glassKey}:solid` : undefined,
            }
          : piece,
    )

  async function draw(output?: GPUTextureView) {
    assertLive()
    if (!renderer || !loaded || props.recipe !== recipe) return false
    const size = canvasSize()
    if (size.width < 1 || size.height < 1) return false
    const camera = nativeCinemaCamera(
      receipt,
      props.clouds,
      recipe,
      displayTime,
      size.width / size.height,
    )
    const framePieces = pieces()
    renderer.render(
      {
        ...size,
        viewProjection: camera.viewProjection,
        eye: camera.eye,
        pieces: framePieces,
        legal: [],
        showGlass: look.enclosure === 'glass',
        mutedBoard: true,
      },
      output,
    )
    canvas.dataset.testid = 'native-cinema-canvas'
    canvas.dataset.time = displayTime.toFixed(4)
    canvas.dataset.collection = look.collectionId
    canvas.dataset.enclosure = look.enclosure
    canvas.dataset.pieces = String(framePieces.length)
    await device.queue.onSubmittedWorkDone()
    assertLive()
    const current = canvasSize()
    return (
      props.recipe === recipe &&
      current.width === size.width &&
      current.height === size.height
    )
  }

  function markReady(rendered: boolean, expected = revision) {
    if (
      !rendered ||
      expected !== revision ||
      disposed ||
      failure ||
      ready ||
      pendingActions
    )
      return
    ready = true
    untrack(() => {
      props.onReady(true)
    })
  }

  async function refresh() {
    const expected = revision
    markReady(await enqueue(draw), expected)
  }

  async function seek(
    frameNumber: number,
    fps: number,
    output?: GPUTextureView,
  ) {
    if (!ready) throw new Error('The shot is still loading.')
    if (
      !Number.isSafeInteger(frameNumber) ||
      frameNumber < 0 ||
      !Number.isFinite(fps) ||
      fps < 1 ||
      fps > 120
    )
      throw new RangeError('Frame and frame rate must be valid.')
    displayTime = Math.min(NATIVE_CINEMA_DURATION, frameNumber / fps)
    if (!(await draw(output)))
      throw new Error('The canvas changed size during this frame. Try again.')
    untrack(() => {
      props.onProgress(displayTime, false)
    })
  }

  async function resize(size: CaptureSize | undefined) {
    if (
      size &&
      [size.width, size.height].some(
        (value) =>
          !Number.isInteger(value) ||
          value < 1 ||
          value > Math.min(4096, device.limits.maxTextureDimension2D),
      )
    )
      throw new RangeError('This GPU cannot render the requested video size.')
    capture?.destroy()
    capture = undefined
    props.setCaptureSize(size)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assertLive()
    if (size && (canvas.width !== size.width || canvas.height !== size.height))
      throw new Error(
        'The canvas could not switch to the requested video size.',
      )
    await draw()
  }

  const controller: NativeFractalCinemaController = {
    info: () => ({
      ready,
      displayDuration: NATIVE_CINEMA_DURATION,
      displayTime,
      error: failure,
      shotId: `native-${receipt.from}-${receipt.to}`,
    }),
    resetPaused: () =>
      paused(async () => {
        await seek(0, 60)
      }),
    seekFrame: (frameNumber, fps = 60) => paused(() => seek(frameNumber, fps)),
    setCaptureSize: (size) => paused(() => resize(size)),
    captureFrame: (frameNumber, fps) =>
      paused(async () => {
        const { width, height } = canvasSize()
        if (!capture || capture.width !== width || capture.height !== height) {
          capture?.destroy()
          capture = undefined
          capture = createNativeCinemaCapture(
            device,
            canvasFormat,
            width,
            height,
          )
        }
        await seek(frameNumber, fps, capture.view)
        const bitmap = await capture.read()
        try {
          assertLive()
        } catch (error) {
          bitmap.close()
          throw error
        }
        return bitmap
      }),
    render: () =>
      paused(async () => {
        await draw()
      }),
    play() {
      if (!ready || pendingActions || failure || disposed) return
      if (displayTime >= NATIVE_CINEMA_DURATION) displayTime = 0
      playing = true
      previous = 0
      untrack(() => {
        props.onProgress(displayTime, true)
      })
      schedule()
    },
    pause() {
      playing = false
      stopFrame()
      if (!disposed)
        untrack(() => {
          props.onProgress(displayTime, false)
        })
    },
    readState: () => ({
      displayTime,
      effectTime: nativeCinemaTime(displayTime),
      beforeFen: receipt.before.fen,
      afterFen: receipt.after.fen,
      pieces: pieces(),
    }),
  }
  untrack(() => {
    props.onController(controller)
  })

  async function frame(now: number) {
    raf = 0
    if (!playing || disposed || failure || !props.visible || document.hidden) {
      previous = 0
      return
    }
    const delta = previous
      ? Math.min(0.05, Math.max(0, (now - previous) / 1000))
      : 0
    previous = now
    try {
      await enqueue(async () => {
        if (!playing) return
        displayTime = Math.min(NATIVE_CINEMA_DURATION, displayTime + delta)
        if (!(await draw())) return
        if (displayTime >= NATIVE_CINEMA_DURATION) playing = false
        untrack(() => {
          props.onProgress(displayTime, playing)
        })
      })
    } catch (cause) {
      fail(cause)
    }
  }

  createEffect(
    on(
      () => [props.recipe, props.clouds, props.sourceKey] as const,
      ([next, clouds]) => {
        const expected = ++revision
        playing = false
        ready = false
        stopFrame()
        props.onReady(false)
        const samplingKey = `${next.nativeCollection.id}:${next.quality === 'fine' ? 'high' : 'normal'}:solids`
        if (
          !renderer ||
          failure ||
          clouds.length !== 12 ||
          props.sourceKey !== samplingKey
        )
          return
        const shell = props.shell
        const solids = props.solids
        const solidShell = props.solidShell
        if (
          next.fracture === 'connected' &&
          (!solids?.length ||
            (next.nativeCollection.enclosure === 'glass' && !solidShell))
        ) {
          props.onError(
            props.solidError ||
              'The connected solid could not be prepared for this collection.',
          )
          return
        }
        void enqueue(async () => {
          if (expected !== revision) return false
          recipe = next
          receipt = resolveNativeCinemaReceipt(recipe)
          look = {
            collectionId: recipe.nativeCollection.id,
            enclosure: recipe.nativeCollection.enclosure,
            scale: recipe.scale,
          }
          displayTime = 0
          upload?.(recipe, clouds, shell, solids, solidShell)
          loaded = true
          return await draw()
        })
          .then((rendered) => {
            markReady(rendered, expected)
          })
          .catch(fail)
      },
    ),
  )
  createEffect(() => {
    canvasSize()
    if (loaded) void refresh().catch(fail)
  })
  const visibility = () => {
    if (!props.visible || document.hidden) stopFrame()
    else schedule()
  }
  createEffect(visibility)
  document.addEventListener('visibilitychange', visibility)
  onCleanup(() => {
    disposed = true
    playing = false
    ready = false
    stopFrame()
    document.removeEventListener('visibilitychange', visibility)
    releaseErrors()
    capture?.destroy()
    renderer?.destroy()
    context.unconfigure()
    props.onReady(false)
    props.onController(undefined)
  })
  return null
}
