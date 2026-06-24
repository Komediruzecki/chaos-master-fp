import { createSignal, For, onCleanup, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import { example45 } from '@/flame/examples/example45'
import { posterFor, prettyVariation } from '../lib/flame'
import PosterFlame from './PosterFlame'
import { createFlameParallax } from './useFlameParallax'

/**
 * Interactive "Studio" demo — the live flame viewport and the TRANSFORMS panel
 * share one reactive flame store, so:
 *   • dragging an affine value (a–f) scrubs it and the flame re-solves live, and
 *   • scrolling over the viewport zooms the camera (clamped).
 * Affine edits don't recompile the IFS pipeline (the shader keys only on
 * variation structure), so scrubbing just resets accumulation — cheap and smooth.
 */
const AFFINE_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const
const SWATCHES = ['#06d6c8', '#d4e157', '#ff5e7e', '#60a5fa', '#a3e635']
const ZOOM_MIN = 0.6
const ZOOM_MAX = 3

export default function StudioDemo() {
  const [flame, setFlame] = createStore<typeof example45>(
    structuredClone(example45),
  )
  const baseZoom = example45.renderSettings.camera.zoom
  const [zoom, setZoom] = createSignal(baseZoom)
  const cameraPosition = createFlameParallax({
    selector: '.studio-viewport',
    base: example45.renderSettings.camera.position,
    amount: 0.12,
  })

  const tids = Object.keys(example45.transforms)
  const total = tids.reduce(
    (s, tid) => s + (example45.transforms as never)[tid].probability,
    0,
  )

  let viewport: HTMLDivElement | undefined
  onMount(() => {
    const el = viewport
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) =>
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (1 - e.deltaY * 0.0012))),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    onCleanup(() => {
      el.removeEventListener('wheel', onWheel)
    })
  })

  // Active scrub teardown, so a drag in progress is cleaned up if the island
  // unmounts mid-drag (otherwise the window listeners leak and fire setFlame on a
  // disposed store).
  let endScrub: (() => void) | undefined
  onCleanup(() => endScrub?.())

  function startScrub(e: PointerEvent, tid: string, key: string) {
    e.preventDefault()
    const startX = e.clientX
    const startV = (flame.transforms as never)[tid].preAffine[key] as number
    const onMove = (ev: PointerEvent) => {
      const next = +(startV + (ev.clientX - startX) * 0.004).toFixed(3)
      setFlame(
        'transforms',
        tid as never,
        'preAffine' as never,
        key as never,
        next as never,
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      endScrub = undefined
    }
    endScrub = onUp
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function reset() {
    const fresh = structuredClone(example45)
    for (const tid of tids) {
      setFlame(
        'transforms',
        tid as never,
        'preAffine' as never,
        (fresh.transforms as never)[tid].preAffine,
      )
    }
    setZoom(baseZoom)
  }

  return (
    <div class="studio-stage">
      <div class="studio-viewport" ref={viewport}>
        <PosterFlame
          flame={flame}
          poster={posterFor('example45')}
          posterClass="plate-canvas"
          quality={0.97}
          pointCountPerBatch={256}
          canvasClass="plate-canvas"
          cameraPosition={cameraPosition}
          cameraZoom={zoom}
        />
        <span class="corner c1" />
        <span class="corner c2" />
        <span class="corner c3" />
        <span class="corner c4" />
        <div class="hud">
          <div class="row">
            <span>VIEWPORT · live</span>
            <span>spectrum swirl</span>
          </div>
          <div class="row">
            <span>zoom {zoom().toFixed(2)}×</span>
            <span>scroll to zoom · drag values</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="ph">
          <span>transforms</span>
          <button class="reset" type="button" onClick={reset}>
            reset
          </button>
        </div>
        <For each={tids}>
          {(tid, i) => (
            <div class="xform">
              <div class="xh">
                <span
                  class="swatch"
                  style={`background:${SWATCHES[i() % SWATCHES.length]}`}
                />
                F{i()}
                <span class="prob">
                  p{' '}
                  {(
                    (flame.transforms as never)[tid].probability / total
                  ).toFixed(2)}
                </span>
              </div>
              <div class="matrix">
                <For each={AFFINE_KEYS}>
                  {(k) => (
                    <span>
                      {k}{' '}
                      <b
                        class="scrub"
                        onPointerDown={(e) => {
                          startScrub(e, tid, k)
                        }}
                      >
                        {(
                          (flame.transforms as never)[tid].preAffine[
                            k
                          ] as number
                        ).toFixed(2)}
                      </b>
                    </span>
                  )}
                </For>
              </div>
              <div class="vbar">
                <For
                  each={Object.values(
                    (flame.transforms as never)[tid].variations,
                  )}
                >
                  {(v: never) => (
                    <span class="vtag">
                      {prettyVariation((v as { type: string }).type)}{' '}
                      {(v as { weight: number }).weight}
                    </span>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
