import { createMemo, createSignal, For } from 'solid-js'
import { ComputeGate, useComputeGate } from '@/contexts/ComputeGateContext'
import { example1 } from '@/flame/examples/example1'
import { example29 } from '@/flame/examples/example29'
import { example33 } from '@/flame/examples/example33'
import { example40 } from '@/flame/examples/example40'
import { example45 } from '@/flame/examples/example45'
import { useIntersectionObserver } from '@/utils/useIntersectionObserver'
import { posterFor, variationSummary } from '../lib/flame'
import OpenInApp from './OpenInApp'
import PosterFlame from './PosterFlame'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Gallery grid as a single Solid island so every live preview shares one
 * <ComputeGate> (mirrors the editor's LoadFlameModal). Each plate renders the
 * app's real Flam3 via PosterFlame — a static poster shows until the live flame
 * converges (and whenever WebGPU is unavailable / has failed); the live flame
 * mounts only once scrolled into view and unmounts when scrolled away, so
 * concurrent GPU contexts stay bounded.
 */
type Plate = {
  flame: FlameDescriptor
  /** Poster name under public/posters/ (see LANDING_FLAMES in lib/flame). */
  poster: string
  cls: string
  title: string
}

const PLATES: Plate[] = [
  {
    flame: example1,
    poster: 'example1',
    cls: 'wide span8',
    title: 'First Light',
  },
  {
    flame: example29,
    poster: 'example29',
    cls: 'tall span4',
    title: 'Aurora Drift',
  },
  {
    flame: example33,
    poster: 'example33',
    cls: 'span4',
    title: 'Ember Lattice',
  },
  { flame: example40, poster: 'example40', cls: 'span4', title: 'Tidal Bloom' },
  {
    flame: example45,
    poster: 'example45',
    cls: 'span4',
    title: 'Spectrum Swirl',
  },
]

// Cursor-following 3D tilt for the gallery plates (mouse only; skipped under
// prefers-reduced-motion). Applied as an inline transform that supersedes the
// CSS :hover lift while pointing, cleared on leave so CSS eases it back.
const TILT_DEG = 7
const prefersReducedMotion = () =>
  typeof globalThis.matchMedia === 'function' &&
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches

function tiltPlate(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || prefersReducedMotion()) return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  el.style.transition = 'transform 0.1s ease-out'
  el.style.transform =
    `perspective(900px) rotateX(${(-py * TILT_DEG).toFixed(2)}deg) ` +
    `rotateY(${(px * TILT_DEG).toFixed(2)}deg) translateY(-6px) scale(1.02)`
}

function untiltPlate(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.style.transition = '' // fall back to the CSS transform transition (0.3s)
  el.style.transform = ''
}

function PlatePreview(props: { plate: Plate }) {
  const [container, setContainer] = createSignal<HTMLElement>()
  const intersection = useIntersectionObserver(container)
  const isVisible = createMemo(() => intersection()?.isIntersecting ?? false)
  const allowed = useComputeGate(() => ({
    isVisible: isVisible(),
    renderStatus: 'done' as const,
    isSelected: false,
  }))

  // Render only while visible (or gate-allowed) and UNMOUNT when scrolled away,
  // so the number of concurrent live GPU flames stays bounded to a viewport —
  // weak WebGPU impls (Firefox/Linux/AMD) OOM with many at once. The poster
  // bridges the re-accumulation on re-entry (no blank flash).
  const [hovered, setHovered] = createSignal(false)

  return (
    <div
      class={`plate ${props.plate.cls}`}
      ref={setContainer}
      onPointerEnter={() => setHovered(true)}
      onPointerMove={tiltPlate}
      onPointerLeave={(e) => {
        setHovered(false)
        untiltPlate(e)
      }}
    >
      <PosterFlame
        flame={props.plate.flame}
        poster={posterFor(props.plate.poster)}
        posterClass="plate-canvas"
        inView={() => allowed() || isVisible()}
        quality={hovered() ? 0.97 : 0.9}
        pointCountPerBatch={196}
        canvasClass="plate-canvas"
      />
      <div class="meta">
        <div>
          <div class="t">
            {props.plate.flame.metadata?.name ?? props.plate.title}
          </div>
          <div class="v">{variationSummary(props.plate.flame)}</div>
        </div>
      </div>
      <OpenInApp flame={props.plate.flame} />
    </div>
  )
}

export default function GalleryFlames() {
  return (
    <div class="gallery">
      <ComputeGate capacity={3}>
        <For each={PLATES}>{(plate) => <PlatePreview plate={plate} />}</For>
      </ComputeGate>
    </div>
  )
}
