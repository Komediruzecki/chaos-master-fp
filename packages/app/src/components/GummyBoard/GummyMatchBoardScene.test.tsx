/** Execute real canvas camera gestures across capture locks without recreating the board or its orbit. */
import { createChessGame } from '@chaos-master/core/chess/chessGame'
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '@/pages/GummyBear/gummyBuiltinPresets'
import { createGummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import { initialGummyBoardOrbit } from './gummyBoardCamera'
import { createGummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import { GummyMatchBoardScene } from './GummyMatchBoardScene'
import type { ParentProps } from 'solid-js'
import type { GummyOrbit } from '@/components/GummyBear/gummyStudyMath'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

const fixture = vi.hoisted(() => ({
  unconfigure: vi.fn(),
  canvas: undefined as HTMLCanvasElement | undefined,
  device: undefined as EventTarget | undefined,
  renderers: [] as {
    render: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }[],
}))

vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps) {
    const [mounted, setMounted] = createSignal(false)
    return (
      <>
        <canvas
          ref={(canvas) => {
            fixture.canvas = canvas
            const captured = new Set<number>()
            canvas.hasPointerCapture = (id) => captured.has(id)
            canvas.setPointerCapture = (id) => {
              captured.add(id)
            }
            canvas.releasePointerCapture = (id) => {
              captured.delete(id)
            }
            canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
            setMounted(true)
          }}
        />
        <Show when={mounted()}>{props.children}</Show>
      </>
    )
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: fixture.canvas,
    context: { unconfigure: fixture.unconfigure },
    canvasFormat: 'bgra8unorm',
    canvasSize: () => ({ width: 800, height: 600 }),
  }),
}))
vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({
    root: {},
    device: Object.assign(fixture.device!, {
      queue: { onSubmittedWorkDone: () => Promise.resolve() },
    }),
  }),
}))
vi.mock('./gummyBoardRenderer', () => ({
  createGummyBoardRenderer() {
    const renderer = { render: vi.fn(), destroy: vi.fn() }
    fixture.renderers.push(renderer)
    return Promise.resolve(renderer)
  },
}))

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0

async function frame() {
  await Promise.resolve()
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(1000)
  await Promise.resolve()
}

function mount() {
  const orbit: GummyOrbit = {
    ...initialGummyBoardOrbit('board'),
    pan: [0.3, 0.1, -0.4],
  }
  const [locked, setLocked] = createSignal(false)
  const [quality, setQuality] = createSignal<'high' | 'tablet'>('high')
  const [authoredPawn, setAuthoredPawn] = createSignal<GummyAuthoredPawn>()
  const ready = vi.fn()
  const restMeshPool = createGummyBoardRestMeshPool()
  const view = render(() => (
    <GummyMatchBoardScene
      position={createChessGame().position}
      orbit={orbit}
      locked={locked()}
      restMeshPool={restMeshPool}
      legalSquares={[]}
      settings={GUMMY_BUILTIN_PRESETS[0]!.preset.settings}
      quality={quality()}
      authoredPawn={authoredPawn()}
      scale={0.9}
      theme="glass"
      onSquare={() => {}}
      onComplete={() => {}}
      onError={() => {}}
      onReady={ready}
    />
  ))
  return { view, orbit, setLocked, setQuality, setAuthoredPawn, ready }
}

function wheel(deltaY: number) {
  const event = new WheelEvent('wheel', { deltaY, cancelable: true })
  fixture.canvas!.dispatchEvent(event)
  return event
}

function pointer(type: string, id: number, x: number) {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, {
    button: 0,
    pointerId: id,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: 100,
  })
  fixture.canvas!.dispatchEvent(event)
}

