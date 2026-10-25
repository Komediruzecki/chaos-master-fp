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
import type { PreparedNativeContact } from './nativeContactPreparation'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { NativeFractureMode } from '@/flame/chess/nativeFractureTypes'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'

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
  setSolid: vi.fn(),
  clearSolids: vi.fn(),
  setMotion: vi.fn(),
  clearMotions: vi.fn(),
  prepare: vi.fn<() => Promise<PreparedNativeContact | undefined>>(),
  cancelPreparation: vi.fn(),
  disposePreparation: vi.fn(),
  solids: [] as WindowRookFracture[],
  clouds: [] as CollectionCloud[],
  shell: undefined as FractalStudyGlass | undefined,
  source: undefined as
    | (() => { clouds: CollectionCloud[]; shell?: FractalStudyGlass })
    | undefined,
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
    setVariantSolid: fixture.setSolid,
    clearVariantSolids: fixture.clearSolids,
    setSolidMotion: fixture.setMotion,
    clearSolidMotions: fixture.clearMotions,
  }),
}))
vi.mock('./useCollectionClouds', () => ({
  useCollectionClouds: (id: () => string) => ({
    clouds: () => (fixture.source ? fixture.source().clouds : fixture.clouds),
    shell: () => (fixture.source ? fixture.source().shell : fixture.shell),
    solids: () => fixture.solids,
    solidShell: () => fixture.shell,
    resultKey: () => `${id()}:normal:solids`,
    busy: () => false,
    error: () => '',
  }),
}))
vi.mock('./nativeContactPreparation', () => ({
  createNativeContactPreparation: () => ({
    prepare: fixture.prepare,
    cancel: fixture.cancelPreparation,
    dispose: fixture.disposePreparation,
  }),
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

function mount(
  receipt?: ChessMoveReceipt,
  collectionId = 'wild-canopy',
  initialFracture?: NativeFractureMode,
) {
  const [current, setReceipt] = createSignal(receipt)
  const [position, setPosition] = createSignal<ChessPosition>(
    receipt?.after ?? createChessGame().position,
  )
  const [enclosure, setEnclosure] = createSignal<'pure' | 'glass'>('pure')
  const [fracture, setFracture] = createSignal(initialFracture)
  const complete = vi.fn(),
    ready = vi.fn(),
    error = vi.fn(),
    select = vi.fn()
  const app = render(() => (
    <NativeFractalMatchScene
      collectionId={collectionId}
      fracture={fracture()}
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
    setFracture,
    complete,
    ready,
    error,
    select,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.setMotion.mockReset()
  fixture.clearMotions.mockReset()
  fixture.device = new EventTarget()
  fixture.fence = undefined
  fixture.shell = { vertices: new Float32Array(18).fill(0.25), radius: 0.73 }
  fixture.source = undefined
  fixture.prepare.mockResolvedValue(undefined)
  fixture.solids = []
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
  it('reuploads an older cached take after a later motion upload failed', async () => {
    const { receipt } = applyChessMove(
      createChessGame('r6k/8/8/8/8/8/8/R6K w - - 0 1'),
      { from: 'a1', to: 'a8' },
    )
    fixture.solids = [
      {
        key: 'rook:dark',
        vertices: new Float32Array(),
        fragmentCount: 0,
        chunks: [],
        physics: { chunks: [], bonds: [], cellSize: 0.1 },
        diagnostics: {
          cellSize: 0.1,
          occupiedCells: 0,
          connectedComponents: 1,
          retainedFraction: 1,
          volume: 0,
          interfaceFaces: 0,
          exteriorFaces: 0,
        },
      },
    ]
    const first: PreparedNativeContact = {
      key: 'first-take',
      victimId: receipt.captured!.id,
      motion: {
        poses: new Float32Array(16),
        sampleRate: 60,
        frameCount: 2,
        chunkCount: 1,
        brokenAt: new Float32Array([0.6]),
        stats: {
          boxCount: 1,
          steps: 1,
          contacts: 1,
          brokenBonds: 1,
          firstContact: 0.5,
          maxPenetration: 0,
        },
      },
    }
    fixture.prepare
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, key: 'failed-take' })
      .mockResolvedValueOnce(first)
    const uploads = new Set<string>()
    fixture.clearMotions.mockImplementation(() => {
      uploads.clear()
    })
    fixture.setMotion.mockImplementation((key: string) => {
      if (key === 'failed-take') throw new Error('Motion allocation failed')
      uploads.add(key)
    })
    const app = mount(receipt, 'lattice-court', 'contact')
    await frame()
    await frame()
    expect(uploads.has(first.key)).toBe(true)
    app.setReceipt(undefined)
    app.setReceipt({ ...receipt })
    await frame()
    await frame()
    expect(app.error).toHaveBeenCalledExactlyOnceWith(
      'Motion allocation failed',
    )
    expect(uploads.size).toBe(0)
    app.setReceipt(undefined)
    app.setReceipt({ ...receipt })
    await frame()
    await frame()
    expect(fixture.setMotion.mock.calls.map(([key]) => key)).toEqual([
      'first-take',
      'failed-take',
      'first-take',
    ])
    expect(uploads.has(first.key)).toBe(true)
    expect(app.ready).toHaveBeenLastCalledWith(true)
    expect(fixture.destroy).not.toHaveBeenCalled()
  })

  it('holds the intact pre-capture board until contact preparation finishes, then resumes once', async () => {
    const { receipt } = applyChessMove(
      createChessGame('r6k/8/8/8/8/8/8/R6K w - - 0 1'),
      { from: 'a1', to: 'a8' },
    )
    fixture.solids = [
      {
        key: 'rook:dark',
        vertices: new Float32Array(),
        fragmentCount: 0,
        chunks: [],
        physics: { chunks: [], bonds: [], cellSize: 0.1 },
        diagnostics: {
          cellSize: 0.1,
          occupiedCells: 0,
          connectedComponents: 1,
          retainedFraction: 1,
          volume: 0,
          interfaceFaces: 0,
          exteriorFaces: 0,
        },
      },
    ]
    let resolve!: (result: PreparedNativeContact) => void
    fixture.prepare.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const app = mount(receipt, 'lattice-court', 'contact')
    await frame()
    const before = fixture.render.mock.lastCall![0].pieces
    expect(before.map((piece) => piece.position)).toEqual(
      nativeMatchPieces(receipt.before, {
        collectionId: 'lattice-court',
        enclosure: 'pure',
        scale: 0.9,
      }).map((piece) => piece.position),
    )
    expect(fixture.canvas!.dataset.preparing).toBe('true')
    expect(app.ready).toHaveBeenLastCalledWith(false)
    for (let i = 0; i < 60; i++) await frame()
    expect(fixture.render).toHaveBeenCalledOnce()
    expect(app.complete).not.toHaveBeenCalled()
    const prepared: PreparedNativeContact = {
      key: 'take-1',
      victimId: receipt.captured!.id,
      motion: {
        poses: new Float32Array(16),
        sampleRate: 60,
        frameCount: 2,
        chunkCount: 1,
        brokenAt: new Float32Array([0.6]),
        stats: {
          boxCount: 1,
          steps: 1,
          contacts: 1,
          brokenBonds: 1,
          firstContact: 0.5,
          maxPenetration: 0,
        },
      },
    }
    resolve(prepared)
    await Promise.resolve()
    await frame()
    expect(fixture.setMotion).toHaveBeenCalledExactlyOnceWith(
      'take-1',
      prepared.motion,
    )
    expect(fixture.canvas!.dataset.preparing).toBe('false')
    expect(app.ready).toHaveBeenLastCalledWith(true)
    const victim = fixture.render.mock.lastCall![0].pieces.find(
      (piece) => piece.solidMotionKey === 'take-1',
    )
    expect(victim?.solidMotionTime).toBe(0)
    for (let i = 0; i < 60; i++) await frame()
    expect(app.complete).toHaveBeenCalledExactlyOnceWith(receipt)
    app.app.unmount()
    expect(fixture.disposePreparation).toHaveBeenCalledOnce()
  })

  it('ignores a superseded contact rejection after the move is skipped', async () => {
    const { receipt } = applyChessMove(
      createChessGame('r6k/8/8/8/8/8/8/R6K w - - 0 1'),
      { from: 'a1', to: 'a8' },
    )
    fixture.solids = [
      {
        key: 'rook:dark',
        vertices: new Float32Array(),
        fragmentCount: 0,
        chunks: [],
        physics: { chunks: [], bonds: [], cellSize: 0.1 },
        diagnostics: {
          cellSize: 0.1,
          occupiedCells: 0,
          connectedComponents: 1,
          retainedFraction: 1,
          volume: 0,
          interfaceFaces: 0,
          exteriorFaces: 0,
        },
      },
    ]
    let reject!: (error: Error) => void
    fixture.prepare.mockReturnValueOnce(
      new Promise((_done, fail) => {
        reject = fail
      }),
    )
    const app = mount(receipt, 'lattice-court', 'contact')
    await frame()
    app.setReceipt(undefined)
    reject(new Error('Replaced capture'))
    await frame()
    expect(app.error).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenLastCalledWith(true)
    expect(fixture.setMotion).not.toHaveBeenCalled()
  })

  it('keeps current contact errors visible and recovers when point breakup is selected', async () => {
    const { receipt } = applyChessMove(
      createChessGame('r6k/8/8/8/8/8/8/R6K w - - 0 1'),
      { from: 'a1', to: 'a8' },
    )
    fixture.solids = [
      {
        key: 'rook:dark',
        vertices: new Float32Array(),
        fragmentCount: 0,
        chunks: [],
        physics: { chunks: [], bonds: [], cellSize: 0.1 },
        diagnostics: {
          cellSize: 0.1,
          occupiedCells: 0,
          connectedComponents: 1,
          retainedFraction: 1,
          volume: 0,
          interfaceFaces: 0,
          exteriorFaces: 0,
        },
      },
    ]
    fixture.prepare.mockRejectedValueOnce(new Error('Contact solver stopped'))
    const app = mount(receipt, 'lattice-court', 'contact')
    await frame()
    await frame()
    expect(app.error).toHaveBeenCalledExactlyOnceWith('Contact solver stopped')
    expect(app.ready).toHaveBeenLastCalledWith(false)
    expect(app.complete).not.toHaveBeenCalled()
    app.setFracture('points')
    await frame()
    expect(app.ready).toHaveBeenLastCalledWith(true)
    for (let i = 0; i < 60; i++) await frame()
    expect(app.complete).toHaveBeenCalledExactlyOnceWith(receipt)
    expect(fixture.destroy).not.toHaveBeenCalled()
  })

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
    expect(fixture.setGlass).toHaveBeenCalledWith(
      'wild-canopy',
      fixture.shell!.vertices,
      fixture.shell!.radius,
    )
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

  it('uploads one matching worker batch unchanged and preserves the last frame during a source reload', async () => {
    const [source, setSource] = createSignal<{
      clouds: CollectionCloud[]
      shell?: FractalStudyGlass
    }>({ clouds: [] })
    fixture.source = source
    const app = mount()
    await frame()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenLastCalledWith(false)
    setSource({ clouds: fixture.clouds, shell: fixture.shell })
    await frame()
    expect(fixture.setGlass).toHaveBeenCalledExactlyOnceWith(
      'wild-canopy',
      fixture.shell!.vertices,
      fixture.shell!.radius,
    )
    expect(fixture.render).toHaveBeenCalledOnce()
    for (let index = 0; index < fixture.clouds.length; index++) {
      const cloud = fixture.clouds[index]!
      const upload = fixture.setCloud.mock.calls[index]!
      expect(upload).toEqual([
        cloud.key,
        cloud.side,
        cloud.points,
        cloud.colors,
      ])
      expect(upload[2]).toBe(cloud.points)
      expect(upload[3]).toBe(cloud.colors)
    }
    expect(fixture.setGlass.mock.calls[0]![1]).toBe(fixture.shell!.vertices)
    const clearCount = fixture.clearGlass.mock.calls.length
    setSource({ clouds: [] })
    await frame()
    expect(fixture.clearGlass).toHaveBeenCalledTimes(clearCount)
    expect(fixture.render).toHaveBeenCalledOnce()
    expect(app.ready).toHaveBeenLastCalledWith(false)
    expect(app.error).not.toHaveBeenCalled()
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

  it('does not accept the old completion fence when resource preparation restarts the same receipt', async () => {
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
    app.setEnclosure('glass')
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    fixture.fence = undefined
    await frame()
    expect(app.complete).not.toHaveBeenCalled()
    expect(
      fixture.render.mock.lastCall![0].pieces.map((piece) => piece.position),
    ).toEqual(
      nativeMatchPieces(receipt.before, {
        collectionId: 'wild-canopy',
        enclosure: 'glass',
        scale: 0.9,
      }).map((piece) => piece.position),
    )
    for (let i = 0; i < 20; i++) await frame()
    expect(app.complete).toHaveBeenCalledExactlyOnceWith(receipt)
  })
})
