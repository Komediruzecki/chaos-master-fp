/**
 * Exercise local orbit input and GPU scheduling without emulating a GPU.
 * Camera and renderer boundaries are spied; selection, DOM listeners and
 * the real ComputeGate still run through Solid's mount/disposal lifecycle.
 */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera3D } from '@/lib/Camera3D'
import { FlameOrb } from './FlameOrb'
import { getOrbPreset } from './orbPresets'
import type { ComponentProps, ParentProps } from 'solid-js'

vi.mock('@/lib/Root', () => ({
  Root: (props: ParentProps) => props.children,
}))
vi.mock('@/lib/Camera3D', () => ({
  Camera3D: vi.fn((props: ComponentProps<typeof Camera3D>) => props.children),
}))
vi.mock('@/flame/Flam3', () => ({ Flam3: vi.fn(() => null) }))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas: vi.fn((props: ComponentProps<typeof AutoCanvas>) => (
    <>
      <canvas ref={props.ref} aria-label={props.ariaLabel} />
      {props.children}
    </>
  )),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const camera = () => vi.mocked(Camera3D).mock.lastCall![0]
const renderer = () => vi.mocked(Flam3).mock.lastCall![0]
const surface = () => document.querySelector('canvas')!
const distance = () => Math.hypot(...camera().position)

function key(target: EventTarget, value: string) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

function scroll(value: number) {
  const event = new WheelEvent('wheel', { deltaY: value, cancelable: true })
  surface().dispatchEvent(event)
  return event
}

describe('observatory live flame', () => {
  it('orbits only from its own canvas and resets without mutating the preset', () => {
    const preset = getOrbPreset('verdant')
    const saved = JSON.stringify(preset.flame)
    const [reset, setReset] = createSignal(0)
    render(() => <FlameOrb preset={preset} resetKey={reset()} />)
    const initial = [...camera().position]

    expect(key(document.body, 'ArrowLeft').defaultPrevented).toBe(false)
    expect([...camera().position]).toEqual(initial)
    expect(key(surface(), 'ArrowLeft').defaultPrevented).toBe(true)
    expect([...camera().position]).not.toEqual(initial)
    const radius = distance()
    key(surface(), '+')
    expect(distance()).toBeLessThan(radius)

    setReset(1)
    expect([...camera().position]).toEqual(initial)
    expect(JSON.stringify(preset.flame)).toBe(saved)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('bounds wheel zoom, and pauses sampling plus input without losing the view', () => {
    const [paused, setPaused] = createSignal(false)
    render(() => <FlameOrb preset={getOrbPreset('sol')} paused={paused()} />)
    expect(renderer().renderInterval).toBe(0)
    expect(scroll(-1_000_000).defaultPrevented).toBe(true)
    expect(distance()).toBeCloseTo(1.5)
    scroll(1_000_000)
    expect(distance()).toBeCloseTo(6.5)
    const position = [...camera().position]

    setPaused(true)
    expect(renderer().renderInterval).toBe(Infinity)
    expect(scroll(-200).defaultPrevented).toBe(false)
    expect(key(surface(), 'ArrowLeft').defaultPrevented).toBe(false)
    expect([...camera().position]).toEqual(position)
    setPaused(false)
    expect(renderer().renderInterval).toBe(0)
  })

  it('releases sampling when hidden and reacquires it when visible', () => {
    render(() => <FlameOrb preset={getOrbPreset('tide')} />)
    const visibility = vi.spyOn(document, 'hidden', 'get')
    visibility.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(renderer().renderInterval).toBe(Infinity)
    visibility.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(renderer().renderInterval).toBe(0)

    vi.mocked(AutoCanvas).mock.lastCall![0].onVisibilityChange?.(false)
    expect(renderer().renderInterval).toBe(Infinity)
  })

  it('applies zoom button commands to the current view without replaying them on selection', () => {
    const [zoomStep, setZoomStep] = createSignal(0)
    const [preset, setPreset] = createSignal(getOrbPreset('sol'))
    const [paused, setPaused] = createSignal(false)
    render(() => (
      <FlameOrb preset={preset()} zoomStep={zoomStep()} paused={paused()} />
    ))
    scroll(-100)
    const afterWheel = distance()
    setZoomStep(1)
    expect(distance()).toBeCloseTo(afterWheel * Math.exp(-0.12))
    setPaused(true)
    const held = distance()
    setZoomStep(2)
    expect(distance()).toBe(held)
    setPaused(false)
    expect(distance()).toBe(held)
    setPreset(getOrbPreset('tide'))
    expect(distance()).toBeCloseTo(
      preset().flame.renderSettings.camera3D.radius,
    )
    setZoomStep(1)
    expect(distance()).toBeCloseTo(
      preset().flame.renderSettings.camera3D.radius * Math.exp(0.12),
    )
  })

  it('reports a detailed first frame once and ignores work from a replaced world', () => {
    const [preset, setPreset] = createSignal(getOrbPreset('verdant'))
    const onReady = vi.fn()
    render(() => <FlameOrb preset={preset()} onReady={onReady} />)
    const previous = renderer().onCompletedPointCount!
    previous({ count: 2_000_000, completedAtMs: 10 })
    expect(onReady).not.toHaveBeenCalled()
    setPreset(getOrbPreset('ember'))
    previous({ count: 16_000_000, completedAtMs: 20 })
    expect(onReady).not.toHaveBeenCalled()
    renderer().onCompletedPointCount?.({ count: 8_000_000, completedAtMs: 30 })
    renderer().onCompletedPointCount?.({ count: 16_000_000, completedAtMs: 40 })
    expect(onReady).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(renderer().flameDescriptor).toBe(preset().flame)
  })
})
