import { createEffect, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { Portal } from 'solid-js/web'
import { EARTH_VARIANTS } from '../lib/earthVariants'
import OpenInApp from './OpenInApp'
import PosterFlame from './PosterFlame'

/**
 * "Explore Earth Flame" gallery. A large, continuously-spinning drag-to-orbit
 * view of the selected variant plus a poster-thumbnail strip; clicking a thumb
 * swaps the main view. Every variant shares the same flame structure (only
 * colors differ), so switching just recolors + re-accumulates live — no pipeline
 * recompile. Portal'd to <body>; one live flame at a time, with poster fallback.
 */
export default function EarthVariantsModal(props: {
  open: boolean
  onClose: () => void
  initialId?: string
}) {
  const [selectedId, setSelectedId] = createSignal(
    props.initialId ?? EARTH_VARIANTS[0].id,
  )
  const selected = () =>
    EARTH_VARIANTS.find((v) => v.id === selectedId()) ?? EARTH_VARIANTS[0]

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      window.removeEventListener('keydown', onKey)
    })
  })

  // Lock body scroll while the modal is open.
  createEffect(() => {
    document.body.style.overflow = props.open ? 'hidden' : ''
  })
  onCleanup(() => {
    document.body.style.overflow = ''
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div class="ev-backdrop" onClick={props.onClose}>
          <div
            class="ev-modal"
            role="dialog"
            aria-label="Explore Earth Flame variants"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class="ev-head">
              <div>
                <p class="ev-kicker">Explore Earth Flame</p>
                <h3 class="ev-title">{selected().name}</h3>
                <p class="ev-tag">{selected().tag}</p>
              </div>
              <button
                class="ev-close"
                type="button"
                aria-label="Close"
                onClick={props.onClose}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>

            <div class="ev-stage">
              <PosterFlame
                flame={selected().flame}
                poster={selected().poster}
                posterClass="plate-canvas"
                quality={0.99}
                pointCountPerBatch={256}
                canvasClass="plate-canvas"
                interactive3D
                autoSpinAlways
                alphaMode="premultiplied"
                outputAlpha
              />
              <span class="ev-stage-hint">drag to orbit · scroll to zoom</span>
              <OpenInApp flame={selected().flame} />
            </div>

            <div class="ev-thumbs">
              <For each={EARTH_VARIANTS}>
                {(v) => (
                  <button
                    class="ev-thumb"
                    classList={{ active: v.id === selectedId() }}
                    type="button"
                    title={v.name}
                    onClick={() => setSelectedId(v.id)}
                  >
                    <img src={v.poster} alt={v.name} loading="lazy" />
                    <span>{v.name}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
