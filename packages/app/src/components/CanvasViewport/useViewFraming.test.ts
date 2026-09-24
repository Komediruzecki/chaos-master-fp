/**
 * The canvas end of the framing beside the floating tablet deck: what the
 * cameras are given, what the canvas says about itself, and what a capture is
 * handed, with the deck over the canvas and without it, and while an export
 * sizes the canvas (useViewFraming.ts).
 */
import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_SHIFT, setTrailingCover } from '@/lib/canvasFraming'
import { useViewFraming } from './useViewFraming'
import type { ExportImageType } from '@/flame/exportImageType'
import type { ExportDimensions } from '@/utils/exportDimensions'

/** A 1180 x 820 landscape tablet: the canvas box is 1100 x 820 CSS px. */
function mountFraming() {
  const [width, setWidth] = createSignal<number | undefined>(1100)
  const [exportDimensions, setExportDimensions] =
    createSignal<ExportDimensions>()
  const [onExportImage, setOnExportImage] = createSignal<ExportImageType>()
  const canvas = document.createElement('canvas')
  canvas.width = 1100
  canvas.height = 820
  let dispose = () => {}
  const framing = createRoot((disposeRoot) => {
    dispose = disposeRoot
    return useViewFraming({
      width,
      canvas: () => canvas,
      exportDimensions,
      onExportImage,
    })
  })
  return {
    framing,
    canvas,
    setWidth,
    setExportDimensions,
    setOnExportImage,
    dispose,
  }
}

/** The 2D context the cut draws into, which the test runtime does not have. */
function stubDrawing() {
  // `never`, since the spy is typed by getContext's last overload, 'webgpu'.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        globalCompositeOperation: 'source-over',
        drawImage: () => {},
      }) as never,
  )
}

afterEach(() => {
  setTrailingCover(0)
  vi.restoreAllMocks()
})

describe('the view framing', () => {
  it('shifts nothing and marks nothing while nothing covers the canvas', () => {
    const { framing, canvas, dispose } = mountFraming()

    expect(framing.viewShift()).toBe(NO_SHIFT)
    expect(canvas.dataset.coveredRight).toBeUndefined()
    dispose()
  })

  it('frames the flame beside the deck and says how much it covers', () => {
    const { framing, canvas, dispose } = mountFraming()

    setTrailingCover(380)

    // The centre moves half the deck's width to the left: 190 of the
    // canvas's 550 half-width, in clip units.
    expect(framing.viewShift().x).toBeCloseTo(-380 / 1100, 6)
    expect(framing.viewShift().y).toBe(0)
    expect(Number(canvas.dataset.coveredRight)).toBeCloseTo(380 / 1100, 6)
    dispose()
  })

  it('follows the deck as it widens and closes', () => {
    const { framing, canvas, dispose } = mountFraming()

    setTrailingCover(380)
    setTrailingCover(420)
    expect(framing.viewShift().x).toBeCloseTo(-420 / 1100, 6)

    setTrailingCover(0)
    expect(framing.viewShift()).toBe(NO_SHIFT)
    expect(canvas.dataset.coveredRight).toBeUndefined()
    dispose()
  })

  it('waits for the canvas box to be laid out', () => {
    const { framing, setWidth, dispose } = mountFraming()

    setWidth(undefined)
    setTrailingCover(380)
    expect(framing.viewShift()).toBe(NO_SHIFT)

    setWidth(1100)
    expect(framing.viewShift().x).toBeCloseTo(-380 / 1100, 6)
    dispose()
  })
})

describe('what a capture is handed', () => {
  it('is nothing to install while nothing waits for a frame', () => {
    const { framing, dispose } = mountFraming()

    expect(framing.exportImage()).toBeUndefined()
    dispose()
  })

  it('is the visible part while the deck covers some of the canvas', () => {
    stubDrawing()
    const { framing, canvas, setOnExportImage, dispose } = mountFraming()
    const capture = vi.fn()
    setTrailingCover(380)
    setOnExportImage(() => capture)

    framing.exportImage()?.(canvas, { finalImageReady: true })

    const handed = capture.mock.calls[0]?.[0] as HTMLCanvasElement
    expect(handed).not.toBe(canvas)
    expect([handed.width, handed.height]).toEqual([720, 820])
    dispose()
  })

  it('is the whole canvas, unshifted, while an export sizes the canvas', () => {
    // An export renders its own frame at its own size: the deck has no
    // part in it, so the camera is not shifted and nothing is cut.
    stubDrawing()
    const { framing, canvas, setExportDimensions, setOnExportImage, dispose } =
      mountFraming()
    const capture = vi.fn()
    setTrailingCover(380)
    setExportDimensions({ width: 1920, height: 1080 })
    setOnExportImage(() => capture)

    expect(framing.viewShift()).toBe(NO_SHIFT)
    expect(canvas.dataset.coveredRight).toBeUndefined()
    framing.exportImage()?.(canvas, { finalImageReady: true })
    expect(capture).toHaveBeenCalledWith(canvas, { finalImageReady: true })

    setExportDimensions(undefined)
    expect(framing.viewShift().x).toBeCloseTo(-380 / 1100, 6)
    dispose()
  })
})
