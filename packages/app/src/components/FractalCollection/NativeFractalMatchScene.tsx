/** One persistent native cloud renderer presents legal play, capture dispersal and glass fracture. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, untrack, } from 'solid-js'
import { mat4 } from 'wgpu-matrix'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { bindGummyTouchSurface, createGummyCameraInput, } from '../GummyBear/gummyCameraInput'
import { bindGummyGpuErrors } from '../GummyBear/gummyGpuErrors'
import styles from '../GummyBoard/GummyMatchScene.module.css'
import { DEFAULT_BOARD_CAMERA, pickBoardSquare, } from '../PawnBoard/pawnBoardMath'
import { createPawnBoardRenderer } from '../PawnBoard/pawnBoardRenderer'
import { collectionCameraMatrices, pickCollectionInstance, } from './collectionStageCamera'
import { nativeMatchDuration, nativeMatchFrame, nativeMatchMarker, nativeMatchPieces, nativeMatchSquare, } from './nativeFractalMatchFrame'
import { useCollectionClouds } from './useCollectionClouds'
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { GummyOrbit } from '../GummyBear/gummyStudyMath'
import type { CollectionCloud } from './collectionCloudWorker'
import type { NativeFractalMatchLook } from './nativeFractalMatchFrame'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'

export type NativeFractalMatchSceneProps = NativeFractalMatchLook & {
  position: ChessPosition
  receipt?: ChessMoveReceipt
  selectedSquare?: string
  legalSquares: readonly string[]
  onSquare(square: string): void
  onComplete(receipt: ChessMoveReceipt): void
  onReady?(ready: boolean): void
  onError(message: string): void
}
type Marker = { square: string; x: number; y: number }

export function NativeFractalMatchScene(props: NativeFractalMatchSceneProps) {
  const source = useCollectionClouds(
    () => props.collectionId,
    () => 'normal',
  )
  const [markers, setMarkers] = createSignal<Marker[]>([])
  const [visible, setVisible] = createSignal(true)
  createEffect(() => {
    const error = source.error()
    if (error)
      untrack(() => {
        props.onError(error)
      })
  })
  return (
    <div class={styles.scene}>
      <AutoCanvas
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel="Fractal chess board. Tap your piece, then a marked destination. Drag to orbit and use two fingers to pan."
      >
        <NativeMatchCanvas
          {...props}
          clouds={source.clouds()}
          shell={source.shell()}
          visible={visible()}
          onMarkers={setMarkers}
        />
      </AutoCanvas>
      <div class={styles.destinations}>
        <For each={markers()}>
          {(marker) => (
            <button
              type="button"
              class={styles.destination}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              aria-label={`Move to ${marker.square}`}
              title={`Move to ${marker.square}`}
              onClick={() => {
                if (!props.receipt) props.onSquare(marker.square)
              }}
            >
              <span>{marker.square}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function NativeMatchCanvas(
  props: NativeFractalMatchSceneProps & {
    clouds: CollectionCloud[]
    shell?: FractalStudyGlass
    visible: boolean
    onMarkers(markers: Marker[]): void
  },
) {
  const { root, device } = useLiveRootContext()
  const { canvas, context, canvasFormat, canvasSize } = useCanvas()
  const orbit: GummyOrbit = { ...DEFAULT_BOARD_CAMERA }
  const vp = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  const view = new Float32Array(16),
    projection = new Float32Array(16)
  let renderer: ReturnType<typeof createPawnBoardRenderer> | undefined
  let disposed = false,
    failed = false,
    loaded = false,
    ready = false,
    pending = false,
    dirty = false
  let raf = 0,
    elapsed = 0,
    previousTime = 0,
    frames = 0,
    animationGeneration = 0
  let completedReceipt: ChessMoveReceipt | undefined
  let tap: { id: number; x: number; y: number } | undefined
  const state = createMemo(() => ({
    position: props.position,
    receipt: props.receipt,
    selected: props.selectedSquare,
    legal: props.legalSquares,
    look: {
      collectionId: props.collectionId,
      enclosure: props.enclosure,
      scale: props.scale,
    },
  }))

  function fail(cause: unknown) {
    if (disposed || failed) return
    failed = true
    cancelAnimationFrame(raf)
    raf = 0
    props.onMarkers([])
    untrack(() => {
      props.onError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  const releaseErrors = bindGummyGpuErrors(device, fail)
  try {
    renderer = createPawnBoardRenderer(root, device, context, canvasFormat)
  } catch (cause) {
    fail(cause)
  }

  function camera() {
    const size = canvasSize()
    collectionCameraMatrices(
      'board',
      orbit,
      size.width / Math.max(1, size.height),
      vp,
      inverse,
      eye,
      view,
      projection,
    )
    if (orbit.pan) {
      for (let axis = 0; axis < 3; axis++) eye[axis]! += orbit.pan[axis]!
      mat4.lookAt(
        eye,
        [orbit.pan[0], 0.7 + orbit.pan[1], orbit.pan[2]],
        [0, 1, 0],
        view,
      )
      mat4.mul(projection, view, vp)
      mat4.inverse(vp, inverse)
    }
    return size
  }

  function invalidate() {
    dirty = true
    if (!disposed && !failed && !pending && !raf)
      raf = requestAnimationFrame(frame)
  }

  function frame(now: number) {
    raf = 0
    if (
      disposed ||
      failed ||
      !renderer ||
      !loaded ||
      !props.visible ||
      document.visibilityState === 'hidden'
    ) {
      previousTime = 0
      return
    }
    const s = state()
    const generation = animationGeneration
    if (s.receipt && previousTime)
      elapsed += Math.min(0.05, Math.max(0, (now - previousTime) / 1000))
    previousTime = now
    const size = camera()
    if (!size.width || !size.height) return
    const pieces = s.receipt
      ? nativeMatchFrame(s.receipt, elapsed, s.look)
      : nativeMatchPieces(s.position, s.look, s.selected)
    const completed = !!s.receipt && elapsed >= nativeMatchDuration(s.receipt)
    dirty = false
    try {
      renderer.render({
        ...size,
        viewProjection: vp,
        eye,
        pieces,
        selected:
          s.receipt || !s.selected ? undefined : nativeMatchSquare(s.selected),
        legal: s.receipt
          ? []
          : s.legal.flatMap((square) => {
              const parsed = nativeMatchSquare(square)
              return parsed ? [parsed] : []
            }),
        showGlass: s.look.enclosure === 'glass',
        mutedBoard: true,
      })
      props.onMarkers(
        s.receipt
          ? []
          : s.legal.flatMap((square) => {
              const marker = nativeMatchMarker(square, vp)
              return marker ? [marker] : []
            }),
      )
      canvas.dataset.testid = 'native-fractal-match-canvas'
      canvas.dataset.collection = s.look.collectionId
      canvas.dataset.enclosure = s.look.enclosure
      canvas.dataset.fen = s.position.fen
      canvas.dataset.pieces = String(pieces.length)
      canvas.dataset.frames = String(++frames)
      canvas.dataset.animating = String(Boolean(s.receipt))
      if (!ready) {
        ready = true
        untrack(() => props.onReady?.(true))
      }
      pending = true
      void device.queue
        .onSubmittedWorkDone()
        .then(() => {
          pending = false
          if (disposed || failed) return
          if (
            completed &&
            generation === animationGeneration &&
            s.receipt &&
            props.receipt === s.receipt &&
            completedReceipt !== s.receipt
          ) {
            completedReceipt = s.receipt
            props.onComplete(s.receipt)
          }
          if (dirty || (props.receipt && props.receipt !== completedReceipt))
            invalidate()
        })
        .catch(fail)
    } catch (cause) {
      fail(cause)
    }
  }

  createEffect(
    on(
      () => props.receipt,
      () => {
        // A skipped and immediately replayed move can reuse the same receipt object.
        // Fence callbacks belong to a playback generation, not just that object.
        animationGeneration++
        completedReceipt = undefined
        elapsed = 0
        previousTime = 0
        tap = undefined
        invalidate()
      },
    ),
  )

  createEffect(
    on(
      () => props.clouds,
      (clouds) => {
        if (!renderer || failed) return
        loaded = false
        ready = false
        previousTime = 0
        untrack(() => props.onReady?.(false))
        renderer.clearVariantClouds()
        renderer.clearVariantGlass()
        try {
          for (const cloud of clouds)
            renderer.setVariantCloud(
              cloud.key,
              cloud.side,
              cloud.points,
              cloud.colors,
            )
          const shell = props.shell
          if (shell) {
            renderer.setVariantGlass(
              props.collectionId,
              shell.vertices,
              shell.radius,
            )
          }
          loaded = clouds.length === 12
          invalidate()
        } catch (cause) {
          fail(cause)
        }
      },
    ),
  )
  createEffect(() => {
    state()
    canvasSize()
    if (props.visible) invalidate()
    else previousTime = 0
  })

  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'orbit',
    ready: () => ready && !failed,
    cameraRadius: () => {
      camera()
      return Math.hypot(
        eye[0]! - (orbit.pan?.[0] ?? 0),
        eye[1]! - 0.7 - (orbit.pan?.[1] ?? 0),
        eye[2]! - (orbit.pan?.[2] ?? 0),
      )
    },
    cancelGrip() {},
    pick() {},
    moveGrip() {},
  })

  function selectAt(x: number, y: number) {
    if (props.receipt || !ready || failed) return
    camera()
    const bounds = canvas.getBoundingClientRect()
    const nx = ((x - bounds.left) / Math.max(1, bounds.width)) * 2 - 1
    const ny = 1 - ((y - bounds.top) / Math.max(1, bounds.height)) * 2
    const s = state()
    const piece = pickCollectionInstance(
      nx,
      ny,
      inverse,
      nativeMatchPieces(s.position, s.look),
      props.clouds,
    )
    const square = piece?.square ?? pickBoardSquare(nx, ny, inverse)
    if (square) props.onSquare(`${'abcdefgh'[square.file]}${square.rank + 1}`)
  }

  function down(event: PointerEvent) {
    if (tap) tap = undefined
    else if (event.isPrimary && event.button === 0)
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
    input.pointerDown(event)
  }

  function move(event: PointerEvent) {
    if (
      tap?.id === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
    )
      tap = undefined
    const { theta, phi, zoom, pan } = orbit
    input.pointerMove(event)
    if (
      orbit.theta !== theta ||
      orbit.phi !== phi ||
      orbit.zoom !== zoom ||
      orbit.pan !== pan
    )
      invalidate()
  }

  function end(event: PointerEvent) {
    const picked =
      event.type === 'pointerup' && tap?.id === event.pointerId
        ? tap
        : undefined
    tap = undefined
    input.pointerEnd(event)
    if (picked) selectAt(picked.x, picked.y)
    invalidate()
  }

  function wheel(event: WheelEvent) {
    input.wheel(event)
    invalidate()
  }

  function key(event: KeyboardEvent) {
    if (input.cameraKey(event)) event.preventDefault()
    else if (event.key === 'Home') {
      Object.assign(orbit, DEFAULT_BOARD_CAMERA, { pan: undefined })
      event.preventDefault()
    } else return
    invalidate()
  }

  function visibility() {
    previousTime = 0
    invalidate()
  }
  canvas.tabIndex = 0
  canvas.style.cursor = 'grab'
  const releaseTouch = bindGummyTouchSurface(canvas)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('lostpointercapture', end)
  canvas.addEventListener('pointerleave', input.pointerLeave)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', key)
  canvas.addEventListener('contextmenu', input.contextMenu)
  document.addEventListener('visibilitychange', visibility)
  onCleanup(() => {
    disposed = true
    cancelAnimationFrame(raf)
    input.cancel()
    releaseTouch()
    releaseErrors()
    renderer?.destroy()
    context.unconfigure()
    props.onMarkers([])
    props.onReady?.(false)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', end)
    canvas.removeEventListener('pointercancel', end)
    canvas.removeEventListener('lostpointercapture', end)
    canvas.removeEventListener('pointerleave', input.pointerLeave)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('keydown', key)
    canvas.removeEventListener('contextmenu', input.contextMenu)
    document.removeEventListener('visibilitychange', visibility)
  })
  return null
}
