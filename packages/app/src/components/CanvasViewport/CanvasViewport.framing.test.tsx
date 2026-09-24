/**
 * What the canvas viewport does with the part of the canvas the floating
 * tablet deck covers (lib/canvasFraming.ts), besides the camera's shift.
 *
 * The edge fade goes while the deck floats open: the canvas's trailing rim is
 * under the glass there, and the fade laid a dark band down the deck (a light
 * one in the light theme) that the setting-off page never had. And the box
 * carries the covered share as --covered-right, so the hover badge centres
 * on the part on show instead of on the whole canvas (App.module.css).
 */
import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { examples } from '@/flame/examples'
import { setTrailingCover } from '@/lib/canvasFraming'
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

const channels = (colour: { x: number; y: number; z: number; w: number }) => [
  colour.x,
  colour.y,
  colour.z,
  colour.w,
]

function mountViewport() {
  const props = {
    isMobile: () => false,
    showSidebar: () => true,
    onCanvasClick: () => {},
    onToggleMobileSidebar: () => {},
    flameDescriptor: examples.example1,
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
  cleanup()
})

describe('the edge fade', () => {
  it("is the theme's beside the sidebar with nothing over the canvas", () => {
    expect(edgeFadeColor('dark', true, 0)).toBe(EDGE_FADE_COLOR.dark)
    expect(edgeFadeColor('light', true, 0)).toBe(EDGE_FADE_COLOR.light)
  })

  it('is off in full screen, as it always was', () => {
    expect(channels(edgeFadeColor('dark', false, 0))).toEqual([0, 0, 0, 0])
  })

  it('is off while the deck floats open over the canvas', () => {
    expect(channels(edgeFadeColor('dark', true, COVERED))).toEqual([0, 0, 0, 0])
    expect(channels(edgeFadeColor('light', true, COVERED))).toEqual([
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
