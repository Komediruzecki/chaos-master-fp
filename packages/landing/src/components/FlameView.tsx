import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Default3DPreviewCamera } from '@/lib/Camera3D'
import { createSpherical, WheelZoomCamera3D } from '@/lib/WheelZoomCamera3D'
import type { v2f } from 'typegpu/data'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

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
}

export default function FlameView(props: FlameViewProps) {
  const cameraPosition = () =>
    props.cameraPosition?.() ??
    vec2f(...props.flame.renderSettings.camera.position)
  const cameraZoom = () =>
    props.cameraZoom?.() ?? props.flame.renderSettings.camera.zoom

  // Orbit signals (used only by the interactive 3D path), seeded from the flame.
  const c3 = props.flame.renderSettings.camera3D
  const spherical = createSpherical(
    c3?.theta ?? 0,
    c3?.phi ?? Math.PI / 2,
    c3?.radius ?? 5,
    (c3?.target ?? [0, 0, 0]) as never,
    c3?.fov ?? 60,
    c3?.roll ?? 0,
  )

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
      setCurrentQuality={(get) => setQuality(() => get)}
    />
  )

  return (
    <AutoCanvas
      class={props.canvasClass ?? 'flame-gpu-canvas'}
      pixelRatio={props.pixelRatio ?? 1}
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
            radius={spherical.radius}
            target={spherical.target}
            fov={spherical.fov}
            roll={spherical.roll}
          >
            {flame()}
          </WheelZoomCamera3D>
        </Show>
      </Show>
    </AutoCanvas>
  )
}
