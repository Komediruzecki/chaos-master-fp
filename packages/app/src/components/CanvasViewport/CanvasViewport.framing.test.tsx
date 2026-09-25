/**
 * What the canvas viewport does with the part of the canvas that chrome
 * floating over it covers (lib/canvasFraming.ts), the tablet deck at the
 * trailing edge and the glass desktop sidebar at the leading one, besides
 * the camera's shift.
 *
 * The edge fade goes while either floats over the canvas, or the rail's
 * glass sheet: the canvas's rim is under the glass there, and the fade laid
 * a dark band down it (a light one in the light theme) that the setting-off
 * page never had. The box carries the covered shares as --covered-left and
 * --covered-right, so the hover badge centres on the part on show instead
 * of on the whole canvas (App.module.css), and under the rail's glass sheet
 * it paints the flame's ground where the sheet moves the canvas up.
 */
import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ui from '@/App.module.css'
import { examples } from '@/flame/examples'
import { NOT_COVERED, setLeadingCover, setTrailingCover, } from '@/lib/canvasFraming'
import { setGlassPanels } from '@/lib/glass'
import { CanvasViewport, EDGE_FADE_COLOR, edgeFadeColor, } from './CanvasViewport'
import type { CanvasViewportProps } from './CanvasViewport'

// The canvas and the export tracker need WebGPU; the box does not.
vi.mock('@/lib/AutoCanvas', () => ({ AutoCanvas: () => null }))
vi.mock('@/components/ExportJobs/ExportJobHost', () => ({
  ExportJobHost: () => null,
}))
vi.mock('@/components/ExportJobs/ExportJobTracker', () => ({
  ExportJobTracker: () => null,
}))
vi.mock('@/components/ProgressBar/ProgressBar', () => ({
  ProgressBar: () => null,
}))
// A 1180 x 820 landscape tablet: a 1100 px canvas box beside the rail. The
// test DOM lays nothing out, so the box's size is given.
vi.mock('@/utils/useElementSize', () => ({
  useElementSize: () => () => ({
    width: 1100,
    height: 820,
    widthPX: 1100,
    heightPX: 820,
  }),
}))

/** A 380 px deck over a 1100 px canvas. */
const COVERED = 380 / 1100
/** 200 px of the same canvas under the glass sidebar. */
const COVERED_LEFT = 200 / 1100

const channels = (colour: { x: number; y: number; z: number; w: number }) => [
  colour.x,
  colour.y,
  colour.z,
  colour.w,
]

function mountViewport(effectiveFlame = examples.example1, railInset = 0) {
  const props = {
    railInset: () => railInset,
    isMobile: () => false,
    showSidebar: () => true,
    onCanvasClick: () => {},
    onToggleMobileSidebar: () => {},
    flameDescriptor: examples.example1,
    effectiveFlame: () => effectiveFlame,
    hoveredVariationType: () => null,
    hoveredCustomVarDef: () => null,
    hoveredBlendName: () => null,
    blendIntent: () => 'blend',
    exportDimensions: () => undefined,
    onExportImage: () => undefined,
    theme: () => 'dark',
  }
  const { container } = render(() => (
    <CanvasViewport {...(props as unknown as CanvasViewportProps)} />
  ))
  return container.querySelector<HTMLElement>('[data-tour-target="canvas"]')!
}

afterEach(() => {
  setTrailingCover(0)
  setLeadingCover(0)
  setGlassPanels(true)
  cleanup()
})

