import { createMemo, createSignal, For, Show } from 'solid-js'
import { ComputeGate, useComputeGate } from '@/contexts/ComputeGateContext'
import { example1 } from '@/flame/examples/example1'
import { example29 } from '@/flame/examples/example29'
import { example33 } from '@/flame/examples/example33'
import { example40 } from '@/flame/examples/example40'
import { example45 } from '@/flame/examples/example45'
import { Root } from '@/lib/Root'
import { useIntersectionObserver } from '@/utils/useIntersectionObserver'
import { variationSummary } from '../lib/flame'
import FlameView from './FlameView'
import OpenInApp from './OpenInApp'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Gallery grid as a single Solid island so every live preview shares one
 * <ComputeGate> (mirrors the editor's LoadFlameModal). Each plate renders the
 * app's real Flam3 on its own Root, mounted only once scrolled into view; flames
 * converge to a quality target then idle, so several coexist comfortably.
 */
type Plate = { flame: FlameDescriptor; cls: string; title: string }

const PLATES: Plate[] = [
  { flame: example29, cls: 'wide span8', title: 'Aurora Drift' },
  { flame: example1, cls: 'tall span4', title: 'First Light' },
  { flame: example33, cls: 'span4', title: 'Ember Lattice' },
  { flame: example40, cls: 'span4', title: 'Tidal Bloom' },
  { flame: example45, cls: 'span4', title: 'Spectrum Swirl' },
]

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
  // weak WebGPU impls (Firefox/Linux/AMD) OOM with many at once. Re-accumulates
  // on re-entry, but the adaptive filter makes that quick.
  const [hovered, setHovered] = createSignal(false)

  return (
    <div
      class={`plate ${props.plate.cls}`}
      ref={setContainer}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Show when={allowed() || isVisible()}>
        <Root adapterOptions={{ powerPreference: 'high-performance' }}>
          <FlameView
            flame={props.plate.flame}
            quality={hovered() ? 0.97 : 0.9}
            pointCountPerBatch={196}
            canvasClass="plate-canvas"
          />
        </Root>
      </Show>
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
