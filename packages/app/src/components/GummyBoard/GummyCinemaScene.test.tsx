/** A capture is ready only after a sized frame reaches the GPU; cancelled shots release their canvas. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '@/pages/GummyBear/gummyBuiltinPresets'
import { createGummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import { GUMMY_BOARD_SHOTS } from './gummyBoardShots'
import { GummyCinemaScene } from './GummyCinemaScene'
import type { ParentProps } from 'solid-js'
import type { GummyCinemaController } from './GummyCinemaScene'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

const fixture = vi.hoisted(() => ({
  size: undefined as (() => { width: number; height: number }) | undefined,
  canvas: undefined as HTMLCanvasElement | undefined,
  render: vi.fn(),
  rendererDestroyed: vi.fn(),
  solverDestroyed: vi.fn(),
  unconfigure: vi.fn(),
  fence: vi.fn<() => Promise<void>>(),
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps) {
    return props.children
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: fixture.canvas,
    canvasSize: fixture.size,
    canvasFormat: 'bgra8unorm',
    context: { unconfigure: fixture.unconfigure },
  }),
}))
vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({
    root: {},
    device: { queue: { onSubmittedWorkDone: fixture.fence } },
  }),
}))
vi.mock('../GummyBear/gummyGpuErrors', () => ({
  bindGummyGpuErrors: () => () => {},
}))
vi.mock('@/simulation/gummy/gummyParticleSolver', () => ({
  createGummyParticleSolver: vi.fn(() => ({
    destroy: fixture.solverDestroyed,
    positions: {},
    restPositions: new Float32Array(),
    particleCount: 1,
    spacing: 0.08,
    gridBounds: {},
  })),
}))
vi.mock('./gummyBoardRenderer', () => ({
  createGummyBoardRenderer: vi.fn(() =>
    Promise.resolve({
      render: fixture.render,
      destroy: fixture.rendererDestroyed,
    }),
  ),
}))

async function settle() {
  // Flush the renderer setup and serialized submission/fence continuations.
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function mount(authoredPawn?: GummyAuthoredPawn) {
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  fixture.size = size
  let controller: GummyCinemaController | undefined
  const ready = vi.fn((value: boolean) => {
    if (value) controller?.play()
  })
  const progress = vi.fn(),
    error = vi.fn()
  const view = render(() => (
    <GummyCinemaScene
      shot={GUMMY_BOARD_SHOTS[0]!}
      material={GUMMY_BUILTIN_PRESETS[0]!.preset.settings}
      scale={0.9}
      quality="tablet"
      artStyle="sculpted"
      attackerPalette="marble"
      victimPalette="blue"
      authoredPawn={authoredPawn}
      onController={(value) => {
        controller = value
      }}
      onReady={ready}
      onProgress={progress}
      onError={error}
    />
  ))
  return { view, ready, progress, error, setSize, controller: () => controller }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.canvas = document.createElement('canvas')
  fixture.fence.mockResolvedValue()
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('cinematic first frame and canvas lifetime', () => {
  it('uses the same authored shape for capture physics, waiting pieces, and the exported scene description', async () => {
    const pawn = createGummyAuthoredPawn({ openness: 0.4 })
    const app = mount(pawn)
    await settle()
    expect(
      vi.mocked(createGummyParticleSolver).mock.calls[0]?.[2],
    ).toMatchObject({
      authoredPawn: pawn,
    })
    expect(
      vi.mocked(createGummyBoardRenderer).mock.calls[0]?.[6],
    ).toMatchObject({
      authoredPawn: pawn,
    })
    expect(app.controller()?.info().authoredPawn).toEqual(pawn)
    expect(app.error).not.toHaveBeenCalled()
  })

  it('keeps the before-board visible while initial canvas sizing is delayed, then starts after its first GPU fence', async () => {
    const app = mount()
    await settle()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(app.ready.mock.calls).toEqual([[false]])
    expect(app.progress).not.toHaveBeenCalled()
    let finish!: () => void
    fixture.fence.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    app.setSize({ width: 800, height: 600 })
    await settle()
    expect(fixture.render).toHaveBeenCalledOnce()
    expect(app.ready.mock.calls).toEqual([[false]])
    finish()
    await settle()
    expect(app.ready.mock.calls).toEqual([[false], [true]])
    expect(app.progress).toHaveBeenCalledWith(0, true)
    expect(app.error).not.toHaveBeenCalled()
  })

  it('does not expose a frame invalidated by a resize while the GPU is busy', async () => {
    const app = mount()
    await settle()
    let finish!: () => void
    fixture.fence.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    app.setSize({ width: 800, height: 600 })
    await settle()
    app.setSize({ width: 0, height: 0 })
    finish()
    await settle()
    expect(app.ready.mock.calls).toEqual([[false]])
    app.setSize({ width: 390, height: 400 })
    await settle()
    expect(app.ready.mock.calls).toEqual([[false], [true]])
  })

  it('starts playback after queued first-frame resizes finish instead of getting stuck paused', async () => {
    const app = mount()
    await settle()
    let first!: () => void, last!: () => void
    fixture.fence
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            first = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            last = resolve
          }),
      )
    app.setSize({ width: 800, height: 600 })
    await settle()
    // Layout returns to its original size while the first submission is pending.
    app.setSize({ width: 700, height: 600 })
    app.setSize({ width: 800, height: 600 })
    first()
    await settle()
    expect(app.ready.mock.calls).toEqual([[false]])
    last()
    await settle()
    expect(app.ready.mock.calls).toEqual([[false], [true]])
    expect(app.progress).toHaveBeenCalledWith(0, true)
  })

  it('releases the canvas and shot on Skip before initial sizing, with no late readiness', async () => {
    const app = mount()
    await settle()
    app.view.unmount()
    app.setSize({ width: 800, height: 600 })
    await settle()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(fixture.rendererDestroyed).toHaveBeenCalledOnce()
    expect(fixture.solverDestroyed).toHaveBeenCalledOnce()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(app.ready.mock.calls).toEqual([[false]])
  })
})