describe('the edge fade', () => {
  it("is the theme's beside the sidebar with nothing over the canvas", () => {
    expect(edgeFadeColor('dark', true, NOT_COVERED, false)).toBe(
      EDGE_FADE_COLOR.dark,
    )
    expect(edgeFadeColor('light', true, NOT_COVERED, false)).toBe(
      EDGE_FADE_COLOR.light,
    )
  })

  it('is off in full screen, as it always was', () => {
    expect(channels(edgeFadeColor('dark', false, NOT_COVERED, false))).toEqual([
      0, 0, 0, 0,
    ])
  })

  it('is off while the deck floats open over the canvas', () => {
    const deck = { left: 0, right: COVERED }
    expect(channels(edgeFadeColor('dark', true, deck, false))).toEqual([
      0, 0, 0, 0,
    ])
    expect(channels(edgeFadeColor('light', true, deck, false))).toEqual([
      0, 0, 0, 0,
    ])
  })

  it("is off while the rail's glass sheet moves the canvas up", () => {
    // The rim of the moved canvas lay across the flame's ground the box
    // paints below it, a pale band on black in the light theme.
    expect(channels(edgeFadeColor('light', true, NOT_COVERED, true))).toEqual([
      0, 0, 0, 0,
    ])
    expect(channels(edgeFadeColor('dark', true, NOT_COVERED, true))).toEqual([
      0, 0, 0, 0,
    ])
  })

  it('is off while the glass sidebar floats over the canvas', () => {
    const sidebar = { left: COVERED_LEFT, right: 0 }
    expect(channels(edgeFadeColor('dark', true, sidebar, false))).toEqual([
      0, 0, 0, 0,
    ])
  })
})

describe('the covered share on the canvas box', () => {
  it('is there while the deck covers part of the canvas', () => {
    setTrailingCover(380)
    const box = mountViewport()

    expect(Number(box.style.getPropertyValue('--covered-right'))).toBeCloseTo(
      COVERED,
    )
  })

  it('is absent with nothing over the canvas, as before there was any', () => {
    const box = mountViewport()

    expect(box.style.getPropertyValue('--covered-right')).toBe('')
  })

  it("carries the sidebar's share at the leading edge", () => {
    const box = mountViewport()

    setLeadingCover(200)
    expect(Number(box.style.getPropertyValue('--covered-left'))).toBeCloseTo(
      COVERED_LEFT,
    )
    expect(box.style.getPropertyValue('--covered-right')).toBe('')
    setLeadingCover(0)
    expect(box.style.getPropertyValue('--covered-left')).toBe('')
  })

  it('follows the deck as it opens and closes', () => {
    const box = mountViewport()

    setTrailingCover(380)
    expect(Number(box.style.getPropertyValue('--covered-right'))).toBeCloseTo(
      COVERED,
    )
    setTrailingCover(0)
    expect(box.style.getPropertyValue('--covered-right')).toBe('')
  })
})

describe('the ground under the canvas', () => {
  // The rail's sheet moves the canvas up and uncovers a strip of the box at
  // its foot, on show through the glass sheet: the box paints the ground the
  // flame is drawn on there (App.module.css, .underSheet).
  const SHEET = 240

  it('is the ground the flame is drawn on, under the glass sheet', () => {
    const light = {
      ...examples.example1,
      renderSettings: {
        ...examples.example1.renderSettings,
        drawMode: 'light' as const,
        backgroundColor: undefined,
      },
    }
    const box = mountViewport(light, SHEET)
    expect(box.classList.contains(ui.underSheet!)).toBe(true)
    expect(box.style.getPropertyValue('--canvas-ground')).toBe('rgb(0 0 0)')
    cleanup()

    const paint = {
      ...light,
      renderSettings: { ...light.renderSettings, drawMode: 'paint' as const },
    }
    expect(
      mountViewport(paint, SHEET).style.getPropertyValue('--canvas-ground'),
    ).toBe('rgb(255 255 255)')
  })

  // At peek, and with the sheet opaque, the box shows the page behind it,
  // as it always did: the gutters of a letterboxed canvas show it too.
  it('is not painted at peek', () => {
    const box = mountViewport(examples.example1, 0)
    expect(box.classList.contains(ui.underSheet!)).toBe(false)
    expect(box.style.getPropertyValue('--canvas-ground')).toBe('')
  })

  it('is not painted with the Glass panels setting off', () => {
    setGlassPanels(false)
    const box = mountViewport(examples.example1, SHEET)
    expect(box.classList.contains(ui.underSheet!)).toBe(false)
    expect(box.style.getPropertyValue('--canvas-ground')).toBe('')
  })
})
