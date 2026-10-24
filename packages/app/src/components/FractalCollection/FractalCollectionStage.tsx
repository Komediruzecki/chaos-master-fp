/** A single native WebGPU scene with event-driven rendering for complete fractal collections. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, } from 'solid-js'
import { getFractalStudyGlassRole } from '@/flame/chess/fractalStudyGlass'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { DEFAULT_BOARD_CAMERA, pickBoardSquare, } from '../PawnBoard/pawnBoardMath'
import { createPawnBoardRenderer } from '../PawnBoard/pawnBoardRenderer'
import { collectionCameraMatrices, collectionComparisonLabels, pickCollectionInstance, } from './collectionStageCamera'
import { collectionInstances } from './collectionStageLayout'
import ui from './FractalCollectionStage.module.css'
import type { CollectionCloud } from './collectionCloudWorker'
import type { CollectionComparisonLabel } from './collectionStageCamera'
import type { CollectionCamera, CollectionEnclosure, CollectionView, } from './collectionStageLayout'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { PawnSide } from '@/flame/chess/pawnFlame'

type Props = {
  clouds: CollectionCloud[]
  shell?: FractalStudyGlass
  collectionId: string
  enclosure: CollectionEnclosure
  view: CollectionView
  role: ChessCandidateRole
  side: PawnSide
  variation: boolean
  camera: CollectionCamera
  resetKey: number
  onSelect: (role: ChessCandidateRole, side: PawnSide) => void
  onReady: (ready: boolean) => void
}

export function FractalCollectionStage(props: Props) {
  const [visible, setVisible] = createSignal(true)
  const [labels, setLabels] = createSignal<CollectionComparisonLabel[]>([])
  return (
    <div
      style={{ position: 'relative', 'min-height': '0', overflow: 'hidden' }}
      data-testid="fractal-collection-stage"
    >
      <AutoCanvas
        ariaLabel="Fractal chess collection. Drag to orbit, pinch to zoom."
        role="img"
        pixelRatio={1}
        onVisibilityChange={setVisible}
      >
        <NativeCollection {...props} visible={visible()} onLabels={setLabels} />
      </AutoCanvas>
      <For each={labels()}>
        {(label) => (
          <span
            class={ui.specimenLabel}
            style={{ left: `${label.x * 100}%`, top: `${label.y * 100}%` }}
          >
            {label.text}
          </span>
        )}
      </For>
    </div>
  )
}

type Pointer = { x: number; y: number; originX: number; originY: number }

function NativeCollection(
  props: Props & {
    visible: boolean
    onLabels: (labels: CollectionComparisonLabel[]) => void
  },
) {
  const { root, device } = useLiveRootContext()
  const { canvas, context, canvasFormat, canvasSize } = useCanvas()
  const renderer = createPawnBoardRenderer(root, device, context, canvasFormat)
  const instances = createMemo(() =>
    collectionInstances(props.view, props.role, props.side, props.variation, {
      role: getFractalStudyGlassRole(props.collectionId),
      key: props.collectionId,
      enclosure: props.enclosure,
    }),
  )
  const [loaded, setLoaded] = createSignal(false)
  const viewProjection = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  const view = new Float32Array(16),
    projection = new Float32Array(16)
  const pointers = new Map<number, Pointer>()
  let orbit = { ...DEFAULT_BOARD_CAMERA }
  let moved = false,
    disposed = false,
    raf = 0
  let reportedReady = false

  function resetCamera() {
    orbit = {
      theta: props.camera === 'perspective' ? 0.38 : 0,
      phi:
        props.camera === 'top'
          ? 0.08
          : props.camera === 'front'
            ? 1.34
            : props.view === 'board'
              ? 0.73
              : 1.18,
      zoom: 1,
    }
    invalidate()
  }

  function updateCamera() {
    const size = canvasSize()
    const aspect = size.width / Math.max(1, size.height)
    collectionCameraMatrices(
      props.view,
      orbit,
      aspect,
      viewProjection,
      inverse,
      eye,
      view,
      projection,
      props.enclosure === 'both' &&
        (props.view === 'lineup' ||
          props.role === getFractalStudyGlassRole(props.collectionId)),
    )
    return size
  }

  function draw() {
    raf = 0
    if (disposed || !props.visible || document.visibilityState === 'hidden')
      return
    const size = updateCamera()
    if (!size.width || !size.height) return
    renderer.render({
      ...size,
      viewProjection,
      eye,
      pieces: loaded() ? instances() : [],
      legal: [],
      showGlass: props.enclosure !== 'pure',
      mutedBoard: true,
      inspection: props.view !== 'board',
    })
    props.onLabels(
      loaded() &&
        props.view === 'solo' &&
        props.enclosure === 'both' &&
        instances().length === 2
        ? collectionComparisonLabels(viewProjection, instances(), props.clouds)
        : [],
    )
    if (loaded() && !reportedReady) {
      reportedReady = true
      props.onReady(true)
    }
  }

  function invalidate() {
    if (!disposed && !raf) raf = requestAnimationFrame(draw)
  }
  createEffect(
    on(
      () => props.clouds,
      (clouds) => {
        renderer.clearVariantClouds()
        renderer.clearVariantGlass()
        setLoaded(false)
        reportedReady = false
        props.onReady(false)
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
        setLoaded(clouds.length > 0)
        invalidate()
      },
    ),
  )
  createEffect(
    on(() => [props.view, props.camera, props.resetKey], resetCamera),
  )
  createEffect(() => {
    instances()
    canvasSize()
    loaded()
    if (props.visible) invalidate()
  })

  function zoom(factor: number) {
    orbit.zoom = Math.max(0.5, Math.min(2.4, orbit.zoom * factor))
    invalidate()
  }

  function rotate(dx: number, dy: number) {
    orbit.theta -= dx * 0.005
    orbit.phi = Math.max(0.08, Math.min(1.5, orbit.phi - dy * 0.005))
    invalidate()
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return
    event.preventDefault()
    moved = pointers.size > 0
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
    })
    canvas.setPointerCapture(event.pointerId)
    canvas.focus({ preventScroll: true })
    canvas.style.cursor = 'grabbing'
  }

  function pointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const other = [...pointers.entries()].find(
      ([id]) => id !== event.pointerId,
    )?.[1]
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 0 && after > 0) zoom(before / after)
      moved = true
    } else if (
      moved ||
      Math.hypot(
        event.clientX - previous.originX,
        event.clientY - previous.originY,
      ) > 5
    ) {
      rotate(event.clientX - previous.x, event.clientY - previous.y)
      moved = true
    }
    previous.x = event.clientX
    previous.y = event.clientY
  }

  function pointerEnd(event: PointerEvent) {
    const tracked = pointers.delete(event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId)
    if (!pointers.size) canvas.style.cursor = 'grab'
    if (!tracked || moved || pointers.size || event.type !== 'pointerup') return
    updateCamera()
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = 1 - ((event.clientY - rect.top) / rect.height) * 2
    const piece = pickCollectionInstance(
      x,
      y,
      inverse,
      instances(),
      props.clouds,
    )
    if (piece) {
      props.onSelect(piece.role, piece.side)
      return
    }
    if (props.view !== 'board') return
    const square = pickBoardSquare(x, y, inverse)
    if (!square) return
    const squarePiece = instances().find(
      (item) =>
        item.square?.file === square.file && item.square?.rank === square.rank,
    )
    if (squarePiece) props.onSelect(squarePiece.role, squarePiece.side)
  }

  function wheel(event: WheelEvent) {
    event.preventDefault()
    const pixels =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? canvas.clientHeight
          : 1)
    zoom(Math.exp(Math.max(-500, Math.min(500, pixels)) * 0.001))
  }

  function keyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'ArrowLeft') rotate(-14, 0)
    else if (event.key === 'ArrowRight') rotate(14, 0)
    else if (event.key === 'ArrowUp') rotate(0, -14)
    else if (event.key === 'ArrowDown') rotate(0, 14)
    else if (event.key === '+' || event.key === '=') zoom(1 / 1.12)
    else if (event.key === '-') zoom(1.12)
    else if (event.key === 'Home') resetCamera()
    else return
    event.preventDefault()
  }
  const lostPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    canvas.style.cursor = 'grab'
  }
  const preventSelection = (event: Event) => {
    event.preventDefault()
  }
  canvas.style.touchAction = 'none'
  canvas.style.userSelect = 'none'
  canvas.style.setProperty('-webkit-user-select', 'none')
  canvas.style.setProperty('-webkit-touch-callout', 'none')
  canvas.style.cursor = 'grab'
  canvas.tabIndex = 0
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)
  canvas.addEventListener('lostpointercapture', lostPointer)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', keyDown)
  canvas.addEventListener('contextmenu', preventSelection)
  document.addEventListener('visibilitychange', invalidate)
  onCleanup(() => {
    disposed = true
    cancelAnimationFrame(raf)
    renderer.destroy()
    pointers.clear()
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
    canvas.removeEventListener('lostpointercapture', lostPointer)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('keydown', keyDown)
    canvas.removeEventListener('contextmenu', preventSelection)
    document.removeEventListener('visibilitychange', invalidate)
  })
  return null
}
