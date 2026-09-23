/**
 * The explorer page with its GPU parts stood in for: the renderers and the
 * Julia point become stubs that record what the page hands them, so the page's
 * own state can be driven and read without a device.
 */
import { DEFAULT_LOCATION, formatExplorerHash } from '@chaos-master/core'
import { cleanup, render } from '@solidjs/testing-library'
import { createEffect } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCustomPalette, paletteEntry } from '@/flame/colorMap'
import { resolvePalette } from './explorerPalette'
import { FractalExplorerPage } from './FractalExplorerPage'
import type { ExplorerLocation } from '@chaos-master/core'
import type { ParentProps } from 'solid-js'
import type * as PaletteModule from './explorerPalette'
import type { ExplorerRendererProps } from './ExplorerRenderer'
import type * as JuliaMarkerModule from './JuliaMarker'
import type { JuliaMarkerProps } from './JuliaMarker'

const stubs = vi.hoisted(() => ({
  renderers: [] as ExplorerRendererProps[],
  markers: [] as JuliaMarkerProps[],
  /** Runs of the stand-in for each renderer's palette upload. */
  paletteUploads: 0,
}))

vi.mock('./ExplorerRenderer', () => ({
  ExplorerRenderer: (props: ExplorerRendererProps) => {
    stubs.renderers.push(props)
    // The real renderer uploads the palette and marks the colours changed
    // whenever this re-runs, which drops a finished picture's supersamples.
    createEffect(() => {
      props.palette()
      stubs.paletteUploads += 1
    })
    return null
  },
}))

vi.mock('./JuliaMarker', async (importOriginal) => ({
  ...(await importOriginal<typeof JuliaMarkerModule>()),
  JuliaMarker: (props: JuliaMarkerProps) => {
    stubs.markers.push(props)
    return null
  },
}))

vi.mock('./explorerPalette', async (importOriginal) => {
  const actual = await importOriginal<typeof PaletteModule>()
  return { ...actual, resolvePalette: vi.fn(actual.resolvePalette) }
})

vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas: (props: ParentProps) => <div>{props.children}</div>,
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

// The palette picker loads palette files; it is not what these tests are about.
vi.mock('@/components/PaletteSelector/PaletteSelector', () => ({
  PaletteSelector: () => null,
}))

// The test runner's own localStorage is not a working Storage.
const stored = new Map<string, string>()
const memoryStorage: Storage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value)
  },
  removeItem: (key) => {
    stored.delete(key)
  },
  clear: () => {
    stored.clear()
  },
  key: (index) => [...stored.keys()][index] ?? null,
  get length() {
    return stored.size
  },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage)
  stubs.renderers.length = 0
  stubs.markers.length = 0
  stubs.paletteUploads = 0
  vi.mocked(resolvePalette).mockClear()
})

afterEach(() => {
  cleanup()
  stored.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

/** The page, opened at a link to `location`. */
function open(location: ExplorerLocation) {
  window.history.replaceState(
    null,
    '',
    `/explore${formatExplorerHash(location)}`,
  )
  render(() => <FractalExplorerPage />)
}

describe('FractalExplorerPage palette', () => {
  function saveCustom() {
    return addCustomPalette({
      name: 'Mine',
      entries: [paletteEntry(0, 0.1, 0.1), paletteEntry(1, -0.1, 0)],
      source: 'custom',
    })
  }

  /** The split view's two renderers and its point. */
  function splitStubs() {
    const [mandelbrot, julia] = stubs.renderers
    const marker = stubs.markers[0]
    if (!mandelbrot || !julia || !marker) throw new Error('split not shown')
    return { mandelbrot, julia, marker }
  }

  it('keeps a linked custom palette as one object while c moves and the panes pan', () => {
    const saved = saveCustom()
    open({ ...DEFAULT_LOCATION, split: true, paletteId: saved.id })
    const { mandelbrot, julia, marker } = splitStubs()
    const first = mandelbrot.palette()
    expect(first.id).toBe(saved.id)
    const uploads = stubs.paletteUploads

    for (let i = 1; i <= 10; i += 1) {
      marker.setPoint({ re: String(-0.8 + i / 1000), im: '0.156' })
    }
    mandelbrot.setView({ ...DEFAULT_LOCATION.view, zoomLog2: 3 })
    julia.setView({ ...DEFAULT_LOCATION.juliaView, zoomLog2: 3 })

    expect(mandelbrot.palette()).toBe(first)
    expect(julia.palette()).toBe(first)
    expect(stubs.paletteUploads).toBe(uploads)
    expect(resolvePalette).toHaveBeenCalledOnce()
  })

  it('still follows a link to another palette', () => {
    const saved = saveCustom()
    open({ ...DEFAULT_LOCATION, split: true, paletteId: saved.id })
    const { mandelbrot, julia } = splitStubs()

    const linked = { ...DEFAULT_LOCATION, split: true, paletteId: 'grayscale' }
    window.history.replaceState(
      null,
      '',
      `/explore${formatExplorerHash(linked)}`,
    )
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(mandelbrot.palette().id).toBe('grayscale')
    expect(julia.palette().id).toBe('grayscale')
  })
})
