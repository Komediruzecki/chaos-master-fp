/**
 * The panel's number fields scrub when dragged sideways: c by a thousandth
 * per pixel, the iteration limit doubling every 100 px. A field keeps its
 * typed-entry behaviour too.
 */
import { DEFAULT_LOCATION } from '@chaos-master/core'
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExplorerControls } from './ExplorerControls'
import type { ExplorerControlsProps } from './ExplorerControls'
import type { Palette } from '@/flame/colorMap'

// The palette picker loads palette files; it is not what these tests are about.
vi.mock('@/components/PaletteSelector/PaletteSelector', () => ({
  PaletteSelector: () => null,
}))

afterEach(() => {
  cleanup()
})

function renderControls(overrides: Partial<ExplorerControlsProps> = {}) {
  const props: ExplorerControlsProps = {
    location: { ...DEFAULT_LOCATION, kind: 'julia' },
    mode: 'julia',
    status: undefined,
    palette: {
      id: 'plasma',
      name: 'Plasma',
      entries: [],
    } as unknown as Palette,
    period: 64,
    phase: 0,
    relief: 0.5,
    quality: 'balanced',
    onMode: vi.fn(),
    onJuliaC: vi.fn(),
    onJuliaHere: vi.fn(),
    onIterations: vi.fn(),
    onPalette: vi.fn(),
    onPeriod: vi.fn(),
    onPhase: vi.fn(),
    onRelief: vi.fn(),
    onQuality: vi.fn(),
    onHome: vi.fn(),
    onCopyLink: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  }
  render(() => <ExplorerControls {...props} />)
  return props
}

function dragSideways(field: HTMLElement, dx: number, shiftKey = false) {
  const init = { pointerId: 5, pointerType: 'mouse', button: 0, bubbles: true }
  field.dispatchEvent(
    new PointerEvent('pointerdown', { ...init, clientX: 200 }),
  )
  document.dispatchEvent(
    new PointerEvent('pointermove', { ...init, clientX: 200 + dx, shiftKey }),
  )
  document.dispatchEvent(
    new PointerEvent('pointerup', { ...init, clientX: 200 + dx }),
  )
}

describe('ExplorerControls number fields', () => {
  it('scrubs c by a thousandth per pixel', () => {
    const props = renderControls()
    dragSideways(screen.getByLabelText('c, real'), 20)
    expect(props.onJuliaC).toHaveBeenLastCalledWith({
      re: '-0.78',
      im: DEFAULT_LOCATION.juliaC.im,
    })
    dragSideways(screen.getByLabelText('c, imaginary'), -10, true)
    expect(props.onJuliaC).toHaveBeenLastCalledWith({
      re: DEFAULT_LOCATION.juliaC.re,
      im: '0.155',
    })
  })

  it('doubles the iteration limit every 100 px', () => {
    const props = renderControls()
    dragSideways(screen.getByLabelText('Iteration limit'), 100)
    expect(props.onIterations).toHaveBeenLastCalledWith(2000)
    dragSideways(screen.getByLabelText('Iteration limit'), -100)
    expect(props.onIterations).toHaveBeenLastCalledWith(500)
  })

  it('still commits a typed c, and ignores one that does not parse', () => {
    const props = renderControls()
    const field = screen.getByLabelText('c, real')
    fireEvent.input(field, { target: { value: '0.285' } })
    fireEvent.change(field)
    expect(props.onJuliaC).toHaveBeenLastCalledWith({
      re: '0.285',
      im: DEFAULT_LOCATION.juliaC.im,
    })
    fireEvent.input(field, { target: { value: '0.2.8' } })
    fireEvent.change(field)
    expect(props.onJuliaC).toHaveBeenCalledOnce()
  })

  it('puts back an iteration limit that is emptied, as it does one that does not parse', () => {
    const props = renderControls()
    const field = screen.getByLabelText<HTMLInputElement>('Iteration limit')
    for (const text of ['', '   ', 'abc']) {
      field.value = text
      fireEvent.change(field)
      expect(field.value).toBe('1000')
    }
    expect(props.onIterations).not.toHaveBeenCalled()
  })
})
