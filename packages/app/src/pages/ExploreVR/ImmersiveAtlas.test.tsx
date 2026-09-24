/** Demand-rendered scene lifecycle: pause, reduced motion, disposal and stale GPU work. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlameOrb } from './FlameOrb'
import { ImmersiveAtlas } from './ImmersiveAtlas'
import { getOrbPreset } from './orbPresets'

vi.mock('./FlameOrb', () => ({
  FlameOrb: vi.fn(() => <canvas data-live-orb />),
}))

let nextFrame = 0
let frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] })
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1600,
    height: 1000,
    top: 0,
    left: 0,
    right: 1600,
    bottom: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function mount() {
  const [preset, setPreset] = createSignal(getOrbPreset('verdant'))
  const [paused, setPaused] = createSignal(false)
  const [reduced, setReduced] = createSignal(false)
  const [reset, setReset] = createSignal(0)
  const [ready, setReady] = createSignal(false)
  const onReady = vi.fn()
  const onError = vi.fn()
  const onTravel = vi.fn()
  const result = render(() => (
    <ImmersiveAtlas
      preset={preset()}
      posters={{}}
      paused={paused()}
      reducedMotion={reduced()}
      isolated={false}
      resetKey={reset()}
      zoomStep={0}
      ready={ready()}
      onSelect={setPreset}
      onReady={onReady}
      onError={onError}
      onTravelChange={onTravel}
    />
  ))
  const step = (milliseconds: number) => {
    vi.advanceTimersByTime(milliseconds)
    const pending = [...frames.entries()]
    frames.clear()
    for (const [, callback] of pending) callback(window.performance.now())
  }
  const position = () =>
    result.container.querySelector<HTMLElement>('[role="group"]')!.style
      .transform
  return {
    ...result,
    setPreset,
    setPaused,
    setReduced,
    setReset,
    setReady,
    onReady,
    onError,
    onTravel,
    step,
    position,
  }
}

function expectSettled(position: string) {
  const coordinates = position.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)
  expect(Number(coordinates?.[1])).toBeCloseTo(928)
  expect(Number(coordinates?.[2])).toBeCloseTo(450)
}

describe('immersive atlas scheduling', () => {
  it('is idle at rest, freezes a flight while paused, and resumes only its remaining time', () => {
    const scene = mount()
    expect(frames.size).toBe(0)
    scene.setPreset(getOrbPreset('sol'))
    expect(frames.size).toBe(1)
    scene.step(400)
    const held = scene.position()
    scene.setPaused(true)
    expect(frames.size).toBe(0)
    scene.step(5000)
    expect(scene.position()).toBe(held)
    scene.setPaused(false)
    scene.step(400)
    expect(scene.position()).not.toBe(held)
    expect(frames.size).toBe(1)
    scene.step(800)
    expect(frames.size).toBe(0)
    expect(scene.onTravel).toHaveBeenLastCalledWith(false)
  })

  it('snaps paused/reduced-motion selections without requesting animation frames', () => {
    const scene = mount()
    scene.setPaused(true)
    scene.setPreset(getOrbPreset('tide'))
    expect(frames.size).toBe(0)
    expectSettled(scene.position())
    expect(scene.container.querySelectorAll('[data-live-orb]')).toHaveLength(0)
    scene.setPaused(false)
    expect(scene.container.querySelectorAll('[data-live-orb]')).toHaveLength(1)
    scene.setReduced(true)
    scene.setPreset(getOrbPreset('ember'))
    expect(frames.size).toBe(0)
    expectSettled(scene.position())
  })

  it('resets an interrupted camera flight to its destination without another animation', () => {
    const scene = mount()
    scene.setPreset(getOrbPreset('irchiinnuss'))
    scene.step(400)
    expect(frames.size).toBe(1)
    scene.setReset(1)
    expect(frames.size).toBe(0)
    expectSettled(scene.position())
  })

  it.each([false, true])(
    'preserves ready renderer ownership across reset/resize when paused=%s',
    (paused) => {
      const scene = mount()
      const poster = () =>
        scene.container.querySelector<HTMLImageElement>('[role="group"] img')!
      const liveCanvas = scene.container.querySelector('[data-live-orb]')
      const initialMounts = vi.mocked(FlameOrb).mock.calls.length
      vi.mocked(FlameOrb).mock.lastCall![0].onReady?.()
      scene.setReady(true)
      expect(poster().style.visibility).toBe('hidden')
      scene.setPaused(paused)
      scene.setReset(1)
      expect(scene.container.querySelector('[data-live-orb]')).toBe(liveCanvas)
      expect(poster().style.visibility).toBe('hidden')
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 1500,
        height: 1000,
        top: 0,
        left: 0,
        right: 1500,
        bottom: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      window.dispatchEvent(new Event('resize'))
      expect(scene.container.querySelectorAll('[data-live-orb]')).toHaveLength(
        1,
      )
      expect(scene.container.querySelector('[data-live-orb]')).toBe(liveCanvas)
      expect(poster().style.visibility).toBe('hidden')
      scene.setPaused(false)
      expect(FlameOrb).toHaveBeenCalledTimes(initialMounts)
      expect(poster().style.visibility).toBe('hidden')
      expect(scene.onReady).toHaveBeenCalledOnce()
    },
  )

  it('stops scheduling while hidden and cancels all frames on disposal', () => {
    const scene = mount()
    scene.setPreset(getOrbPreset('sol'))
    const hidden = vi.spyOn(document, 'hidden', 'get')
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(1)
    scene.unmount()
    expect(frames.size).toBe(0)
  })

  it('defers GPU construction until arrival and rejects callbacks from a replaced world', () => {
    const scene = mount()
    const old = vi.mocked(FlameOrb).mock.lastCall![0]
    const initialMounts = vi.mocked(FlameOrb).mock.calls.length
    scene.setPreset(getOrbPreset('sol'))
    scene.setPreset(getOrbPreset('verdant'))
    expect(scene.container.querySelectorAll('[data-live-orb]')).toHaveLength(0)
    expect(FlameOrb).toHaveBeenCalledTimes(initialMounts)
    old.onReady?.()
    old.onError?.('late GPU failure')
    expect(scene.onReady).not.toHaveBeenCalled()
    expect(scene.onError).not.toHaveBeenCalled()
    scene.step(800)
    expect(FlameOrb).toHaveBeenCalledTimes(initialMounts)
    scene.step(800)
    expect(FlameOrb).toHaveBeenCalledTimes(initialMounts + 1)
    expect(scene.container.querySelectorAll('[data-live-orb]')).toHaveLength(1)
    old.onReady?.()
    expect(scene.onReady).not.toHaveBeenCalled()
    vi.mocked(FlameOrb).mock.lastCall![0].onReady?.()
    expect(scene.onReady).toHaveBeenCalledOnce()
  })
})
