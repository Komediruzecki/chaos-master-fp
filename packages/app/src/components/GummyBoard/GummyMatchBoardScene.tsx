/** Persistent playable board, orbit and GPU renderer shared across capture presentations. */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { gummyAuthoredPawnKey } from '@/simulation/gummy/gummyAuthoredPawn'
import { bindGummyTouchSurface, createGummyCameraInput, } from '../GummyBear/gummyCameraInput'
import { bindGummyGpuErrors } from '../GummyBear/gummyGpuErrors'
import { gummyRay } from '../GummyBear/gummyStudyMath'
import { gummyBoardCameraMatrices, gummyBoardCameraRadius, initialGummyBoardOrbit, } from './gummyBoardCamera'
import { pickGummyBoardMould } from './gummyBoardPicking'
import { resolveGummyBoardQuality } from './gummyBoardQuality'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import { gummyMatchFloorSquare, gummyMatchMoveFrame, gummyMatchPieces, gummyMatchSquareMarker, } from './gummyMatchPresentation'
import styles from './GummyMatchScene.module.css'
import type { ChessMoveReceipt } from '@chaos-master/core/chess/chessGame'
import type { ParentProps } from 'solid-js'
import type { GummyOrbit } from '../GummyBear/gummyStudyMath'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { GummyMatchSceneProps } from './GummyMatchScene'

type GummyMatchBoardSceneProps = GummyMatchSceneProps & {
  restMeshPool: GummyBoardRestMeshPool
  orbit: GummyOrbit
  locked: boolean
}

type Marker = { square: string; x: number; y: number }

