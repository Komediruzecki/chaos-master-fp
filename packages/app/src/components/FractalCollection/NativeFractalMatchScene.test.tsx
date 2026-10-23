/** Execute native scene ownership, idle scheduling and receipt completion around GPU fences. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeMatchPieces } from './nativeFractalMatchFrame'
import { NativeFractalMatchScene } from './NativeFractalMatchScene'
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { ParentProps } from 'solid-js'
import type { BoardFrame } from '../PawnBoard/pawnBoardRenderer'
import type { CollectionCloud } from './collectionCloudWorker'

const fixture = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  device: undefined as EventTarget | undefined,
  fence: undefined as Promise<void> | undefined,
  unconfigure: vi.fn(),
  render: vi.fn<(frame: BoardFrame) => void>(),
  destroy: vi.fn(),
  setCloud: vi.fn(),
  setGlass: vi.fn(),
  clearClouds: vi.fn(),
  clearGlass: vi.fn(),
  clouds: [] as CollectionCloud[],
}))

vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps) {
    const [mounted, setMounted] = createSignal(false)
    return (
      <>
        <canvas
          ref={(canvas) => {
            fixture.canvas = canvas
            canvas.hasPointerCapture = () => false
            canvas.setPointerCapture = () => {}
            canvas.releasePointerCapture = () => {}
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
      queue: { onSubmittedWorkDone: () => fixture.fence ?? Promise.resolve() },
    }),
  }),
}))
vi.mock('../PawnBoard/pawnBoardRenderer', () => ({
  createPawnBoardRenderer: () => ({
    render: fixture.render,
    destroy: fixture.destroy,
    setVariantCloud: fixture.setCloud,
    clearVariantClouds: fixture.clearClouds,
    setVariantGlass: fixture.setGlass,
    clearVariantGlass: fixture.clearGlass,
  }),
}))
vi.mock('./useCollectionClouds', () => ({
  useCollectionClouds: () => ({
    clouds: () => fixture.clouds,
    busy: () => false,
    error: () => '',
  }),
}))
vi.mock('@/flame/chess/fractalStudyGlass', () => ({
  getFractalStudyGlassRole: () => 'knight',
  buildFractalStudyGlass: () => ({ vertices: new Float32Array(18), radius: 1 }),
}))

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
let now = 1000

async function frame() {
  now += 50
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
  await Promise.resolve()
  await Promise.resolve()
}

function mount(receipt?: ChessMoveReceipt) {
  const [current, setReceipt] = createSignal(receipt)
  const [position, setPosition] = createSignal<ChessPosition>(
    receipt?.after ?? createChessGame().position,
  )
  const [enclosure, setEnclosure] = createSignal<'pure' | 'glass'>('pure')
  const complete = vi.fn(),
    ready = vi.fn(),
    error = vi.fn(),
    select = vi.fn()
  const app = render(() => (
    <NativeFractalMatchScene
      collectionId="wild-canopy"
      enclosure={enclosure()}
      scale={0.9}
      position={position()}
      receipt={current()}
      legalSquares={['e4']}
      onSquare={select}
      onComplete={complete}
      onReady={ready}
      onError={error}
    />
  ))
  return {
    app,
    setReceipt,
    setPosition,
    setEnclosure,
    complete,
    ready,
    error,
    select,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.device = new EventTarget()
  fixture.fence = undefined
  fixture.clouds = [
    'pawn',
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
  ].flatMap((role) =>
    (['light', 'dark'] as const).map((side) => ({
      key: `${role}:${side}`,
      side,
      points: new Float32Array([0, 0, 0, 0, 0.1, 1, 0.1, 0]),
      colors: new Float32Array(8).fill(0.5),
      bounds: { min: [-0.1, 0, -0.1] as const, max: [0.1, 1, 0.1] as const },
    })),
  )
  frames = new Map()
  nextFrame = 0
  now = 1000
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

describe('native match scene lifecycle', () => {
  it('does not render for hover but renders an active orbit and returns to idle after release', async () => {
    mount()
    await frame()
    const pointer = (type: string, x: number, buttons = 0) => {
      fixture.canvas!.dispatchEvent(
        Object.assign(
          new MouseEvent(type, {
            clientX: x,
            clientY: 120,
            button: 0,
            buttons,
            cancelable: true,
          }),
          { pointerId: 1, pointerType: 'mouse', isPrimary: true },
        ),
      )
    }
    for (const x of [100, 150, 200]) {
      pointer('pointermove', x)
      await frame()
    }
    expect(fixture.render).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)

    pointer('pointerdown', 200, 1)
    pointer('pointermove', 240, 1)
    expect(frames.size).toBe(1)
    await frame()
    expect(fixture.render).toHaveBeenCalledTimes(2)
    pointer('pointerup', 240)
    await frame()
    const rendered = fixture.render.mock.calls.length
    pointer('pointermove', 280)
    await frame()
    expect(fixture.render).toHaveBeenCalledTimes(rendered)
    expect(frames.size).toBe(0)
  })

  it('stops RAF when idle and reuses all uploads when switching pure and glass', async () => {
    const app = mount()
    await frame()
    expect(app.error).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenLastCalledWith(true)
    expect(fixture.render).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    expect(fixture.setCloud).toHaveBeenCalledTimes(12)
    expect(fixture.setGlass).toHaveBeenCalledOnce()
    app.setEnclosure('glass')
    await frame()
    expect(fixture.render).toHaveBeenCalledTimes(2)
    expect(
      fixture.render.mock.lastCall![0].pieces.filter((piece) => piece.glassKey),
    ).toHaveLength(4)
    expect(fixture.setCloud).toHaveBeenCalledTimes(12)
    expect(fixture.setGlass).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    app.app.getByRole('button', { name: 'Move to e4' }).click()
    expect(app.select).toHaveBeenCalledExactlyOnceWith('e4')
  })

  it('presents the before frame and completes the exact legal after position only once', async () => {
    const { receipt } = applyChessMove(createChessGame(), {
      from: 'e2',
      to: 'e4',
    })
    const app = mount(receipt)
    await frame()
    expect(fixture.render.mock.lastCall![0].pieces).toEqual(
      nativeMatchPieces(receipt.before, {
        collectionId: 'wild-canopy',
        enclosure: 'pure',
        scale: 0.9,
      }),
    )
    for (let i = 0; i < 20; i++) await frame()
    expect(app.complete).toHaveBeenCalledExactlyOnceWith(receipt)
    expect(fixture.render.mock.lastCall![0].pieces).toEqual(
      nativeMatchPieces(receipt.after, {
        collectionId: 'wild-canopy',
        enclosure: 'pure',
        scale: 0.9,
      }),
    )
    expect(frames.size).toBe(0)
    expect(fixture.destroy).not.toHaveBeenCalled()
  })

  it('does not complete a skipped receipt when its last submitted frame finishes late', async () => {
    const { receipt } = applyChessMove(createChessGame(), {
      from: 'e2',
      to: 'e4',
    })
    const app = mount(receipt)
    for (let i = 0; i < 13; i++) await frame()
    let resolve!: () => void
    fixture.fence = new Promise<void>((done) => {
      resolve = done
    })
    await frame()
    app.setReceipt(undefined)
    expect(app.complete).not.toHaveBeenCalled()
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    fixture.fence = undefined
    await frame()
    expect(app.complete).not.toHaveBeenCalled()
    expect(fixture.render.mock.lastCall![0].pieces).toEqual(
      nativeMatchPieces(receipt.after, {
        collectionId: 'wild-canopy',
        enclosure: 'pure',
        scale: 0.9,
      }),
    )
    expect(frames.size).toBe(0)
  })

  it('destroys the renderer and presentation storage without restarting after a pending fence', async () => {
    let resolve!: () => void
    fixture.fence = new Promise<void>((done) => {
      resolve = done
    })
    const { receipt } = applyChessMove(createChessGame(), {
      from: 'e2',
      to: 'e4',
    })
    const app = mount(receipt)
    await frame()
    app.app.unmount()
    expect(fixture.destroy).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(app.ready).toHaveBeenLastCalledWith(false)
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(frames.size).toBe(0)
    expect(app.complete).not.toHaveBeenCalled()
    expect(fixture.render).toHaveBeenCalledOnce()
  })

  it('restarts an immediately replayed receipt without accepting the old playback completion', async () => {
    const { receipt } = applyChessMove(createChessGame(), {
      from: 'e2',
      to: 'e4',
    })
    const app = mount(receipt)
    for (let i = 0; i < 13; i++) await frame()
    let resolve!: () => void
    fixture.fence = new Promise<void>((done) => {
      resolve = done
    })
    await frame()
    app.setReceipt(undefined)
    app.setReceipt(receipt)
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    fixture.fence = undefined
    await frame()
    expect(app.complete).not.toHaveBeenCalled()
    expect(fixture.render.mock.lastCall![0].pieces).toEqual(
      nativeMatchPieces(receipt.before, {
        collectionId: 'wild-canopy',
        enclosure: 'pure',
        scale: 0.9,
      }),
    )
    for (let i = 0; i < 20; i++) await frame()
    expect(app.complete).toHaveBeenCalledExactlyOnceWith(receipt)
    expect(frames.size).toBe(0)
  })
})
