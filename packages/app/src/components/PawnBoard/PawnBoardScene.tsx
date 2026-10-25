/** Native 3D pawn-board surface with orbit/pinch controls and perspective square picking. */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, } from 'solid-js'
import { BLUE_BRANCH_PAWN_POINT_LIGHTNESS, buildBlueBranchPawnFlame, } from '@/flame/chess/blueBranchPawnFlame'
import { sampleFlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import { samplePawnCloud } from '@/flame/chess/pawnCloud'
import { buildPawnFlame } from '@/flame/chess/pawnFlame'
import { buildStructuralPawnFlame } from '@/flame/chess/structuralPawnFlame'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { boardCameraMatrices, CAPTURE_SECONDS, DEFAULT_BOARD_CAMERA, DEFAULT_INSPECTION_CAMERA, MOVE_SECONDS, moveProgress, pawnInspectionCameraMatrices, pickBoardSquare, pickPawnSquare, squareWorld, } from './pawnBoardMath'
import { createPawnBoardRenderer } from './pawnBoardRenderer'
import type { BoardPawnInstance } from './pawnBoardRenderer'
import type { FlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import type { PawnRecipe, PawnSide } from '@/flame/chess/pawnFlame'
import type { GameState, PawnMoveReceipt, Piece, Square, } from '@/flame/chess/pawnGame'

export type PawnBoardForm = 'echo' | 'lattice' | 'blue-branch'
export type PawnBoardSceneProps = {
  game: GameState
  move?: PawnMoveReceipt
  form: PawnBoardForm
  inspection?: boolean
  inspectionSide?: PawnSide
  showGlass?: boolean
  lightRecipe: PawnRecipe
  darkRecipe: PawnRecipe
  selected?: Square
  legalSquares: readonly Square[]
  onSquarePick: (square: Square) => void
  resetViewKey?: number
  reducedMotion?: boolean
  class?: string
  onReady?: (ready: boolean) => void
  onAnimationComplete?: () => void
}

export function PawnBoardScene(props: PawnBoardSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const sceneLabel = createMemo(() =>
    props.inspection
      ? 'Interactive glass pawn study'
      : 'Three-dimensional glass pawn board',
  )
  return (
    <div
      class={props.class}
      style={{ width: '100%', position: 'relative' }}
      data-testid="pawn-board-scene"
    >
      <AutoCanvas
        role="img"
        ariaLabel={sceneLabel()}
        pixelRatio={1}
        onVisibilityChange={setVisible}
      >
        <NativePawnBoard {...props} visible={visible()} />
      </AutoCanvas>
    </div>
  )
}

type Pointer = { x: number; y: number; startX: number; startY: number }

function movingPosition(
  piece: Piece,
  receipt: PawnMoveReceipt | undefined,
  age: number,
  reducedMotion: boolean,
) {
  const position = squareWorld(piece.square)
  if (receipt?.pieceId === piece.id && !reducedMotion) {
    const from = squareWorld(receipt.from),
      progress = moveProgress(age)
    position[0] = from[0] + (position[0] - from[0]) * progress
    position[2] = from[2] + (position[2] - from[2]) * progress
    position[1] += Math.sin(progress * Math.PI) * 0.12
  }
  return position
}

function shouldDraw(ready: boolean, visible: boolean) {
  return !ready || (visible && document.visibilityState !== 'hidden')
}

function NativePawnBoard(props: PawnBoardSceneProps & { visible: boolean }) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  const renderer = createPawnBoardRenderer(root, device, context, canvasFormat)
  const [baked, setBaked] = createSignal(false)
  const visual = createMemo(() => ({
    game: props.game,
    selected: props.selected,
    legal: props.legalSquares,
    reducedMotion: props.reducedMotion ?? false,
    visible: props.visible,
    inspection: props.inspection ?? false,
    inspectionSide: props.inspectionSide ?? 'light',
    showGlass: props.showGlass ?? true,
  }))
  const defaultCamera = () =>
    props.inspection ? DEFAULT_INSPECTION_CAMERA : DEFAULT_BOARD_CAMERA
  let orbit = { ...defaultCamera() }
  let active: { receipt: PawnMoveReceipt; started: number } | undefined
  let reportedReady = false
  let disposed = false
  let raf = 0
  const pointers = new Map<number, Pointer>()
  let gestureMoved = false
  const viewProjection = new Float32Array(16),
    inverse = new Float32Array(16)
  const eye = new Float32Array(3),
    view = new Float32Array(16),
    projection = new Float32Array(16)
  const instances: BoardPawnInstance[] = []
  // Four fixed entries at most: two palettes at board/study resolution.
  // Retain only render data, not the sampler's auxiliary colour/group arrays.
  const blueClouds = new Map<
    string,
    Pick<FlameFigurineCloud, 'points' | 'colors'>
  >()
  const uploadedBlue = new Map<PawnSide, number>()

  createEffect(
    on(
      () => [props.resetViewKey, props.inspection],
      () => {
        orbit = { ...defaultCamera() }
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.move,
      (receipt) => {
        active = receipt
          ? { receipt, started: window.performance.now() / 1000 }
          : undefined
      },
    ),
  )
  createEffect(() => {
    if (props.form === 'blue-branch') {
      const count = props.inspection ? 100_000 : 32_000
      setBaked(false)
      reportedReady = false
      untrack(() => props.onReady?.(false))
      const sides: readonly PawnSide[] = props.inspection
        ? [props.inspectionSide ?? 'light']
        : ['light', 'dark']
      for (const side of sides) {
        if (uploadedBlue.get(side) === count) continue
        const key = `${side}:${count}`
        let cloud = blueClouds.get(key)
        if (!cloud) {
          const sampled = sampleFlameFigurineCloud(
            buildBlueBranchPawnFlame({ side }),
            {
              count,
              seed: side === 'light' ? 5381 : 8173,
              lightness: BLUE_BRANCH_PAWN_POINT_LIGHTNESS,
            },
          )
          cloud = { points: sampled.points, colors: sampled.colors }
          blueClouds.set(key, cloud)
        }
        renderer.setCloud(side, cloud.points, cloud.colors)
        uploadedBlue.set(side, count)
      }
      setBaked(true)
      return
    }
    const build =
      props.form === 'echo' ? buildPawnFlame : buildStructuralPawnFlame
    uploadedBlue.clear()
    const light = build({ ...props.lightRecipe, side: 'light' })
    const dark = build({ ...props.darkRecipe, side: 'dark' })
    setBaked(false)
    reportedReady = false
    untrack(() => props.onReady?.(false))
    renderer.setCloud(
      'light',
      samplePawnCloud(light, { count: 18000, seed: 5381 }).points,
    )
    renderer.setCloud(
      'dark',
      samplePawnCloud(dark, { count: 18000, seed: 8173 }).points,
    )
    setBaked(true)
  })

  const updateCamera = () => {
    const size = canvasSize()
    const matrices = props.inspection
      ? pawnInspectionCameraMatrices
      : boardCameraMatrices
    matrices(
      orbit,
      size.width / Math.max(1, size.height),
      viewProjection,
      inverse,
      eye,
      view,
      projection,
    )
    return size
  }
  const zoom = (factor: number) => {
    orbit.zoom = Math.max(0.58, Math.min(2.2, orbit.zoom * factor))
  }
  const rotate = (dx: number, dy: number) => {
    orbit.theta -= dx * 0.005
    orbit.phi = Math.max(
      0.25,
      Math.min(props.inspection ? 1.5 : 1.28, orbit.phi - dy * 0.005),
    )
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return
    if (pointers.size === 0) gestureMoved = false
    else gestureMoved = true
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    })
    canvas.setPointerCapture(event.pointerId)
    canvas.focus({ preventScroll: true })
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
      gestureMoved = true
    } else if (
      Math.hypot(
        event.clientX - previous.startX,
        event.clientY - previous.startY,
      ) > 5 ||
      gestureMoved
    ) {
      rotate(event.clientX - previous.x, event.clientY - previous.y)
      gestureMoved = true
    }
    previous.x = event.clientX
    previous.y = event.clientY
  }

  function pointerEnd(event: PointerEvent) {
    const tracked = pointers.has(event.pointerId)
    pointers.delete(event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId)
    if (
      !tracked ||
      gestureMoved ||
      pointers.size > 0 ||
      event.type !== 'pointerup'
    )
      return
    if (visual().inspection) return
    updateCamera()
    const bounds = canvas.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2
    const square =
      pickPawnSquare(x, y, inverse, visual().game.pieces) ??
      pickBoardSquare(x, y, inverse)
    if (square) props.onSquarePick(square)
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
    if (event.key === 'ArrowLeft') rotate(-14, 0)
    else if (event.key === 'ArrowRight') rotate(14, 0)
    else if (event.key === 'ArrowUp') rotate(0, -14)
    else if (event.key === 'ArrowDown') rotate(0, 14)
    else if (event.key === '+' || event.key === '=') zoom(1 / 1.12)
    else if (event.key === '-') zoom(1.12)
    else if (event.key === 'Home') orbit = { ...defaultCamera() }
    else return
    event.preventDefault()
  }
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  canvas.tabIndex = 0
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)
  const lostPointer = (event: PointerEvent) => pointers.delete(event.pointerId)
  canvas.addEventListener('lostpointercapture', lostPointer)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', keyDown)

  function reportFirstFrame(width: number, height: number) {
    if (reportedReady || width <= 0 || height <= 0) return
    reportedReady = true
    props.onReady?.(true)
  }

  function frame(now: number) {
    if (disposed) return
    const state = visual(),
      size = updateCamera(),
      time = now / 1000
    instances.length = 0
    let shards: BoardPawnInstance | undefined
    let completed = false
    const age = active ? time - active.started : 0
    const receipt = active?.receipt
    for (const piece of state.game.pieces) {
      const position = movingPosition(piece, receipt, age, state.reducedMotion)
      instances.push({
        position,
        side: piece.side,
        selected: piece.id === state.game.selectedId,
        age: -1,
      })
    }
    if (state.inspection) {
      instances.length = 0
      instances.push({
        position: [0, 0.09, 0],
        side: state.inspectionSide,
        selected: false,
        age: -1,
      })
    }
    if (receipt) {
      const duration = receipt.captured ? CAPTURE_SECONDS : MOVE_SECONDS
      completed = state.reducedMotion || age >= duration
      if (receipt.captured && !completed) {
        const shattered = age >= 0.4
        const ghost: BoardPawnInstance = {
          position: squareWorld(receipt.captured.square),
          side: receipt.captured.side,
          selected: false,
          age: shattered ? age - 0.4 : -1,
        }
        instances.push(ghost)
        if (shattered) shards = ghost
      }
    }
    // Submit one initial frame even offscreen so loading can finish. After
    // that, keep the animation clock alive without spending GPU time offscreen.
    if (baked() && shouldDraw(reportedReady, state.visible)) {
      renderer.render({
        width: size.width,
        height: size.height,
        viewProjection,
        eye,
        pieces: instances,
        shards,
        selected: state.selected,
        legal: state.legal,
        showGlass: state.showGlass,
        inspection: state.inspection,
      })
      reportFirstFrame(size.width, size.height)
    }
    if (completed) {
      active = undefined
      props.onAnimationComplete?.()
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    cancelAnimationFrame(raf)
    renderer.destroy()
    blueClouds.clear()
    uploadedBlue.clear()
    pointers.clear()
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
    canvas.removeEventListener('lostpointercapture', lostPointer)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('keydown', keyDown)
  })
  return null
}
