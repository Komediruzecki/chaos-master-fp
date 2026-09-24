/**
 * Images taken off the workspace canvas are cut to the part the floating
 * tablet deck leaves visible, so the view-only framing never leaves the
 * editor: not in a flash export, a share preview, a Discord post, a
 * thumbnail, nor in the aspect the export dialog matches (visibleCanvas.ts).
 * Each cut is the picture the setting-off canvas, exactly that visible part,
 * would have given.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureVisiblePart, coveredRightOf, drawVisibleCanvas, visibleCanvasAspect, visibleCanvasRect, visibleClientRect, } from './visibleCanvas'
import type { ExportImageInfo } from '@/flame/exportImageType'

/** A 1180 x 820 landscape tablet: a 1100 px canvas under a 380 px deck. */
const COVERED = 380 / 1100

function workspaceCanvas(width: number, height: number, covered?: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (covered !== undefined) canvas.dataset.coveredRight = String(covered)
  return canvas
}

/** Records what reaches a 2D context, which the test runtime does not draw. */
function recordDrawing() {
  const drawn: unknown[][] = []
  const context = {
    globalCompositeOperation: 'source-over',
    drawImage: (...args: unknown[]) => {
      drawn.push(args)
    },
  }
  // `never`, since the spy is typed by getContext's last overload, 'webgpu'.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as never,
  )
  return { drawn, context }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the covered share a canvas reports', () => {
  it('reads its attribute, and is 0 without one or with nonsense', () => {
    expect(coveredRightOf(workspaceCanvas(10, 10, 0.25))).toBe(0.25)
    expect(coveredRightOf(workspaceCanvas(10, 10))).toBe(0)
    const odd = workspaceCanvas(10, 10)
    odd.dataset.coveredRight = 'wide'
    expect(coveredRightOf(odd)).toBe(0)
  })
})

describe('visibleCanvasRect', () => {
  it('is the uncovered part of the canvas, in backing-store pixels', () => {
    expect(visibleCanvasRect(workspaceCanvas(1100, 820, COVERED))).toEqual([
      0, 0, 720, 820,
    ])
  })

  it('measures an image of the canvas by its own size', () => {
    // The thumbnail decodes a PNG of the canvas, and cuts that.
    const canvas = workspaceCanvas(1100, 820, COVERED)
    expect(visibleCanvasRect(canvas, { width: 2200, height: 1640 })).toEqual([
      0, 0, 1440, 1640,
    ])
  })

  it('is the whole canvas when nothing covers it', () => {
    expect(visibleCanvasRect(workspaceCanvas(720, 820))).toEqual([
      0, 0, 720, 820,
    ])
  })
})

describe('drawVisibleCanvas', () => {
  it('draws only the visible part of an image of the canvas', () => {
    // The randomizer history's 128 px thumbnail, from a PNG of an iPad's
    // canvas at twice its CSS size.
    const drawn: unknown[][] = []
    const context = {
      drawImage: (...args: unknown[]) => drawn.push(args),
    } as unknown as CanvasRenderingContext2D
    const canvas = workspaceCanvas(2200, 1640, COVERED)
    const png = workspaceCanvas(2200, 1640)

    drawVisibleCanvas(context, canvas, png, 128, 128)

    expect(drawn).toEqual([[png, 0, 0, 1440, 1640, 0, 0, 128, 128]])
  })
})

describe('visibleCanvasAspect', () => {
  function laidOut(width: number, height: number, covered?: number) {
    const canvas = workspaceCanvas(width, height, covered)
    Object.defineProperty(canvas, 'clientWidth', { value: width })
    Object.defineProperty(canvas, 'clientHeight', { value: height })
    return canvas
  }

  it('is the aspect of what the deck leaves visible', () => {
    // What the setting-off canvas, 720 x 820, reports.
    expect(visibleCanvasAspect(laidOut(1100, 820, COVERED))).toBeCloseTo(
      720 / 820,
      6,
    )
  })

  it('is the canvas aspect when nothing covers it', () => {
    expect(visibleCanvasAspect(laidOut(720, 820))).toBeCloseTo(720 / 820, 6)
  })
})

