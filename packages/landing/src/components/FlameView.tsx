import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Default3DPreviewCamera } from '@/lib/Camera3D'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Inner live-flame view — the app's AutoCanvas + camera + Flam3, WITHOUT a Root.
 * Shared by the hero (FlameStage wraps it in a Root) and the gallery (each gated
 * preview wraps it in a Root under a shared ComputeGate). Handles 2D and 3D
 * flames, and signals `onReady` once the first frames accumulate.
 */
export type FlameViewProps = {
  flame: FlameDescriptor
  quality?: number
  pointCountPerBatch?: number
  adaptiveFilterEnabled?: boolean
  pixelRatio?: number
  canvasClass?: string
  onReady?: () => void
}

export default function FlameView(props: FlameViewProps) {
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
          <Camera2D
            position={vec2f(...props.flame.renderSettings.camera.position)}
            zoom={props.flame.renderSettings.camera.zoom}
          >
            {flame()}
          </Camera2D>
        }
      >
        <Default3DPreviewCamera camera3D={props.flame.renderSettings.camera3D}>
          {flame()}
        </Default3DPreviewCamera>
      </Show>
    </AutoCanvas>
  )
}
