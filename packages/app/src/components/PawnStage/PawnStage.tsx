/**
 * An isolated native flame preview with 3D orbit or 2D pan and local zoom.
 * The stage renders its supplied recipe without changing the editor document;
 * its camera belongs to the stage and follows the recipe's authored framing.
 */
import { batch, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, Show, } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { ComputeGate } from '@/contexts/ComputeGateContext'
import { Flam3 } from '@/flame/Flam3'
import { camera3DDefault } from '@/flame/schema/flameSchema'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Default3DPreviewCamera } from '@/lib/Camera3D'
import { useCanvas } from '@/lib/CanvasContext'
import { PawnFitGuide } from './PawnFitGuide'
import ui from './PawnStage.module.css'
import type { PawnFitGuideSize } from './PawnFitGuide'
import type { Palette } from '@/flame/colorMap'
import type { Camera3DObj, FlameDescriptor } from '@/flame/schema/flameSchema'

export type PawnRenderStatus = {
  pointCount: number
  /** The renderer's submitted samples divided by its convergence target. */
  progress: number
  ready: boolean
}

export type PawnStageProps = {
  flame: FlameDescriptor
  /** Validated companion; dimensions must match the source flame. */
  blendFlame?: FlameDescriptor
  blendWeight?: number
  /** Inspection framing, kept separate from the source's authored camera. */
  camera3D?: Camera3DObj
  /** World-space reference only; does not establish solid geometry or fit. */
  fitGuide?: PawnFitGuideSize
  renderScale?: number
  pointCountPerBatch?: number
  /** Increment to restore the recipe's camera without remounting the renderer. */
  resetViewKey?: number
  ariaLabel?: string
  onStatusChange?: (status: PawnRenderStatus) => void
}

const NO_EDGE_FADE = vec4f(0)
const ORBIT_STEP = 0.006
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.5
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
type PointerPosition = { x: number; y: number }

export function PawnStage(props: PawnStageProps) {
  const descriptionId = createUniqueId()
  let stage: HTMLDivElement | undefined
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
  const pointers = new Map<number, PointerPosition>()
  const [thetaOffset, setThetaOffset] = createSignal(0)
  const [phiOffset, setPhiOffset] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const is3D = createMemo(() => props.flame.renderSettings.dimensions === 3)
  const authoredCamera = createMemo(
    () =>
      props.camera3D ?? props.flame.renderSettings.camera3D ?? camera3DDefault,
  )
  const camera2D = createMemo(() => {
    const authored = props.flame.renderSettings.camera
    return {
      position: vec2f(
        authored.position[0] + pan().x,
        authored.position[1] + pan().y,
      ),
      zoom: authored.zoom / zoom(),
      rotation: authored.rotation ?? 0,
    }
  })
  const instructions = createMemo(() =>
    is3D()
      ? 'Drag to orbit. Scroll or pinch to zoom. Arrow keys rotate, plus and minus zoom, and Home resets the view.'
      : 'Drag to pan. Scroll or pinch to zoom. Arrow keys pan, plus and minus zoom, and Home resets the view.',
  )
  const renderScale = createMemo(() => props.renderScale ?? 1)
  const pointCountPerBatch = createMemo(
    () => props.pointCountPerBatch ?? 250000,
  )
  const label = createMemo(
    () =>
      props.ariaLabel ??
      (is3D()
        ? 'Fractal pawn in three dimensions'
        : 'Fractal source in two dimensions'),
  )
  const camera = createMemo<Camera3DObj>(() => {
    const authored = authoredCamera()
    return {
      ...authored,
      theta: authored.theta + thetaOffset(),
      phi: authored.phi + phiOffset(),
      radius: authored.radius * zoom(),
    }
  })

  const resetView = () => {
    batch(() => {
      setThetaOffset(0)
      setPhiOffset(0)
      setZoom(1)
      setPan({ x: 0, y: 0 })
    })
  }
  createEffect(on(() => props.resetViewKey, resetView, { defer: true }))

  const orbit = (dx: number, dy: number) => {
    if (!is3D()) {
      const view = camera2D()
      const units = 2 / (Math.max(1, canvas()?.clientHeight ?? 1) * view.zoom)
      const c = Math.cos(view.rotation)
      const s = Math.sin(view.rotation)
      setPan((position) => ({
        x: position.x - units * (c * dx + s * dy),
        y: position.y + units * (c * dy - s * dx),
      }))
      return
    }
    batch(() => {
      setThetaOffset((theta) => theta - dx * ORBIT_STEP)
      const authoredPhi = authoredCamera().phi
      setPhiOffset(
        (phi) =>
          Math.min(
            Math.PI - 0.15,
            Math.max(0.15, authoredPhi + phi - dy * ORBIT_STEP),
          ) - authoredPhi,
      )
    })
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== stage) return
    switch (event.key) {
      case 'ArrowLeft':
        orbit(-12, 0)
        break
      case 'ArrowRight':
        orbit(12, 0)
        break
      case 'ArrowUp':
        orbit(0, -12)
        break
      case 'ArrowDown':
        orbit(0, 12)
        break
      case '+':
      case '=':
        setZoom((z) => clampZoom(z / 1.12))
        break
      case '-':
        setZoom((z) => clampZoom(z * 1.12))
        break
      case 'Home':
        resetView()
        break
      default:
        return
    }
    event.preventDefault()
  }

  createEffect(() => {
    const surface = canvas()
    if (!surface) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointers.size >= 2) return
      stage?.focus({ preventScroll: true })
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      surface.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const next = { x: event.clientX, y: event.clientY }
      const other = [...pointers.entries()].find(
        ([id]) => id !== event.pointerId,
      )?.[1]
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y)
        const after = Math.hypot(next.x - other.x, next.y - other.y)
        if (before > 0 && after > 0)
          setZoom((z) => clampZoom((z * before) / after))
      } else {
        orbit(next.x - previous.x, next.y - previous.y)
      }
      pointers.set(event.pointerId, next)
    }
    const finishPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (surface.hasPointerCapture(event.pointerId))
        surface.releasePointerCapture(event.pointerId)
    }
    const losePointer = (event: PointerEvent) =>
      pointers.delete(event.pointerId)
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? surface.clientHeight
            : 1)
      setZoom((z) =>
        clampZoom(z * Math.exp(Math.max(-500, Math.min(500, pixels)) * 0.001)),
      )
    }
    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerup', finishPointer)
    surface.addEventListener('pointercancel', finishPointer)
    surface.addEventListener('lostpointercapture', losePointer)
    surface.addEventListener('wheel', onWheel, { passive: false })
    onCleanup(() => {
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerup', finishPointer)
      surface.removeEventListener('pointercancel', finishPointer)
      surface.removeEventListener('lostpointercapture', losePointer)
      surface.removeEventListener('wheel', onWheel)
      pointers.clear()
    })
  })

  return (
    <div
      ref={stage}
      class={ui.stage}
      role="group"
      aria-label={label()}
      aria-describedby={descriptionId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="pawn-stage"
    >
      <p id={descriptionId} class={ui.description}>
        {instructions()}
      </p>
      <ComputeGate capacity={1}>
        <AutoCanvas
          class={ui.canvas}
          ref={setCanvas}
          pixelRatio={renderScale()}
          role="img"
          ariaLabel={label()}
          ariaDescribedby={descriptionId}
        >
          <PawnScene
            flame={props.flame}
            camera={camera()}
            camera2D={camera2D()}
            blendFlame={props.blendFlame}
            blendWeight={props.blendWeight}
            fitGuide={props.fitGuide}
            pointCountPerBatch={pointCountPerBatch()}
            onStatusChange={props.onStatusChange}
          />
        </AutoCanvas>
      </ComputeGate>
    </div>
  )
}