describe('captureVisiblePart', () => {
  const info: ExportImageInfo = { finalImageReady: true }

  it('hands over the live canvas itself when nothing covers it', () => {
    const { drawn } = recordDrawing()
    const capture = vi.fn()
    const live = workspaceCanvas(720, 820)

    captureVisiblePart(capture)(live, info)

    expect(capture).toHaveBeenCalledWith(live, info)
    expect(drawn).toEqual([])
  })

  it('hands over a copy of the visible part when the deck covers some', () => {
    const { drawn, context } = recordDrawing()
    const capture = vi.fn()
    const live = workspaceCanvas(1100, 820, COVERED)

    captureVisiblePart(capture)(live, info)

    expect(capture).toHaveBeenCalledTimes(1)
    const [handed, handedInfo] = capture.mock.calls[0] as [
      HTMLCanvasElement,
      ExportImageInfo,
    ]
    expect(handed).not.toBe(live)
    expect([handed.width, handed.height]).toEqual([720, 820])
    expect(handedInfo).toBe(info)
    // The left 720 columns, the part on show, copied pixel for pixel.
    expect(drawn).toEqual([[live, 0, 0, 720, 820, 0, 0, 720, 820]])
    expect(context.globalCompositeOperation).toBe('copy')
  })

  it('reuses one copy from frame to frame', () => {
    recordDrawing()
    const handed: HTMLCanvasElement[] = []
    const cut = captureVisiblePart((canvas) => handed.push(canvas))
    const live = workspaceCanvas(1100, 820, COVERED)

    cut(live)
    cut(live)

    expect(handed).toHaveLength(2)
    expect(handed[1]).toBe(handed[0])
  })

  it('follows the canvas when the deck opens, resizes and closes', () => {
    const { drawn } = recordDrawing()
    const handed: HTMLCanvasElement[] = []
    const cut = captureVisiblePart((canvas) => handed.push(canvas))
    const live = workspaceCanvas(1100, 820)

    cut(live)
    live.dataset.coveredRight = String(480 / 1100)
    cut(live)
    delete live.dataset.coveredRight
    cut(live)

    expect(handed[0]).toBe(live)
    expect([handed[1]!.width, handed[1]!.height]).toEqual([620, 820])
    expect(handed[2]).toBe(live)
    expect(drawn).toHaveLength(1)
  })

  it('skips a frame it cannot cut rather than hand over the whole canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const capture = vi.fn()

    captureVisiblePart(capture)(workspaceCanvas(1100, 820, COVERED), info)

    expect(capture).not.toHaveBeenCalled()
  })
})

/** Lays `element` out at a box the test DOM cannot compute. */
function place(element: Element, left: number, width: number, height = 820) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    top: 0,
    right: left + width,
    bottom: height,
    width,
    height,
    x: left,
    y: 0,
    toJSON: () => ({}),
  })
}

describe('visibleClientRect', () => {
  // The tour and the replay spotlight light up the canvas by this box.
  it('cuts the canvas at the part the deck covers', () => {
    const canvas = workspaceCanvas(1100, 820, COVERED)
    place(canvas, 80, 1100)

    expect(visibleClientRect(canvas)).toMatchObject({
      left: 80,
      right: 800,
      width: 720,
      top: 0,
      height: 820,
    })
  })

  it('cuts a box that holds the canvas at the same place', () => {
    const container = document.createElement('div')
    const canvas = workspaceCanvas(1100, 820, COVERED)
    container.append(canvas)
    place(container, 80, 1100)
    place(canvas, 80, 1100)

    expect(visibleClientRect(container)).toMatchObject({
      left: 80,
      right: 800,
      width: 720,
    })
  })

  it('is the whole box when nothing covers the canvas', () => {
    const canvas = workspaceCanvas(1100, 820)
    place(canvas, 80, 1100)

    expect(visibleClientRect(canvas)).toMatchObject({ left: 80, right: 1180 })
  })

  it('is the whole box of anything that is not the canvas', () => {
    const button = document.createElement('button')
    place(button, 900, 44, 44)

    expect(visibleClientRect(button)).toMatchObject({
      left: 900,
      right: 944,
      width: 44,
      height: 44,
    })
  })
})
