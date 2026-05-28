import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { vec2f, vec4f } from 'typegpu/data'
import { STATIC_PREVIEW_POINT_COUNT, THUMBNAIL_PREVIEW_QUALITY } from '@/defaults'
import { examples } from '@/flame/examples'
import { Flam3 } from '@/flame/Flam3'
import { Cross } from '@/icons'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Root } from '@/lib/Root'
import { formatRecentDate,loadRecentFlames } from '@/utils/recentFlames'
import { recordEntries } from '@/utils/record'
import { DelayedShow } from '../DelayedShow/DelayedShow'
import ui from './BlendFlameGallery.module.css'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

type BlendFlameGalleryProps = {
  anchorEl?: HTMLElement
  onSelect: (flame: FlameDescriptor) => void
  onClose: () => void
}

const CURATED_EXAMPLES = [
  'example1',
  'example3',
  'example14',
  'example16',
  'example19',
  'example24',
] as const

function Preview(props: { flameDescriptor: FlameDescriptor }) {
  return (
    <Root adapterOptions={{ powerPreference: 'high-performance' }}>
      <AutoCanvas pixelRatio={1}>
        <Camera2D
          position={vec2f(
            ...props.flameDescriptor.renderSettings.camera.position,
          )}
          zoom={props.flameDescriptor.renderSettings.camera.zoom}
        >
          <Flam3
            quality={THUMBNAIL_PREVIEW_QUALITY}
            pointCountPerBatch={STATIC_PREVIEW_POINT_COUNT}
            adaptiveFilterEnabled={false}
            animationEnabled={false}
            flameDescriptor={props.flameDescriptor}
            renderInterval={1}
            onExportImage={undefined}
            edgeFadeColor={vec4f(0)}
            onAccumulatedPointCount={() => {}}
          />
        </Camera2D>
      </AutoCanvas>
    </Root>
  )
}

export function BlendFlameGallery(props: BlendFlameGalleryProps) {
  const [panelPos, setPanelPos] = createSignal({ x: 0, y: 0 })

  function computePosition() {
    if (!props.anchorEl) {
      setPanelPos({
        x: window.innerWidth / 2 - 200,
        y: window.innerHeight / 3,
      })
      return
    }
    const rect = props.anchorEl.getBoundingClientRect()
    const x = Math.min(rect.left, window.innerWidth - 500)
    const y = Math.min(rect.bottom + 8, window.innerHeight - 400)
    setPanelPos({ x, y })
  }

  createEffect(() => {
    if (props.anchorEl) computePosition()

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('resize', computePosition)
    onCleanup(() => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', computePosition)
    })
  })

  const recentFlames = () =>
    loadRecentFlames().slice(0, 6)
  const exampleEntries = () =>
    recordEntries(examples)
      .filter(([id]) => (CURATED_EXAMPLES as readonly string[]).includes(id))
      .map(([id, flame]) => ({
        id,
        name: id === 'initExample' ? 'Init' : id.replace(/^example/, '#'),
        flame,
      }))

  return (
    <Portal>
      <div class={ui.backdrop} onClick={props.onClose} />
      <div
        class={ui.panel}
        style={{
          left: `${panelPos().x}px`,
          top: `${panelPos().y}px`,
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div class={ui.header}>
          <span class={ui.title}>Pick Blend Flame</span>
          <button
            class={ui.closeBtn}
            onClick={props.onClose}
            title="Close (Esc)"
          >
            <Cross />
          </button>
        </div>

        <Show when={recentFlames().length > 0}>
          <div class={ui.section}>
            <div class={ui.sectionLabel}>Recent</div>
            <div class={ui.grid}>
              <For each={recentFlames()}>
                {(recent, i) => (
                  <button
                    class={ui.item}
                    title={`${recent.name} — ${formatRecentDate(recent.savedAt)}`}
                    onClick={() => { props.onSelect(recent.flame); }}
                  >
                    <DelayedShow delayMs={i() * 30}>
                      <Preview flameDescriptor={recent.flame} />
                    </DelayedShow>
                    <div class={ui.itemName}>{recent.name}</div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class={ui.section}>
          <div class={ui.sectionLabel}>Examples</div>
          <div class={ui.grid}>
            <For each={exampleEntries()}>
              {({ name, flame }, i) => (
                <button
                  class={ui.item}
                  title={name}
                  onClick={() => { props.onSelect(flame); }}
                >
                  <DelayedShow delayMs={i() * 30}>
                    <Preview flameDescriptor={flame} />
                  </DelayedShow>
                  <div class={ui.itemName}>{name}</div>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Portal>
  )
}
