import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCATION, explorerDecimal, formatExplorerHash, MAX_ITERATIONS, parseExplorerHash, } from './explorerUrl'
import type { ExplorerLocation } from './explorerUrl'

describe('explorer URL fragment', () => {
  it('round-trips a deep Julia view without losing a digit', () => {
    const location: ExplorerLocation = {
      kind: 'julia',
      view: {
        centerRe: '0.2196416944187448706662261496016936214292141340785582171',
        centerIm: '-0.2795302387171297876743245096395124912436791094449249151',
        zoomLog2: 166.25,
      },
      juliaC: { re: '-0.12256116687665', im: '0.74486176661974' },
      maxIterations: 5000,
      paletteId: 'fire-2',
    }
    expect(parseExplorerHash(formatExplorerHash(location))).toEqual(location)
  })

  it('leaves the Julia constant out of a Mandelbrot link', () => {
    const hash = formatExplorerHash(DEFAULT_LOCATION)
    expect(hash).toMatch(/^#mandelbrot\?/)
    expect(hash).not.toContain('cre=')
  })

  it('falls back field by field on malformed input', () => {
    const parsed = parseExplorerHash(
      '#julia?re=abc&im=1e-3&z=Infinity&it=-5&p=<script>',
    )
    expect(parsed.kind).toBe('julia')
    expect(parsed.view.centerRe).toBe('0')
    expect(parsed.view.centerIm).toBe('1e-3')
    expect(parsed.view.zoomLog2).toBe(0)
    expect(parsed.maxIterations).toBe(16)
    expect(parsed.paletteId).toBeUndefined()
  })

  it('clamps iterations and treats an empty fragment as the default', () => {
    expect(parseExplorerHash('#mandelbrot?it=1e12').maxIterations).toBe(
      MAX_ITERATIONS,
    )
    expect(parseExplorerHash('')).toEqual(DEFAULT_LOCATION)
  })

  it('refuses coordinates a hostile link could use to stall every pan', () => {
    // A million-digit whole part, or 1e100000, parses, but every pan then
    // multiplies it out: the tab slows to a crawl without ever failing.
    const loc = parseExplorerHash(
      `#mandelbrot?re=${'9'.repeat(1_000_000)}&im=1e100000`,
    )
    expect(loc.view.centerRe).toBe(DEFAULT_LOCATION.view.centerRe)
    expect(loc.view.centerIm).toBe(DEFAULT_LOCATION.view.centerIm)
    expect(explorerDecimal('1024.5')).toBeUndefined()
    expect(explorerDecimal('1000')).toBe('1000')
    expect(explorerDecimal('-2.25')).toBe('-2.25')
    expect(explorerDecimal('+0.5')).toBe('0.5')
    // The deepest view's centre still fits.
    expect(explorerDecimal(`0.${'3'.repeat(1100)}`)).toBeDefined()
  })
})
