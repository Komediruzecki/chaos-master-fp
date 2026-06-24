import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Default3DPreviewCamera } from '@/lib/Camera3D'
import { useCanvas } from '@/lib/CanvasContext'
import { createSpherical, WheelZoomCamera3D } from '@/lib/WheelZoomCamera3D'
import type { Signal } from 'solid-js'
import type { v2f } from 'typegpu/data'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Idle auto-spin for a 3D flame: while the cursor is over the canvas and NOT
 * dragging, slowly orbit (after a short delay) by advancing the camera theta.
 * Pauses during drag and resumes shortly after release. Rendered inside the
 * camera so it can read the canvas element from context.
 */
function AutoSpin3D(props: {
  theta: Signal<number>
  speed?: number
  delayMs?: number
}) {
  const { canvas } = useCanvas()
  onMount(() => {
    const speed = props.speed ?? 0.3 // rad/s (~20s per revolution)
    const delay = props.delayMs ?? 500
    // globalThis.performance.now(): the app's blessed monotonic clock (the bare
    // `performance` global is eslint-restricted).
    const nowMs = () => globalThis.performance.now()
    let dragging = false
    let resumeAt = 0
    let raf = 0
    let last = 0
    let running = false
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!dragging && now >= resumeAt) {
        props.theta[1]((t) => t + speed * dt)
      }
      raf = requestAnimationFrame(tick)
    }
    // Only animate while the cursor is over the card — no idle rAF when not
    // hovering / off-screen.
    const start = () => {
      if (running) return
      running = true
      last = nowMs()
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    const onEnter = () => {
      resumeAt = nowMs() + delay
      start()
    }
    const onLeave = () => {
      stop()
    }
    const onDown = () => {
      dragging = true
    }
    // pointerup OR pointercancel (touch / OS interrupt) ends the drag, so spin
    // resumes — otherwise an interrupted drag would freeze it forever.
    const onUp = () => {
      dragging = false
      resumeAt = nowMs() + delay
    }
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('pointerup', onUp)
    onCleanup(() => {
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('pointerup', onUp)
      cancelAnimationFrame(raf)
    })
  })
  return null
}

/**
 * Inner live-flame view — the app's AutoCanvas + camera + Flam3, WITHOUT a Root.
 * Shared by the hero (FlameStage wraps it in a Root) and the gallery (each gated
 * preview wraps it in a Root under a shared ComputeGate). Handles 2D and 3D
 * flames; 3D can be a static preview angle or a drag-to-orbit camera.
 */
export type FlameViewProps = {
  flame: FlameDescriptor
  quality?: number
  pointCountPerBatch?: number
  adaptiveFilterEnabled?: boolean
  pixelRatio?: number
  canvasClass?: string
  onReady?: () => void
  /** Reactive override for the 2D camera position — drives mouse parallax /
   *  idle drift on the hero. Falls back to the flame's own camera. */
  cameraPosition?: () => v2f
  /** Reactive override for the 2D camera zoom — drives scroll-to-zoom. Falls
   *  back to the flame's own zoom. */
  cameraZoom?: () => number
  /** For 3D flames: drag-to-orbit + scroll-zoom (reuses the app's
   *  WheelZoomCamera3D) instead of a fixed preview angle. */
  interactive3D?: boolean
  /** Canvas alpha mode. 'premultiplied' makes the dark flame regions
   *  transparent so a layer behind (e.g. a starfield) shows through. */
  alphaMode?: GPUCanvasAlphaMode
  /** Output premultiplied alpha from the flame (dark regions become
   *  transparent). Pair with alphaMode='premultiplied'. */
  outputAlpha?: boolean
  /** For interactive3D: idle auto-orbit on hover (pauses while dragging). */
  autoSpin?: boolean
}

export default function FlameView(props: FlameViewProps) {
  const cameraPosition = () =>
    props.cameraPosition?.() ??
    vec2f(...props.flame.renderSettings.camera.position)
  const cameraZoom = () =>
    props.cameraZoom?.() ?? props.flame.renderSettings.camera.zoom

  // Orbit signals (used only by the interactive 3D path), seeded from the flame.
  const c3 = props.flame.renderSettings.camera3D
  const baseRadius = c3?.radius ?? 5
  const spherical = createSpherical(
    c3?.theta ?? 0,
    c3?.phi ?? Math.PI / 2,
    baseRadius,
    (c3?.target ?? [0, 0, 0]) as never,
    c3?.fov ?? 60,
    c3?.roll ?? 0,
  )
  // The raw camera lets you zoom out to radius 100 (the flame shrinks to a
  // speck); clamp the orbit radius to keep it framed.
  const RAD_MIN = baseRadius * 0.5
  const RAD_MAX = baseRadius * 1.6
  const clampedRadius: Signal<number> = [
    spherical.radius[0],
    ((v: number | ((p: number) => number)) =>
      spherical.radius[1]((prev) => {
        const next = typeof v === 'function' ? v(prev) : v
        return Math.max(RAD_MIN, Math.min(RAD_MAX, next))
      })) as Signal<number>[1],
  ]

  // Flam3 hands us a live-quality getter; poll it and fire onReady once the
  // flame is actually accumulating (used to cross-fade the hero poster out).
  const [quality, setQuality] = createSignal<(() => number) | undefined>()
  createEffect(() => {
    const get = quality()
    if (!get || !props.onReady) return
    let raf = 0
    const tick = () => {
      if (get() > 0.002) {
        props.onReady?.()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => {
      cancelAnimationFrame(raf)
    })
  })

  const flame = () => (
    <Flam3
      animationEnabled={false}
      quality={props.quality ?? 0.6}
      pointCountPerBatch={props.pointCountPerBatch ?? 256}
      adaptiveFilterEnabled={props.adaptiveFilterEnabled ?? true}
      flameDescriptor={props.flame}
      renderInterval={1}
      edgeFadeColor={vec4f(0)}
      outputAlpha={props.outputAlpha}
      setCurrentQuality={(get) => setQuality(() => get)}
    />
  )

  return (
    <AutoCanvas
      class={props.canvasClass ?? 'flame-gpu-canvas'}
      pixelRatio={props.pixelRatio ?? 1}
      alphaMode={props.alphaMode}
    >
      <Show
        when={(props.flame.renderSettings.dimensions ?? 2) === 3}
        fallback={
          <Camera2D position={cameraPosition()} zoom={cameraZoom()}>
            {flame()}
          </Camera2D>
        }
      >
        <Show
          when={props.interactive3D}
          fallback={
            <Default3DPreviewCamera camera3D={c3}>
              {flame()}
            </Default3DPreviewCamera>
          }
        >
          <WheelZoomCamera3D
            theta={spherical.theta}
            phi={spherical.phi}
            radius={clampedRadius}
            target={spherical.target}
            fov={spherical.fov}
            roll={spherical.roll}
          >
            <Show when={props.autoSpin}>
              <AutoSpin3D theta={spherical.theta} />
            </Show>
            {flame()}
          </WheelZoomCamera3D>
        </Show>
      </Show>
    </AutoCanvas>
  )
}
