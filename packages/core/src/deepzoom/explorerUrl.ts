/**
 * The explorer's location in the URL fragment, so a view can be bookmarked,
 * shared and reloaded exactly. A fragment never reaches the server, which
 * matters here: a centre at 1e300 is a kilobyte of digits.
 *
 *   #mandelbrot?re=-0.75&im=0&z=0.4&it=1000&p=<palette id>
 *   #julia?re=0&im=0&z=0&cre=-0.8&cim=0.156&it=1000
 *
 * Parsing is forgiving: anything missing or malformed falls back to the
 * default for that field instead of rejecting the whole link.
 */
import { parseFixed } from './bigFixed'
import { clampZoomLog2, JULIA_HOME, MANDELBROT_HOME } from './deepZoomView'
import type { DeepZoomView } from './deepZoomView'
import type { FractalKind } from './referenceOrbit'

export interface ComplexString {
  readonly re: string
  readonly im: string
}

export interface ExplorerLocation {
  readonly kind: FractalKind
  readonly view: DeepZoomView
  /** The Julia constant. Kept for the Mandelbrot set too, to switch back to. */
  readonly juliaC: ComplexString
  readonly maxIterations: number
  readonly paletteId: string | undefined
}

export const DEFAULT_JULIA_C: ComplexString = { re: '-0.8', im: '0.156' }
export const DEFAULT_MAX_ITERATIONS = 1000
export const MIN_ITERATIONS = 16
/**
 * A reference orbit costs 16 B per iteration on the GPU and a Julia view
 * holds two, so 4M keeps both inside the common 128 MiB binding limit; the
 * renderer lowers it further on a device with less.
 */
export const MAX_ITERATIONS = 4_000_000

/** A centre at 1e1000 needs about 1 010 digits. */
const MAX_DECIMAL_LENGTH = 1200
/**
 * Both sets lie inside |z| <= 2, but a pan can wander out past the bailout
 * radius (256) and its link should still reopen it; four whole digits cost
 * nothing, a million cost every pan.
 */
const MAX_DECIMAL_MAGNITUDE = 1024

export function clampIterations(n: number): number {
  return Math.round(Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n)))
}

export function homeView(kind: FractalKind): DeepZoomView {
  return kind === 'julia' ? JULIA_HOME : MANDELBROT_HOME
}

export const DEFAULT_LOCATION: ExplorerLocation = {
  kind: 'mandelbrot',
  view: MANDELBROT_HOME,
  juliaC: DEFAULT_JULIA_C,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  paletteId: undefined,
}

/**
 * A coordinate a person could have typed, or undefined: a decimal the
 * explorer can parse, no longer than the deepest view needs and no further
 * out than 1024, so a hostile link cannot make every pan cost a million-digit
 * multiplication. A leading '+' is dropped.
 */
export function explorerDecimal(
  text: string | null | undefined,
): string | undefined {
  if (text === null || text === undefined || text.length > MAX_DECIMAL_LENGTH) {
    return undefined
  }
  const trimmed = text.trim()
  if (!(Math.abs(Number(trimmed)) <= MAX_DECIMAL_MAGNITUDE)) return undefined
  if (parseFixed(trimmed, 8) === undefined) return undefined
  return trimmed.startsWith('+') ? trimmed.slice(1) : trimmed
}

function finite(text: string | null): number | undefined {
  if (text === null || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

export function parseExplorerHash(hash: string): ExplorerLocation {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const q = body.indexOf('?')
  const head = q < 0 ? body : body.slice(0, q)
  const params = new URLSearchParams(q < 0 ? '' : body.slice(q + 1))
  const kind: FractalKind = head === 'julia' ? 'julia' : 'mandelbrot'
  const home = homeView(kind)
  const zoom = finite(params.get('z'))
  const iterations = finite(params.get('it'))
  const palette = params.get('p')
  return {
    kind,
    view: {
      centerRe: explorerDecimal(params.get('re')) ?? home.centerRe,
      centerIm: explorerDecimal(params.get('im')) ?? home.centerIm,
      zoomLog2: zoom === undefined ? home.zoomLog2 : clampZoomLog2(zoom),
    },
    juliaC: {
      re: explorerDecimal(params.get('cre')) ?? DEFAULT_JULIA_C.re,
      im: explorerDecimal(params.get('cim')) ?? DEFAULT_JULIA_C.im,
    },
    maxIterations:
      iterations === undefined
        ? DEFAULT_MAX_ITERATIONS
        : clampIterations(iterations),
    paletteId:
      palette !== null && /^[\w-]{1,64}$/.test(palette) ? palette : undefined,
  }
}

export function formatExplorerHash(location: ExplorerLocation): string {
  const params = new URLSearchParams()
  params.set('re', location.view.centerRe)
  params.set('im', location.view.centerIm)
  // Four decimals of an octave: finer than a wheel notch, short in a link.
  params.set('z', String(Math.round(location.view.zoomLog2 * 1e4) / 1e4))
  if (location.kind === 'julia') {
    params.set('cre', location.juliaC.re)
    params.set('cim', location.juliaC.im)
  }
  params.set('it', String(location.maxIterations))
  if (location.paletteId !== undefined) params.set('p', location.paletteId)
  return `#${location.kind}?${params.toString()}`
}
