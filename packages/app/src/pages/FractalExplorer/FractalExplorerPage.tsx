/**
 * The deep-zoom explorer page: a full-bleed canvas, a heads-up readout and
 * a settings panel. The picture itself is `ExplorerRenderer`; this file only
 * owns the state a person can change and how it is shown.
 */
import { formatMagnification, homeView, JULIA_HOME } from '@chaos-master/core'
import { createMemo, createSignal, Show } from 'solid-js'
import { useToast } from '@/contexts/ToastContext'
import { ChevronLeft, Settings } from '@/icons'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { downloadBlob } from '@/utils/blob'
import { ExplorerControls } from './ExplorerControls'
import { createExplorerLocation } from './explorerLocation'
import { resolvePalette } from './explorerPalette'
import { ExplorerRenderer } from './ExplorerRenderer'
import ui from './FractalExplorerPage.module.css'
import type { ExplorerGpu } from './explorerGpu'
import type { ExplorerStatus } from './ExplorerRenderer'
import type { ColourSetup } from './explorerTypes'
import type { Palette } from '@/flame/colorMap'

export type Quality = 'fast' | 'balanced' | 'sharp'

/** Render pixels at most, and supersamples per pixel once finished. */
const QUALITY: Record<Quality, { pixels: number; samples: number }> = {
  fast: { pixels: 640_000, samples: 1 },
  balanced: { pixels: 2_200_000, samples: 8 },
  sharp: { pixels: 4_200_000, samples: 16 },
}

export function FractalExplorerPage() {
  const { showToast } = useToast()
  const { location, update, link } = createExplorerLocation()
  const [picked, setPicked] = createSignal<Palette | undefined>()
  // Read from the location, so a link pasted into this tab brings its
  // palette along with its view.
  const palette = createMemo(() =>
    resolvePalette(location().paletteId, picked()),
  )
  const [period, setPeriod] = createSignal(64)
  const [phase, setPhase] = createSignal(0)
  const [relief, setRelief] = createSignal(0.5)
  const [quality, setQuality] = createSignal<Quality>('balanced')
  const [panelOpen, setPanelOpen] = createSignal(
    typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 900px)').matches,
  )
  const [status, setStatus] = createSignal<ExplorerStatus | undefined>()
  let readDisplay: ExplorerGpu['readDisplay'] | undefined

  const scene = createMemo(() => {
    const l = location()
    return {
      kind: l.kind,
      view: l.view,
      juliaC: l.juliaC,
      maxIterations: l.maxIterations,
    }
  })

  const colour = createMemo<ColourSetup>(() => ({
    period: period(),
    phase: phase(),
    relief: relief(),
    interior: [0.015, 0.015, 0.02],
    background: [0.05, 0.055, 0.07],
  }))

  function selectPalette(next: Palette) {
    setPicked(next)
    update({ paletteId: next.id })
  }

  async function copyLink() {
    try {
      await globalThis.navigator.clipboard.writeText(link())
      showToast('Link copied: it reopens this exact view.')
    } catch {
      showToast(
        'Could not reach the clipboard. The address bar has the same link.',
      )
    }
  }

  async function savePicture() {
    const shot = await readDisplay?.()
    if (!shot) return
    const canvas = document.createElement('canvas')
    canvas.width = shot.size.width
    canvas.height = shot.size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(
      new ImageData(shot.data, shot.size.width, shot.size.height),
      0,
      0,
    )
    canvas.toBlob((blob) => {
      if (!blob) return
      const zoom = formatMagnification(location().view.zoomLog2).replace(
        '.',
        '_',
      )
      downloadBlob(blob, `${location().kind}-x${zoom}.png`)
    }, 'image/png')
  }

  const progress = () => status()?.progress ?? 0

  return (
    <div class={ui.page}>
      <div class={ui.stage}>
        <AutoCanvas
          class={ui.canvas}
          pixelRatio={window.devicePixelRatio || 1}
          role="application"
          ariaLabel="Fractal view. Drag or use the arrow keys to pan; scroll, pinch or press plus and minus to zoom."
        >
          <ExplorerRenderer
            scene={scene}
            setView={(view) => {
              update({ view })
            }}
            colour={colour}
            palette={palette}
            pixelCap={() => QUALITY[quality()].pixels}
            samples={() => QUALITY[quality()].samples}
            onStatus={setStatus}
            onReady={(api) => {
              readDisplay = api.readDisplay
            }}
          />
        </AutoCanvas>
      </div>

      <div
        class={ui.progress}
        style={{ transform: `scaleX(${progress()})` }}
        data-done={progress() >= 1 ? '' : undefined}
        aria-hidden="true"
      />

      <header class={ui.hud}>
        <a class={ui.iconButton} href="/" aria-label="Back to Chaos Master">
          <ChevronLeft />
        </a>
        <div class={ui.titleBlock}>
          <span class={ui.title}>Deep zoom</span>
          <span class={ui.subtitle}>
            {location().kind === 'julia' ? 'Julia set' : 'Mandelbrot set'}
          </span>
        </div>
        <dl class={ui.readouts}>
          <div>
            <dt>Zoom</dt>
            <dd>{formatMagnification(location().view.zoomLog2)}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>
              <Show when={!status()?.orbitPending} fallback="Reference">
                {Math.floor(progress() * 100)}%
              </Show>
            </dd>
          </div>
        </dl>
        <button
          type="button"
          class={ui.iconButton}
          aria-label={panelOpen() ? 'Hide settings' : 'Show settings'}
          aria-expanded={panelOpen()}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <Settings />
        </button>
      </header>

      <Show when={panelOpen()}>
        <aside class={ui.panel} aria-label="Explorer settings">
          <ExplorerControls
            location={location()}
            status={status()}
            palette={palette()}
            period={period()}
            phase={phase()}
            relief={relief()}
            quality={quality()}
            onKind={(kind) => {
              update({
                kind,
                view: kind === 'julia' ? JULIA_HOME : homeView(kind),
              })
            }}
            onJuliaC={(juliaC) => {
              update({ juliaC })
            }}
            onJuliaHere={() => {
              update({
                kind: 'julia',
                juliaC: {
                  re: location().view.centerRe,
                  im: location().view.centerIm,
                },
                view: JULIA_HOME,
              })
            }}
            onIterations={(maxIterations) => {
              update({ maxIterations })
            }}
            onPalette={selectPalette}
            onPeriod={setPeriod}
            onPhase={setPhase}
            onRelief={setRelief}
            onQuality={setQuality}
            onHome={() => {
              update({ view: homeView(location().kind) })
            }}
            onCopyLink={() => void copyLink()}
            onSave={() => void savePicture()}
          />
        </aside>
      </Show>
    </div>
  )
}
