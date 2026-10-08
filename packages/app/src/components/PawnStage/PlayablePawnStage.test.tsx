/** Exercise preview rebake coalescing, resource ownership and demand-only drawing across edits. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyAuthoredPawn, validateGummyAuthoredPawn, } from '@/simulation/gummy/gummyAuthoredPawn'
import { PlayablePawnStage } from './PlayablePawnStage'
import type { ParentProps } from 'solid-js'
import type { GummyPalette } from '../GummyBear/gummyMaterial'

const fixture = vi.hoisted(() => ({
  unconfigure: vi.fn(),
  create: vi.fn(),
  fence: vi.fn(),
  canvas: undefined as HTMLCanvasElement | undefined,
  device: undefined as EventTarget | undefined,
  media: undefined as (EventTarget & { matches: boolean }) | undefined,
  visible: undefined as ((value: boolean) => void) | undefined,
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(
    props: ParentProps<{ onVisibilityChange: (value: boolean) => void }>,
  ) {
    const [mounted, setMounted] = createSignal(false)
    fixture.visible = props.onVisibilityChange
    return (
      <>
        <canvas
          ref={(canvas) => {
            fixture.canvas = canvas
            canvas.hasPointerCapture = () => false
            canvas.setPointerCapture = vi.fn()
            canvas.releasePointerCapture = vi.fn()
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
      queue: { onSubmittedWorkDone: fixture.fence },
    }),
  }),
}))
vi.mock('../GummyBoard/gummyBoardRenderer', () => ({
  createGummyBoardRenderer: fixture.create,
}))

function renderer() {
  return {
    render: vi.fn(),
    destroy: vi.fn(),
    readRenderStats: () => ({ restVertexCounts: { pawn: 123 } }),
  }
}
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0

async function frame() {
  await Promise.resolve()
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(1000)
  await Promise.resolve()
}

function mount(initialQuality: 'auto' | 'tablet' | 'high' = 'tablet') {
  const [pawn, setPawn] = createSignal(createGummyAuthoredPawn())
  const [palette, setPalette] = createSignal<GummyPalette>('marble')
  const [quality, setQuality] = createSignal<'auto' | 'tablet' | 'high'>(
    initialQuality,
  )
  const [reset, setReset] = createSignal(0)
  const status = vi.fn()
  const view = render(() => (
    <PlayablePawnStage
      pawn={pawn()}
      palette={palette()}
      quality={quality()}
      resetKey={reset()}
      onStatus={status}
    />
  ))
  return { view, status, pawn, setPawn, setPalette, setQuality, setReset }
}
beforeEach(() => {
  vi.useFakeTimers()
  fixture.unconfigure.mockReset()
  fixture.fence.mockReset().mockResolvedValue(undefined)
  fixture.create
    .mockReset()
    .mockImplementation(() => Promise.resolve(renderer()))
  fixture.device = new EventTarget()
  fixture.media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => fixture.media)
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('playable pawn preview', () => {
  it('bakes only the pawn at actual board detail and reports ready after its first submitted frame', async () => {
    const live = renderer()
    fixture.create.mockResolvedValueOnce(live)
    const app = mount()
    expect(app.status).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: false }),
    )
    await vi.advanceTimersByTimeAsync(240)
    expect(fixture.create).toHaveBeenCalledOnce()
    expect(fixture.create.mock.calls[0]!.slice(4, 6)).toEqual([
      undefined,
      undefined,
    ])
    expect(fixture.create.mock.calls[0]![6]).toMatchObject({
      restSpacing: 0.08,
      artStyle: 'sculpted',
      moulds: ['pawn'],
      lightResolution: 512,
    })
    expect(app.status).not.toHaveBeenCalledWith(
      expect.objectContaining({ ready: true }),
    )
    await frame()
    expect(live.render).toHaveBeenCalledOnce()
    expect(live.render.mock.calls[0]![1].pieces).toEqual([
      expect.objectContaining({ mould: 'pawn', palette: 'marble', scale: 0.9 }),
    ])
    expect(app.status).toHaveBeenLastCalledWith({
      ready: true,
      vertexCount: 123,
    })
    app.view.unmount()
    expect(live.destroy).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('coalesces rapid edits and serializes in-flight aborted preparations', async () => {
    let finish!: (value: unknown) => void
    const obsolete = renderer(),
      latest = renderer()
    fixture.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    fixture.create.mockResolvedValueOnce(latest)
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    const signal = fixture.create.mock.calls[0]![6].signal as AbortSignal
    app.setPawn(createGummyAuthoredPawn({ openness: 0.3 }))
    app.setPawn(createGummyAuthoredPawn({ openness: 0.8 }))
    await vi.advanceTimersByTimeAsync(240)
    expect(signal.aborted).toBe(true)
    expect(fixture.create).toHaveBeenCalledOnce()
    finish(obsolete)
    await vi.advanceTimersByTimeAsync(0)
    expect(obsolete.destroy).toHaveBeenCalledOnce()
    expect(fixture.create).toHaveBeenCalledTimes(2)
    expect(fixture.create.mock.calls[1]![6].authoredPawn.recipe.openness).toBe(
      0.8,
    )
    await frame()
    expect(obsolete.render).not.toHaveBeenCalled()
    expect(latest.render).toHaveBeenCalledOnce()
  })

  it('does not rebake names or palette changes and only draws visible changes', async () => {
    const live = renderer()
    fixture.create.mockResolvedValueOnce(live)
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    for (let i = 0; i < 5; i++) await frame()
    expect(live.render).toHaveBeenCalledOnce()
    app.setPawn({ ...app.pawn(), name: 'Renamed' })
    await vi.advanceTimersByTimeAsync(300)
    expect(fixture.create).toHaveBeenCalledOnce()
    fixture.visible!(false)
    app.setPalette('blue')
    await frame()
    expect(live.render).toHaveBeenCalledOnce()
    fixture.visible!(true)
    await frame()
    expect(live.render).toHaveBeenCalledTimes(2)
    expect(fixture.create).toHaveBeenCalledOnce()
    fixture.canvas!.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -50, cancelable: true }),
    )
    await frame()
    expect(live.render).toHaveBeenCalledTimes(3)
    app.setReset(1)
    await frame()
    expect(live.render).toHaveBeenCalledTimes(4)
  })

  it('allows geometry editing with an empty draft name and does not rebake when renamed', async () => {
    fixture.create.mockImplementation((...args: unknown[]) => {
      const quality = args[6] as { authoredPawn: unknown }
      return validateGummyAuthoredPawn(quality.authoredPawn)
        ? Promise.resolve(renderer())
        : Promise.reject(new Error('Invalid authored pawn snapshot'))
    })
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    app.setPawn({ ...createGummyAuthoredPawn({ openness: 0.63 }), name: '' })
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    expect(fixture.create).toHaveBeenCalledTimes(2)
    expect(app.status).toHaveBeenLastCalledWith({
      ready: true,
      vertexCount: 123,
    })
    app.setPawn({ ...app.pawn(), name: 'My updated pawn' })
    await vi.advanceTimersByTimeAsync(300)
    await frame()
    expect(fixture.create).toHaveBeenCalledTimes(2)
    expect(app.pawn().name).toBe('My updated pawn')
  })

  it('releases a late completed bake after the preview is unmounted', async () => {
    let finish!: (value: unknown) => void
    const late = renderer()
    fixture.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    const signal = fixture.create.mock.calls[0]![6].signal as AbortSignal
    app.view.unmount()
    expect(signal.aborted).toBe(true)
    finish(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(late.destroy).toHaveBeenCalledOnce()
    expect(late.render).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('surfaces preparation failures and retries after a new geometry edit', async () => {
    fixture.create.mockRejectedValueOnce(new Error('GPU allocation failed'))
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    expect(app.status).toHaveBeenLastCalledWith({
      ready: false,
      message: 'GPU allocation failed',
    })
    app.setPawn(createGummyAuthoredPawn({ openness: 0.5 }))
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    expect(app.status).toHaveBeenLastCalledWith({
      ready: true,
      vertexCount: 123,
    })
  })

  it('keeps asynchronous GPU failure visible after queue completion and reports a later retry failure', async () => {
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    let complete!: () => void
    fixture.fence.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    await frame()
    const gpuError = (message: string) => {
      const event = new Event('uncapturederror')
      Object.defineProperty(event, 'error', { value: new Error(message) })
      fixture.device!.dispatchEvent(event)
    }
    gpuError('First render failed')
    expect(app.status).toHaveBeenLastCalledWith({
      ready: false,
      message: 'GPU error: First render failed',
    })
    complete()
    await Promise.resolve()
    expect(app.status).toHaveBeenLastCalledWith({
      ready: false,
      message: 'GPU error: First render failed',
    })
    expect(app.status).not.toHaveBeenCalledWith(
      expect.objectContaining({ ready: true }),
    )
    app.setPawn(createGummyAuthoredPawn({ openness: 0.57 }))
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    expect(app.status).toHaveBeenLastCalledWith({
      ready: true,
      vertexCount: 123,
    })
    gpuError('Second render failed')
    expect(app.status).toHaveBeenLastCalledWith({
      ready: false,
      message: 'GPU error: Second render failed',
    })
    await frame()
    expect(app.status).toHaveBeenLastCalledWith({
      ready: false,
      message: 'GPU error: Second render failed',
    })
  })

  it('replaces quality resources on the same configured canvas', async () => {
    const first = renderer()
    fixture.create.mockResolvedValueOnce(first)
    const app = mount()
    await vi.advanceTimersByTimeAsync(240)
    await frame()
    const canvas = fixture.canvas
    app.setQuality('high')
    await vi.advanceTimersByTimeAsync(240)
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(fixture.create.mock.calls[1]![6]).toMatchObject({
      restSpacing: 0.08,
      lightResolution: 1024,
    })
    expect(fixture.canvas).toBe(canvas)
    expect(fixture.unconfigure).not.toHaveBeenCalled()
  })

  it('updates automatic lighting for viewport or input changes and removes its media listener', async () => {
    const remove = vi.spyOn(fixture.media!, 'removeEventListener')
    const app = mount('auto')
    await vi.advanceTimersByTimeAsync(240)
    expect(fixture.create.mock.calls[0]![6].lightResolution).toBe(1024)
    fixture.media!.matches = true
    fixture.media!.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(240)
    expect(fixture.create.mock.calls[1]![6].lightResolution).toBe(512)
    app.view.unmount()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