export function GummyMatchBoardScene(props: GummyMatchBoardSceneProps) {
  const [markers, setMarkers] = createSignal<Marker[]>([])
  const [visible, setVisible] = createSignal(true)
  const quality = createMemo(() =>
    resolveGummyBoardQuality(
      props.quality,
      typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse), (max-width: 900px)').matches,
    ),
  )
  const rendererKey = createMemo(
    () => `${quality().name}:${gummyAuthoredPawnKey(props.authoredPawn)}`,
  )
  return (
    <div class={styles.scene}>
      <AutoCanvas
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel="Gummy chess board. Tap your piece, then a marked destination. Drag to orbit and use two fingers to pan."
      >
        <MatchCanvasLifetime>
          <Show when={rendererKey()} keyed>
            {(_key) => (
              <NativeMatchScene
                {...props}
                renderQuality={quality()}
                visible={visible()}
                onMarkers={setMarkers}
              />
            )}
          </Show>
        </MatchCanvasLifetime>
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
                props.onSquare(marker.square)
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

/** Release presentation storage on leaving chess, not on a quality-only renderer swap. */
function MatchCanvasLifetime(props: ParentProps) {
  const { context } = useCanvas()
  onCleanup(() => {
    context.unconfigure()
  })
  return <>{props.children}</>
}

function NativeMatchScene(
  props: GummyMatchBoardSceneProps & {
    renderQuality: ReturnType<typeof resolveGummyBoardQuality>
    visible: boolean
    onMarkers: (markers: Marker[]) => void
  },
) {
  const { root, device } = useLiveRootContext()
  const { canvas, context, canvasFormat, canvasSize } = useCanvas()
  let renderer: Awaited<ReturnType<typeof createGummyBoardRenderer>> | undefined
  let disposed = false,
    failed = false,
    ready = false,
    pending = false
  let raf = 0,
    frames = 0,
    previousView = '',
    previousTime = 0,
    elapsed = 0
  let previousState: ReturnType<typeof state> | undefined
  let previousReceipt: ChessMoveReceipt | undefined
  let completedReceipt: ChessMoveReceipt | undefined
  const orbit = props.orbit
  const vp = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  const view = new Float32Array(16),
    projection = new Float32Array(16)
  const state = createMemo(() => ({
    position: props.position,
    receipt: props.receipt,
    selected: props.selectedSquare,
    legal: props.legalSquares,
    settings: props.settings,
    scale: props.scale,
    theme: props.theme,
  }))
  untrack(() => props.onReady?.(false))

  function camera() {
    const size = canvasSize()
    gummyBoardCameraMatrices(
      orbit,
      size.width / Math.max(1, size.height),
      'board',
      vp,
      inverse,
      eye,
      view,
      projection,
    )
    return size
  }

  function rayAt(x: number, y: number) {
    const bounds = canvas.getBoundingClientRect()
    camera()
    return gummyRay(
      (2 * (x - bounds.left)) / Math.max(1, bounds.width) - 1,
      1 - (2 * (y - bounds.top)) / Math.max(1, bounds.height),
      inverse,
    )
  }

  function fail(message: string) {
    if (disposed || failed) return
    failed = true
    props.onMarkers([])
    untrack(() => {
      props.onError(message)
    })
  }
  const releaseErrors = bindGummyGpuErrors(device, fail)
  const preparation = new AbortController()
  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'orbit',
    ready: () => ready && !failed && !props.locked,
    cameraRadius: () =>
      gummyBoardCameraRadius(
        orbit,
        canvasSize().width / Math.max(1, canvasSize().height),
        'board',
      ),
    cancelGrip() {},
    pick() {},
    moveGrip() {},
  })
  createEffect(() => {
    if (props.locked) {
      tap = undefined
      input.cancel()
    }
  })
  void createGummyBoardRenderer(
    root,
    device,
    context,
    canvasFormat,
    undefined,
    undefined,
    {
      lightResolution: props.renderQuality.lightResolution,
      artStyle: 'sculpted',
      signal: preparation.signal,
      restMeshPool: props.restMeshPool,
      restSpacing: 0.08,
      authoredPawn: props.authoredPawn,
    },
  )
    .then((created) => {
      if (disposed) created.destroy()
      else renderer = created
    })
    .catch((error: unknown) => {
      fail(
        error instanceof Error
          ? error.message
          : 'The chess board could not load.',
      )
    })

  function draw(progress: number) {
    if (!renderer) return
    const size = camera()
    if (size.width < 1 || size.height < 1) return
    const s = state()
    const pieces = s.receipt
      ? gummyMatchMoveFrame(s.receipt, progress, s.scale, s.settings.palette)
      : gummyMatchPieces(s.position, s.scale, s.settings.palette)
    renderer.render(
      {
        ...size,
        viewProjection: vp,
        inverseViewProjection: inverse,
        eye,
        palette: s.settings.palette,
        floor: 'chess',
      },
      {
        pieces,
        victimId: 0,
        victimPosition: [0, 0, 0],
        revision: 0,
        movingPieceId: s.receipt?.pieceId,
        selectedPieceId: s.position.pieces.find((p) => p.square === s.selected)
          ?.id,
        caustics: s.settings.caustics,
        boardTheme: s.theme,
      },
    )
    props.onMarkers(
      s.receipt
        ? []
        : s.legal.flatMap((square) => {
            const marker = gummyMatchSquareMarker(square, vp)
            return marker ? [marker] : []
          }),
    )
    canvas.dataset.testid = 'gummy-match-canvas'
    canvas.dataset.fen = s.position.fen
    canvas.dataset.pieces = String(pieces.length)
    canvas.dataset.frames = String(++frames)
    canvas.dataset.animating = String(Boolean(s.receipt))
    if (!ready) {
      ready = true
      untrack(() => props.onReady?.(true))
    }
  }

  function frame(now: number) {
    if (disposed) return
    const s = state()
    if (s.receipt !== previousReceipt) {
      previousReceipt = s.receipt
      completedReceipt = undefined
      elapsed = 0
      previousTime = now
      previousState = undefined
    }
    const visible = props.visible && document.visibilityState !== 'hidden'
    if (renderer && !failed && visible && s.receipt)
      elapsed += Math.max(0, Math.min(0.05, (now - previousTime) / 1000))
    if (renderer && !failed && !pending && visible) {
      const progress = Math.min(1, elapsed / 0.55)
      // State is an owned memo. Compare its identity instead of serializing
      // all 32 pieces and material settings on every idle animation frame.
      const key = JSON.stringify([
        orbit,
        canvasSize(),
        s.receipt ? progress : 0,
      ])
      if (s !== previousState || key !== previousView) {
        try {
          draw(progress)
          previousState = s
          previousView = key
          pending = true
          void device.queue
            .onSubmittedWorkDone()
            .then(() => {
              pending = false
              if (
                !disposed &&
                progress >= 1 &&
                s.receipt &&
                props.receipt === s.receipt &&
                completedReceipt !== s.receipt
              ) {
                completedReceipt = s.receipt
                props.onComplete(s.receipt)
              }
            })
            .catch((error: unknown) => {
              pending = false
              fail(
                error instanceof Error
                  ? error.message
                  : 'The board could not finish its frame.',
              )
            })
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : 'The board could not render.',
          )
        }
      }
    }
    previousTime = now
    raf = requestAnimationFrame(frame)
  }

  function selectAt(x: number, y: number) {
    if (props.receipt || props.locked) return
    const ray = rayAt(x, y)
    const pieces = gummyMatchPieces(
      props.position,
      props.scale,
      props.settings.palette,
    )
    let distance = Infinity,
      square: string | undefined
    for (const piece of pieces) {
      const hit = pickGummyBoardMould(
        ray,
        piece,
        props.scale,
        'sculpted',
        props.authoredPawn,
      )
      if (hit !== undefined && hit < distance) {
        distance = hit
        square = piece.square
      }
    }
    square ??= gummyMatchFloorSquare(ray)
    if (square) props.onSquare(square)
  }
  let tap: { id: number; x: number; y: number } | undefined

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
    input.pointerMove(event)
  }

  function end(event: PointerEvent) {
    const picked =
      event.type === 'pointerup' && tap?.id === event.pointerId
        ? tap
        : undefined
    tap = undefined
    input.pointerEnd(event)
    if (picked && ready && !failed) selectAt(picked.x, picked.y)
  }

  function wheel(event: WheelEvent) {
    if (props.locked) event.preventDefault()
    else input.wheel(event)
  }

  function key(event: KeyboardEvent) {
    if (props.locked) return
    if (input.cameraKey(event)) event.preventDefault()
    else if (event.key === 'Home') {
      Object.assign(orbit, initialGummyBoardOrbit('board'), { pan: undefined })
      event.preventDefault()
    }
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
  canvas.addEventListener('contextmenu', input.contextMenu)
  canvas.addEventListener('keydown', key)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    preparation.abort()
    cancelAnimationFrame(raf)
    input.cancel()
    releaseErrors()
    releaseTouch()
    renderer?.destroy()
    props.onMarkers([])
    props.onReady?.(false)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', end)
    canvas.removeEventListener('pointercancel', end)
    canvas.removeEventListener('lostpointercapture', end)
    canvas.removeEventListener('pointerleave', input.pointerLeave)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', input.contextMenu)
    canvas.removeEventListener('keydown', key)
  })
  return null
}
