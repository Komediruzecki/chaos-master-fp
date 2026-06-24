import { createEffect, createMemo, createSignal, Show, splitProps, } from 'solid-js'
import { webgpuLive } from '../lib/webgpuHealth'
import FlameStage from './FlameStage'
import type { FlameViewProps } from './FlameView'

type PosterFlameProps = FlameViewProps & {
  /** Static poster shown until the live flame has accumulated, and whenever the
   *  live flame can't run (no WebGPU / GPU failure / off-screen). */
  poster: string
  posterAlt?: string
  /** Extra class on the poster <img> (e.g. 'plate-canvas' to match the canvas box). */
  posterClass?: string
  /** Additional live gate beyond WebGPU health — e.g. in-view / ComputeGate. */
  inView?: () => boolean
}

/**
 * A live GPU flame with a static-poster fallback. The poster sits behind the
 * canvas and is revealed whenever the live render can't run: WebGPU unsupported,
 * a GPU failure has flipped the page to posters (webgpuLive() === false), the
 * card is off-screen, or the flame hasn't accumulated yet. On capable hardware
 * the live flame fades the poster out once it's converged — "live by default,
 * poster on failure".
 */
export default function PosterFlame(props: PosterFlameProps) {
  const [local, viewProps] = splitProps(props, [
    'poster',
    'posterAlt',
    'posterClass',
    'inView',
    'onReady',
  ])

  const [ready, setReady] = createSignal(false)
  const live = createMemo(() => webgpuLive() && (local.inView?.() ?? true))
  // Reset the poster cross-fade whenever the live flame stops (off-screen or GPU
  // failure) so it re-accumulates from the poster, no blank flash, on re-entry.
  createEffect(() => {
    if (!live()) setReady(false)
  })
  const posterHidden = () => live() && ready()

  return (
    <>
      <img
        class={`flame-poster ${local.posterClass ?? ''}`}
        classList={{ 'is-hidden': posterHidden() }}
        src={local.poster}
        alt={local.posterAlt ?? ''}
        aria-hidden="true"
        loading="lazy"
        draggable={false}
      />
      <Show when={live()}>
        <FlameStage
          {...viewProps}
          onReady={() => {
            setReady(true)
            local.onReady?.()
          }}
        />
      </Show>
    </>
  )
}
