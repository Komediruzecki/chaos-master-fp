import { createEffect, createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { AudioAnalyzer } from '@/utils/audioAnalysis'
import ui from './SpectrogramStrip.module.css'

// ── Heatmap LUT (256 entries, dark → blue → cyan → green → yellow → red) ──

function buildHeatLUT(): Uint8Array[] {
  const stops = [
    { t: 0, r: 8, g: 8, b: 16 },
    { t: 0.15, r: 10, g: 20, b: 80 },
    { t: 0.3, r: 10, g: 100, b: 120 },
    { t: 0.45, r: 30, g: 160, b: 80 },
    { t: 0.6, r: 60, g: 200, b: 40 },
    { t: 0.75, r: 200, g: 200, b: 20 },
    { t: 0.9, r: 230, g: 120, b: 10 },
    { t: 1, r: 255, g: 240, b: 200 },
  ]
  const lut: Uint8Array[] = []
  let si = 0
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    while (si < stops.length - 1 && stops[si + 1]!.t < t) si++
    const lo = stops[si]!
    const hi = stops[Math.min(si + 1, stops.length - 1)]!
    const local = hi.t - lo.t > 0 ? (t - lo.t) / (hi.t - lo.t) : 0
    const a = (v: 'r' | 'g' | 'b') =>
      Math.round(lo[v] + (hi[v] - lo[v]) * local)
    lut.push(new Uint8Array([a('r'), a('g'), a('b')]))
  }
  return lut
}

const HEAT_LUT = buildHeatLUT()
const BAND_COUNT = 8

// ── Component ──

export interface SpectrogramStripProps {
  fileAnalyzer: Accessor<AudioAnalyzer | undefined>
  frameWidth: Accessor<number>
  scrollLeft: Accessor<number>
  trackNameWidth: Accessor<number>
  startFrame: number
  endFrame: number
  /** Ref callback exposed so DopeSheet can sync horizontal scroll. */
  laneRef?: (el: HTMLDivElement) => void
}

export function SpectrogramStrip(props: SpectrogramStripProps) {
  let canvasRef: HTMLCanvasElement | undefined

  const totalFrames = createMemo(() => {
    const a = props.fileAnalyzer()
    return a ? a.totalFrames : 0
  })

  const canvasPixelWidth = createMemo(() => {
    return (props.endFrame - props.startFrame) * props.frameWidth()
  })

  function draw() {
    const canvas = canvasRef
    if (!canvas) return
    const analyzer = props.fileAnalyzer()
    if (!analyzer) return

    const fw = props.frameWidth()
    const sl = props.scrollLeft()
    const tf = props.endFrame - props.startFrame

    const rect = canvas.getBoundingClientRect()
    // Use parent's visible width, not the canvas logical width
    // (canvas is wider than viewport, we only render the visible portion)
    const parent = canvas.parentElement
    const cw = parent
      ? parent.clientWidth
      : Math.min(rect.width, window.innerWidth)
    const ch = Math.floor(rect.height)
    if (cw <= 0 || ch <= 0) return

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Dark background
    ctx.fillStyle = '#080808'
    ctx.fillRect(0, 0, cw, ch)

    const bandH = ch / BAND_COUNT

    // Visible frame range in global coordinates
    const frameFrom = Math.max(0, Math.floor(sl / fw))
    const frameTo = Math.min(tf, Math.ceil((sl + cw) / fw))

    if (frameFrom >= frameTo) return

    // Render visible columns
    for (let px = 0; px < cw; px++) {
      const absX = sl + px
      const fStart = Math.max(0, Math.floor(absX / fw))
      const fEnd = Math.min(tf, Math.ceil((absX + 1) / fw))

      // Max energy per band across all frames mapping to this column
      const maxEnergies = new Float32Array(BAND_COUNT)
      for (let f = fStart; f < fEnd; f++) {
        try {
          const fd = analyzer.getFrameData(f)
          for (let b = 0; b < BAND_COUNT; b++) {
            const v = fd.bands[b] ?? 0
            if (v > maxEnergies[b]!) maxEnergies[b] = v
          }
        } catch {
          /* frame out of range — skip */
        }
      }

      // Fill column
      for (let b = 0; b < BAND_COUNT; b++) {
        const energy = maxEnergies[b]!
        const lutIdx = Math.min(255, Math.max(0, Math.floor(energy * 255)))
        const col = HEAT_LUT[lutIdx]!
        const yFrom = Math.floor(b * bandH)
        const yTo = Math.floor((b + 1) * bandH)
        // Batch fill via fillRect per band per column
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
        ctx.fillRect(px, yFrom, 1, yTo - yFrom)
      }
    }

    // Beat marker ticks at top + bottom
    for (let f = frameFrom; f < frameTo; f++) {
      try {
        const fd = analyzer.getFrameData(f)
        if (!fd.isBeat) continue
        const bx = Math.round(f * fw - sl)
        if (bx < 0 || bx >= cw) continue
        ctx.fillStyle = 'rgba(255,255,255,0.45)'
        ctx.fillRect(bx, 0, 1, 2)
        ctx.fillRect(bx, ch - 2, 1, 2)
      } catch {
        /* skip */
      }
    }
  }

  createEffect(() => {
    // Depend on reactive signals so effect fires on changes
    void props.scrollLeft()
    void props.frameWidth()
    void totalFrames()
    draw()
  })

  return (
    <div class={ui.strip}>
      {/* Spacer aligns content with the track area (past the name column) */}
      <div class={ui.spacer} style={{ width: `${props.trackNameWidth()}px` }} />
      {/* Scrollable lane — synced with tracks by DopeSheet via laneRef */}
      <div
        ref={(el) => {
          props.laneRef?.(el)
        }}
        class={ui.lane}
      >
        <canvas
          ref={canvasRef}
          class={ui.heatCanvas}
          // The canvas logical width covers the full timeline so it can be
          // scrolled naturally alongside the dope sheet tracks.
          style={{ width: `${canvasPixelWidth()}px`, height: '64px' }}
        />
      </div>
    </div>
  )
}