beforeEach(() => {
  fixture.unconfigure.mockClear()
  fixture.device = new EventTarget()
  fixture.renderers = []
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('persistent match board camera input', () => {
  it('replaces shape resources only when geometry changes while preserving the configured canvas and camera', async () => {
    const app = mount()
    await frame()
    const canvas = fixture.canvas
    wheel(-50)
    const zoom = app.orbit.zoom
    const pawn = createGummyAuthoredPawn({ openness: 0.4 })
    app.setAuthoredPawn(pawn)
    await frame()
    expect(fixture.renderers).toHaveLength(2)
    expect(fixture.renderers[0]!.destroy).toHaveBeenCalledOnce()
    app.setAuthoredPawn({ ...pawn, name: 'Renamed pawn' })
    await frame()
    expect(fixture.renderers).toHaveLength(2)
    app.setAuthoredPawn(createGummyAuthoredPawn({ openness: 0.7 }))
    await frame()
    expect(fixture.renderers).toHaveLength(3)
    expect(fixture.renderers[1]!.destroy).toHaveBeenCalledOnce()
    app.setAuthoredPawn(undefined)
    await frame()
    expect(fixture.renderers).toHaveLength(4)
    expect(fixture.renderers[2]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.canvas).toBe(canvas)
    expect(app.orbit.zoom).toBe(zoom)
    expect(app.orbit.pan).toEqual([0.3, 0.1, -0.4])
    expect(fixture.unconfigure).not.toHaveBeenCalled()
    app.view.unmount()
    expect(fixture.renderers[3]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('keeps presentation configured through quality changes and releases it when leaving chess', async () => {
    const app = mount()
    await frame()
    app.setQuality('tablet')
    await frame()
    expect(fixture.renderers).toHaveLength(2)
    expect(fixture.renderers[0]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).not.toHaveBeenCalled()
    app.view.unmount()
    expect(fixture.renderers[1]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('does not redraw an idle board but redraws a camera change once', async () => {
    mount()
    await frame()
    const renderer = fixture.renderers[0]!
    expect(renderer.render).toHaveBeenCalledOnce()
    for (let i = 0; i < 10; i++) await frame()
    expect(renderer.render).toHaveBeenCalledOnce()
    wheel(-50)
    await frame()
    expect(renderer.render).toHaveBeenCalledTimes(2)
    await frame()
    expect(renderer.render).toHaveBeenCalledTimes(2)
  })

  it('blocks wheel changes during a capture, then resumes zoom on the same panned board', async () => {
    const app = mount()
    await frame()
    expect(app.ready).toHaveBeenLastCalledWith(true)
    const canvas = fixture.canvas!
    expect(wheel(-50).defaultPrevented).toBe(true)
    expect(app.orbit.zoom).toBeCloseTo(0.9277434863285529, 12)
    app.setLocked(true)
    expect(wheel(100).defaultPrevented).toBe(true)
    expect(app.orbit.zoom).toBeCloseTo(0.9277434863285529, 12)
    expect(app.orbit.pan).toEqual([0.3, 0.1, -0.4])
    app.setLocked(false)
    wheel(50)
    expect(app.orbit.zoom).toBeCloseTo(1, 12)
    expect(app.orbit.pan).toEqual([0.3, 0.1, -0.4])
    expect(fixture.canvas).toBe(canvas)
    expect(fixture.renderers).toHaveLength(1)
    expect(fixture.renderers[0]!.destroy).not.toHaveBeenCalled()
    app.view.unmount()
    wheel(-100)
    expect(app.orbit.zoom).toBeCloseTo(1, 12)
  })

  it('cancels an existing orbit drag when locked and requires a fresh press after capture', async () => {
    const app = mount()
    await frame()
    pointer('pointerdown', 1, 100)
    pointer('pointermove', 1, 120)
    expect(app.orbit.theta).toBeCloseTo(0.28, 12)
    expect(fixture.canvas!.hasPointerCapture(1)).toBe(true)
    app.setLocked(true)
    expect(fixture.canvas!.hasPointerCapture(1)).toBe(false)
    pointer('pointermove', 1, 150)
    pointer('pointerdown', 3, 100)
    pointer('pointermove', 3, 150)
    expect(fixture.canvas!.hasPointerCapture(3)).toBe(false)
    expect(app.orbit.theta).toBeCloseTo(0.28, 12)
    app.setLocked(false)
    pointer('pointermove', 1, 180)
    expect(app.orbit.theta).toBeCloseTo(0.28, 12)
    pointer('pointerdown', 2, 100)
    pointer('pointermove', 2, 130)
    expect(app.orbit.theta).toBeCloseTo(0.13, 12)
    expect(app.orbit.pan).toEqual([0.3, 0.1, -0.4])
  })
})
