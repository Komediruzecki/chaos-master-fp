import '@/commands/builtins'
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { PEEK_HEIGHT } from './detents'
import { EditorRail } from './EditorRail'

const impactLight = vi.fn()
const impactMedium = vi.fn()
const selectionChanged = vi.fn()
vi.mock('@/lib/haptics', () => ({
  haptic: {
    impactLight: () => impactLight(),
    impactMedium: () => impactMedium(),
    selectionChanged: () => selectionChanged(),
    success: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    selectionStart: () => undefined,
    selectionEnd: () => undefined,
  },
}))

function mount(extra: Partial<Parameters<typeof EditorRail>[0]> = {}) {
  const ctx = createMockCommandContext()
  const props = {
    ctx,
    flame: ctx.flameDescriptor,
    onRandomize: vi.fn(),
    onMutate: vi.fn(),
    onQuickExport: vi.fn(),
    onOpenExportOptions: vi.fn(),
    onCoveredHeightChange: vi.fn(),
    ...extra,
  }
  const { unmount } = render(() => <EditorRail {...props} />)
  return { ...props, unmount }
}

const sheet = () => screen.getByTestId('editor-rail-sheet')

describe('EditorRail', () => {
  beforeEach(() => {
    window.innerHeight = 852
    window.dispatchEvent(new Event('resize'))
    impactLight.mockClear()
    impactMedium.mockClear()
    selectionChanged.mockClear()
  })
  afterEach(cleanup)

  it('starts at peek with four chips and the shutter', () => {
    mount()
    expect(sheet().style.height).toBe(`${PEEK_HEIGHT}px`)
    expect(
      screen.getAllByRole('tab').map((t) => t.textContent?.trim()),
    ).toEqual(['Variations', 'Shape', 'Colour', 'Vary'])
    expect(screen.getByRole('button', { name: 'Save image' })).toBeTruthy()
  })

  it('opens to medium on a chip tap and back to peek on the same chip', () => {
    const props = mount()
    const shape = screen.getByRole('tab', { name: 'Shape' })
    fireEvent.pointerDown(shape)
    fireEvent.click(shape)
    expect(sheet().style.height).toBe('375px')
    expect(shape.getAttribute('aria-selected')).toBe('true')
    expect(impactLight).toHaveBeenCalledTimes(2) // touch-down, then the latch
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(
      375 - PEEK_HEIGHT,
    )
    fireEvent.click(shape)
    expect(sheet().style.height).toBe(`${PEEK_HEIGHT}px`)
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(0)
  })

  it('switches panels without changing the detent', () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Shape' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Colour' }))
    expect(sheet().style.height).toBe('375px')
    expect(
      screen.getByRole('tab', { name: 'Colour' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('follows a drag and settles by velocity, never below peek', () => {
    mount()
    const grabber = screen.getByTestId('editor-rail-grabber')
    fireEvent.pointerDown(grabber, { clientY: 800, pointerId: 1 })
    fireEvent.pointerMove(grabber, { clientY: 700, pointerId: 1 })
    expect(sheet().style.height).toBe(`${PEEK_HEIGHT + 100}px`)
    fireEvent.pointerUp(grabber, { clientY: 700, pointerId: 1 })
    expect(['96px', '375px']).toContain(sheet().style.height)
    fireEvent.pointerDown(grabber, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(grabber, { clientY: 900, pointerId: 1 })
    fireEvent.pointerUp(grabber, { clientY: 900, pointerId: 1 })
    expect(sheet().style.height).toBe(`${PEEK_HEIGHT}px`)
  })

  it('lets the sheet go when a second finger lands', () => {
    mount()
    const grabber = screen.getByTestId('editor-rail-grabber')
    fireEvent.pointerDown(grabber, { clientY: 800, pointerId: 1 })
    fireEvent.pointerMove(grabber, { clientY: 700, pointerId: 1 })
    expect(sheet().style.height).toBe(`${PEEK_HEIGHT + 100}px`)

    // A pinch begins on the sheet. Tracking two fingers against one start
    // point walks the sheet around, so the drag ends where it stands.
    const second = new window.TouchEvent('touchstart', { bubbles: true })
    Object.defineProperty(second, 'touches', { value: [{}, {}] })
    document.dispatchEvent(second)
    const settled = sheet().style.height
    expect(settled).not.toBe(`${PEEK_HEIGHT + 100}px`)

    fireEvent.pointerMove(grabber, { clientY: 400, pointerId: 2 })
    expect(sheet().style.height).toBe(settled)
  })

  it('keeps the large detent clear of the top bar', () => {
    mount()
    // happy-dom applies no stylesheet, so the dock's padding is written here
    // as an iPhone 15 resolves it: the top bar's bottom plus the 8px gap
    // above the sheet, and the home indicator below it.
    const dock = screen.getByRole('region', { name: 'Editor controls' })
    dock.style.paddingTop = '119px'
    dock.style.paddingBottom = '42px'
    window.dispatchEvent(new Event('resize'))

    const grabber = screen.getByTestId('editor-rail-grabber')
    fireEvent.pointerDown(grabber, { clientY: 800, pointerId: 1 })
    fireEvent.pointerMove(grabber, { clientY: 0, pointerId: 1 })
    expect(sheet().style.height).toBe('691px')
    fireEvent.pointerUp(grabber, { clientY: 0, pointerId: 1 })
    expect(sheet().style.height).toBe('691px')
  })

  it('fires the shutter on tap and export options on a long press', () => {
    vi.useFakeTimers()
    const props = mount()
    const shutter = screen.getByRole('button', { name: 'Save image' })
    fireEvent.pointerDown(shutter)
    fireEvent.pointerUp(shutter)
    fireEvent.click(shutter)
    expect(props.onQuickExport).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(shutter)
    vi.advanceTimersByTime(600)
    fireEvent.pointerUp(shutter)
    fireEvent.click(shutter)
    expect(props.onOpenExportOptions).toHaveBeenCalledTimes(1)
    expect(props.onQuickExport).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('re-reports the covered height when the viewport changes', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Shape' }))
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(
      375 - PEEK_HEIGHT,
    )
    // The phone is rotated: medium is 173 now, so the canvas must pan back.
    window.innerHeight = 393
    window.dispatchEvent(new Event('resize'))
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(
      173 - PEEK_HEIGHT,
    )
  })

  it('gives the canvas back when it unmounts', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Shape' }))
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(
      375 - PEEK_HEIGHT,
    )
    props.unmount()
    expect(props.onCoveredHeightChange).toHaveBeenLastCalledWith(0)
  })

  it('reaches Mutate and Randomize through the Vary chip', () => {
    const props = mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Vary' }))
    // A real tap is a pointerdown then a click; the haptic rides the first.
    const randomize = screen.getByRole('button', { name: 'Randomize' })
    fireEvent.pointerDown(randomize)
    fireEvent.click(randomize)
    const mutate = screen.getByRole('button', { name: 'Mutate' })
    fireEvent.pointerDown(mutate)
    fireEvent.click(mutate)
    expect(props.onRandomize).toHaveBeenCalledTimes(1)
    expect(props.onMutate).toHaveBeenCalledTimes(1)
    expect(impactMedium).toHaveBeenCalledTimes(1)
  })
})