type PawnSceneProps = {
  flame: FlameDescriptor
  camera: Camera3DObj
  camera2D: {
    position: ReturnType<typeof vec2f>
    zoom: number
    rotation: number
  }
  blendFlame?: FlameDescriptor
  blendWeight?: number
  fitGuide?: PawnFitGuideSize
  pointCountPerBatch: number
  onStatusChange?: (status: PawnRenderStatus) => void
}

function PawnScene(props: PawnSceneProps) {
  const { canvasSize } = useCanvas()
  let pointLimit = () => Infinity
  let reportedPercent = -1
  const fittedCamera = createMemo<Camera3DObj>(() => {
    const size = canvasSize()
    const aspect = size.height > 0 ? size.width / size.height : 1
    return {
      ...props.camera,
      radius: props.camera.radius * Math.max(1, 0.8 / Math.max(0.1, aspect)),
    }
  })
  const reportCount = (pointCount: number) => {
    const progress = Math.min(1, Math.max(0, pointCount / pointLimit()))
    const percent = Math.floor(progress * 100)
    if (percent === reportedPercent) return
    reportedPercent = percent
    props.onStatusChange?.({ pointCount, progress, ready: progress >= 1 })
  }
  createEffect(
    on(
      () => [
        props.flame,
        props.blendFlame,
        props.blendWeight,
        fittedCamera(),
        props.camera2D,
      ],
      () => {
        reportedPercent = -1
        reportCount(0)
      },
    ),
  )
  return (
    <Show
      when={props.flame.renderSettings.dimensions === 3}
      fallback={
        <Camera2D
          position={props.camera2D.position}
          zoom={props.camera2D.zoom}
          rotation={props.camera2D.rotation}
        >
          <PawnFlame
            {...props}
            setPointLimit={(readLimit) => {
              pointLimit = readLimit
            }}
            reportCount={reportCount}
          />
        </Camera2D>
      }
    >
      <Default3DPreviewCamera camera3D={fittedCamera()}>
        <PawnFlame
          {...props}
          setPointLimit={(readLimit) => {
            pointLimit = readLimit
          }}
          reportCount={reportCount}
        />
        <Show when={props.fitGuide} keyed>
          {(size) => <PawnFitGuide size={size} />}
        </Show>
      </Default3DPreviewCamera>
    </Show>
  )
}

function PawnFlame(
  props: PawnSceneProps & {
    setPointLimit: (readLimit: () => number) => void
    reportCount: (pointCount: number) => void
  },
) {
  const palette = createMemo<Palette | undefined>(() => {
    const stored = props.flame.renderSettings.palette
    return stored
      ? {
          ...stored,
          entries: stored.entries.map((entry) => ({ ...entry })),
          source: 'imported',
        }
      : undefined
  })
  return (
    <Flam3
      quality={0.97}
      pointCountPerBatch={props.pointCountPerBatch}
      renderInterval={1}
      adaptiveFilterEnabled={true}
      animationEnabled={false}
      flameDescriptor={props.flame}
      edgeFadeColor={NO_EDGE_FADE}
      palette={palette}
      blendFlame={props.blendFlame}
      blendWeight={props.blendWeight}
      setQualityPointCountLimit={props.setPointLimit}
      onAccumulatedPointCount={props.reportCount}
    />
  )
}
