/** Native exports serialize frames and resize, retain clouds, and never revive a disposed preview. */
import { cleanup, render } from '@solidjs/testing-library'
import { createEffect, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveNativeCinemaReceipt } from '@/pages/GummyBoard/nativeCinemaRecipe'
import { NativeFractalCinemaScene } from './NativeFractalCinemaScene'
import { nativeMatchPieces } from './nativeFractalMatchFrame'
import type { ParentProps } from 'solid-js'
import type { BoardFrame } from '../PawnBoard/pawnBoardRenderer'
import type { CollectionCloud } from './collectionCloudWorker'
import type { PreparedNativeContact } from './nativeContactPreparation'
import type { NativeFractalCinemaController } from './NativeFractalCinemaScene'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

type Size = { width: number; height: number }
const fixture = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  device: undefined as EventTarget | undefined,
  size: undefined as (() => Size) | undefined,
  captureSize: undefined as Size | undefined,
  render: vi.fn<(frame: BoardFrame, output?: GPUTextureView) => void>(),
  readCapture: vi.fn<() => Promise<ImageBitmap>>(),
  destroyCapture: vi.fn(),
  createCapture: vi.fn(),
  captureView: {} as GPUTextureView,
  fence: vi.fn<() => Promise<void>>(),
  destroy: vi.fn(),
  unconfigure: vi.fn(),
  setCloud: vi.fn(),
  setGlass: vi.fn(),
  clearClouds: vi.fn(),
  clearGlass: vi.fn(),
  setSolid: vi.fn(),
  clearSolids: vi.fn(),
  setMotion: vi.fn(),
  clearMotions: vi.fn(),
  prepare: vi.fn(),
  disposePreparation: vi.fn(),
  clouds: [] as CollectionCloud[],
  solids: undefined as WindowRookFracture[] | undefined,
  solidError: '',
  solidShell: undefined as FractalStudyGlass | undefined,
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps<{ fixedResolution?: Size }>) {
    createEffect(() => {
      fixture.captureSize = props.fixedResolution
      const size = props.fixedResolution ?? fixture.size!()
      fixture.canvas!.width = size.width
      fixture.canvas!.height = size.height
    })
    return props.children
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: fixture.canvas,
    context: { unconfigure: fixture.unconfigure },
    canvasFormat: 'bgra8unorm',
    canvasSize: () => fixture.captureSize ?? fixture.size!(),
  }),
}))
vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({
    root: {},
    device: Object.assign(fixture.device!, {
      queue: { onSubmittedWorkDone: fixture.fence },
      limits: { maxTextureDimension2D: 8192 },
    }),
  }),
}))
vi.mock('../PawnBoard/pawnBoardRenderer', () => ({
  createPawnBoardRenderer: () => ({
    render: fixture.render,
    destroy: fixture.destroy,
    setVariantCloud: fixture.setCloud,
    setVariantGlass: fixture.setGlass,
    clearVariantClouds: fixture.clearClouds,
    clearVariantGlass: fixture.clearGlass,
    setVariantSolid: fixture.setSolid,
    clearVariantSolids: fixture.clearSolids,
    setSolidMotion: fixture.setMotion,
    clearSolidMotions: fixture.clearMotions,
  }),
}))
vi.mock('./nativeContactPreparation', () => ({
  createNativeContactPreparation: () => ({
    prepare: fixture.prepare,
    cancel: vi.fn(),
    dispose: fixture.disposePreparation,
  }),
}))
vi.mock('./nativeCinemaCapture', () => ({
  createNativeCinemaCapture: (
    _device: unknown,
    _format: unknown,
    width: number,
    height: number,
  ) => {
    fixture.createCapture(width, height)
    return {
      width,
      height,
      view: fixture.captureView,
      read: fixture.readCapture,
      destroy: fixture.destroyCapture,
    }
  },
}))
vi.mock('./useCollectionClouds', () => ({
  useCollectionClouds: (id: () => string, quality: () => string) => ({
    resultKey: () => `${id()}:${quality()}:solids`,
    clouds: () => fixture.clouds,
    shell: () => ({ vertices: new Float32Array(18), radius: 1 }),
    solids: () => fixture.solids,
    solidError: () => fixture.solidError,
    solidShell: () => fixture.solidShell,
    busy: () => false,
    error: () => '',
  }),
}))

const recipe: NativeCinemaRecipe = {
  format: 'native-chess-cinema-shot',
  version: 1,
  fen: '7k/8/8/3n4/4P3/8/8/K7 w - - 0 1',
  from: 'e4',
  to: 'd5',
  nativeCollection: { version: 1, id: 'wild-canopy', enclosure: 'glass' },
  scale: 0.9,
  quality: 'normal',
  camera: 'arc',
}
const look = {
  collectionId: recipe.nativeCollection.id,
  enclosure: recipe.nativeCollection.enclosure,
  scale: recipe.scale,
}
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function mount(initial: Size = { width: 800, height: 600 }) {
  const [size, setSize] = createSignal(initial)
  const [currentRecipe, setRecipe] = createSignal(recipe)
  fixture.size = size
  let controller: NativeFractalCinemaController | undefined
  const ready = vi.fn(),
    error = vi.fn(),
    progress = vi.fn()
  const app = render(() => (
    <NativeFractalCinemaScene
      recipe={currentRecipe()}
      onController={(value) => {
        controller = value
      }}
      onReady={ready}
      onError={error}
      onProgress={progress}
    />
  ))
  return {
    app,
    ready,
    error,
    progress,
    setSize,
    setRecipe,
    controller: () => controller!,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.render.mockReset()
  fixture.setSolid.mockReset()
  fixture.setMotion.mockReset()
  fixture.canvas = document.createElement('canvas')
  fixture.device = new EventTarget()
  fixture.captureSize = undefined
  fixture.solids = undefined
  fixture.solidShell = undefined
  fixture.solidError = ''
  fixture.fence.mockResolvedValue()
  fixture.prepare.mockResolvedValue(undefined)
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

describe('native cinema frame ownership', () => {
  it.each(['geometry', 'motion'] as const)(
    'does not draw or become ready after a failed %s upload when resized',
    async (stage) => {
      const app = mount()
      await settle()
      fixture.solids = [
        {
          key: 'rook:dark',
          vertices: new Float32Array(19),
          fragmentCount: 1,
          chunks: [],
          physics: { chunks: [], bonds: [], cellSize: 1 },
          diagnostics: {
            cellSize: 1,
            occupiedCells: 1,
            connectedComponents: 1,
            retainedFraction: 1,
            volume: 1,
            interfaceFaces: 0,
            exteriorFaces: 6,
          },
        },
      ]
      const next: NativeCinemaRecipe = {
        ...recipe,
        fracture: 'contact',
        fen: '7k/8/8/3r4/4P3/8/8/K7 w - - 0 1',
        nativeCollection: {
          version: 1,
          id: 'lattice-court',
          enclosure: 'pure',
        },
      }
      const prepared: PreparedNativeContact = {
        key: 'take',
        victimId: resolveNativeCinemaReceipt(next).captured!.id,
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
      fixture.prepare.mockResolvedValueOnce(prepared)
      const upload = stage === 'geometry' ? fixture.setSolid : fixture.setMotion
      upload.mockImplementationOnce(() => {
        throw new Error('Upload allocation failed')
      })
      app.ready.mockClear()
      app.setRecipe(next)
      await settle()
      expect(app.error).toHaveBeenCalledExactlyOnceWith(
        'Upload allocation failed',
      )
      expect(app.controller().info().ready).toBe(false)
      const rendered = fixture.render.mock.calls.length
      app.setSize({ width: 900, height: 600 })
      await settle()
      await app.controller().render()
      await app.controller().setCaptureSize(undefined)
      expect(fixture.render).toHaveBeenCalledTimes(rendered)
      expect(app.ready.mock.calls.filter(([value]) => value)).toEqual([])
      expect(app.controller().info().error).toBeUndefined()
      app.setRecipe({ ...next, fracture: 'points' })
      await settle()
      expect(app.controller().info().ready).toBe(true)
      expect(fixture.destroy).not.toHaveBeenCalled()
    },
  )

  it('waits for a sized GPU frame and sleeps while paused', async () => {
    const app = mount({ width: 0, height: 0 })
    await settle()
    expect(app.ready.mock.calls).toEqual([[false]])
    expect(fixture.render).not.toHaveBeenCalled()
    let finish!: () => void
    fixture.fence.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
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
    expect(frames.size).toBe(0)
    expect(app.error).not.toHaveBeenCalled()
  })

  it('seeks backwards without resampling or uploading and ends on the legal board', async () => {
    const app = mount()
    await settle()
    const controller = app.controller()
    const receipt = resolveNativeCinemaReceipt(recipe)
    expect(controller.readState().pieces).toEqual(
      nativeMatchPieces(receipt.before, look),
    )
    await controller.seekFrame(150, 60)
    const first = controller.readState()
    expect(first.pieces.some((piece) => piece.age >= 0)).toBe(true)
    await controller.seekFrame(360, 60)
    expect(controller.readState().pieces).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
    await controller.seekFrame(150, 60)
    expect(controller.readState()).toEqual(first)
    await controller.resetPaused()
    expect(controller.readState().pieces).toEqual(
      nativeMatchPieces(receipt.before, look),
    )
    expect(fixture.setCloud).toHaveBeenCalledTimes(12)
    expect(fixture.setGlass).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    await expect(controller.seekFrame(-1, 30)).rejects.toThrow(
      'Frame and frame rate',
    )
    await expect(controller.seekFrame(1, Number.NaN)).rejects.toThrow(
      'Frame and frame rate',
    )
  })

  it('applies camera, enclosure, scale and moves without recreating the renderer or uploading its clouds', async () => {
    const app = mount()
    await settle()
    const controller = app.controller()
    await controller.seekFrame(150, 60)
    const next: NativeCinemaRecipe = {
      ...recipe,
      camera: 'hero',
      scale: 0.95,
      nativeCollection: { ...recipe.nativeCollection, enclosure: 'pure' },
      fen: '7k/8/8/4n3/3P4/8/8/K7 w - - 0 1',
      from: 'd4',
      to: 'e5',
    }
    app.setRecipe(next)
    expect(controller.info().ready).toBe(false)
    await settle()
    expect(app.controller()).toBe(controller)
    expect(controller.info().ready).toBe(true)
    expect(controller.readState()).toMatchObject({
      displayTime: 0,
      beforeFen: next.fen,
    })
    expect(fixture.render.mock.lastCall![0].showGlass).toBe(false)
    expect(fixture.setCloud).toHaveBeenCalledTimes(12)
    expect(fixture.setGlass).toHaveBeenCalledOnce()
    expect(fixture.destroy).not.toHaveBeenCalled()
    expect(fixture.unconfigure).not.toHaveBeenCalled()
    await controller.seekFrame(360, 60)
    expect(controller.readState().pieces).toEqual(
      nativeMatchPieces(resolveNativeCinemaReceipt(next).after, {
        collectionId: next.nativeCollection.id,
        enclosure: 'pure',
        scale: 0.95,
      }),
    )
  })

  it('does not publish a superseded shot as ready after its GPU fence finishes', async () => {
    const app = mount()
    await settle()
    let finish!: () => void
    fixture.fence.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    app.ready.mockClear()
    app.setRecipe({ ...recipe, camera: 'hero' })
    await settle()
    app.setRecipe({ ...recipe, camera: 'diagonal', scale: 0.85 })
    expect(app.controller().info().ready).toBe(false)
    finish()
    await settle()
    expect(app.ready.mock.calls.filter(([value]) => value)).toEqual([[true]])
    expect(fixture.setCloud).toHaveBeenCalledTimes(12)
    expect(
      app
        .controller()
        .readState()
        .pieces.every((piece) => piece.scale === 0.85),
    ).toBe(true)
    expect(app.error).not.toHaveBeenCalled()
  })

  it('uses the separately fitted solid envelope without changing the pure comparison', async () => {
    const app = mount()
    await settle()
    fixture.solids = [
      {
        key: 'rook:dark',
        vertices: new Float32Array(19),
        fragmentCount: 1,
        chunks: [],
        physics: { chunks: [], bonds: [], cellSize: 1 },
        diagnostics: {
          cellSize: 1,
          occupiedCells: 1,
          connectedComponents: 1,
          retainedFraction: 1,
          volume: 1,
          interfaceFaces: 0,
          exteriorFaces: 6,
        },
      },
    ]
    fixture.solidShell = { vertices: new Float32Array(24), radius: 1.1 }
    const lattice: NativeCinemaRecipe = {
      ...recipe,
      fracture: 'connected',
      fen: '7k/8/8/3r4/4P3/8/8/K7 w - - 0 1',
      nativeCollection: { version: 1, id: 'lattice-court', enclosure: 'glass' },
    }
    app.setRecipe(lattice)
    await settle()
    expect(
      app
        .controller()
        .readState()
        .pieces.find((piece) => piece.role === 'rook'),
    ).toMatchObject({ solidKey: 'rook:dark', glassKey: 'lattice-court:solid' })
    app.setRecipe({
      ...lattice,
      nativeCollection: { ...lattice.nativeCollection, enclosure: 'pure' },
    })
    await settle()
    expect(
      app
        .controller()
        .readState()
        .pieces.find((piece) => piece.role === 'rook')?.glassKey,
    ).toBeUndefined()
    expect(fixture.setSolid).toHaveBeenCalledOnce()
    expect(fixture.setGlass).toHaveBeenLastCalledWith(
      'lattice-court:solid',
      fixture.solidShell.vertices,
      1.1,
    )
  })

  it('keeps point mode usable after a connected solid preparation failure', async () => {
    const app = mount()
    await settle()
    fixture.solidError = 'The rook has no connected volume.'
    const lattice: NativeCinemaRecipe = {
      ...recipe,
      fen: '7k/8/8/3r4/4P3/8/8/K7 w - - 0 1',
      nativeCollection: { version: 1, id: 'lattice-court', enclosure: 'glass' },
    }
    app.setRecipe({ ...lattice, fracture: 'connected' })
    await settle()
    expect(app.error).toHaveBeenCalledWith(fixture.solidError)
    expect(app.controller().info().ready).toBe(false)
    expect(app.controller().info().error).toBeUndefined()
    app.setRecipe({ ...lattice, fracture: 'points' })
    await settle()
    expect(app.controller().info().ready).toBe(true)
    await app.controller().seekFrame(120, 60)
    expect(app.controller().readState().displayTime).toBe(2)
    expect(fixture.destroy).not.toHaveBeenCalled()
  })

  it('keeps a capture snapshot inside the queue before allowing a later seek or resize', async () => {
    const app = mount()
    await settle()
    const controller = app.controller()
    let finish!: (bitmap: ImageBitmap) => void
    const close = vi.fn()
    const snapshot = vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve
        }),
    )
    fixture.readCapture.mockImplementation(snapshot)
    const capture = controller.captureFrame(60, 30)
    await settle()
    expect(snapshot).toHaveBeenCalledOnce()
    expect(fixture.render.mock.lastCall![1]).toBe(fixture.captureView)
    expect(fixture.createCapture).toHaveBeenCalledWith(800, 600)
    expect(fixture.canvas!.dataset.time).toBe('2.0000')
    const seek = controller.seekFrame(180, 30)
    const resize = controller.setCaptureSize({ width: 720, height: 1280 })
    await settle()
    expect(controller.readState().displayTime).toBe(2)
    expect(fixture.captureSize).toBeUndefined()
    finish({ width: 800, height: 600, close })
    expect((await capture).width).toBe(800)
    await seek
    await resize
    expect(fixture.destroyCapture).toHaveBeenCalledOnce()
    expect(controller.readState().displayTime).toBe(6)
    expect(fixture.render.mock.lastCall![0]).toMatchObject({
      width: 720,
      height: 1280,
    })
    expect(close).not.toHaveBeenCalled()
    await controller.setCaptureSize(undefined)
    expect(fixture.render.mock.lastCall![0]).toMatchObject({
      width: 800,
      height: 600,
    })
    await expect(
      controller.setCaptureSize({ width: 5000, height: 10 }),
    ).rejects.toThrow('GPU cannot render')
  })

  it('rebuilds capture resources after a failed size replacement', async () => {
    const app = mount()
    await settle()
    fixture.readCapture.mockResolvedValue({
      close: vi.fn(),
    } as unknown as ImageBitmap)
    const controller = app.controller()
    ;(await controller.captureFrame(90, 30)).close()
    app.setSize({ width: 900, height: 600 })
    await settle()
    fixture.createCapture.mockImplementationOnce(() => {
      throw new Error('Allocation failed')
    })
    await expect(controller.captureFrame(90, 30)).rejects.toThrow(
      'Allocation failed',
    )
    app.setSize({ width: 800, height: 600 })
    await settle()
    ;(await controller.captureFrame(90, 30)).close()
    expect(fixture.createCapture.mock.calls).toEqual([
      [800, 600],
      [900, 600],
      [800, 600],
    ])
    expect(fixture.readCapture).toHaveBeenCalledTimes(2)
    expect(fixture.destroyCapture).toHaveBeenCalledOnce()
  })

  it('closes a bitmap completed after unmount and never resumes the renderer', async () => {
    const app = mount()
    await settle()
    const controller = app.controller()
    let finish!: (bitmap: ImageBitmap) => void
    const close = vi.fn()
    fixture.readCapture.mockImplementation(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve
        }),
    )
    const capture = controller.captureFrame(90, 30)
    await settle()
    app.app.unmount()
    const rendered = fixture.render.mock.calls.length
    finish({ close } as unknown as ImageBitmap)
    await expect(capture).rejects.toThrow('replaced')
    expect(close).toHaveBeenCalledOnce()
    expect(fixture.destroy).toHaveBeenCalledOnce()
    expect(fixture.destroyCapture).toHaveBeenCalledOnce()
    expect(fixture.unconfigure).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    expect(fixture.render).toHaveBeenCalledTimes(rendered)
    expect(app.error).not.toHaveBeenCalled()
  })

  it('starts one animation loop and cancels it on pause and GPU failure', async () => {
    const app = mount()
    await settle()
    const controller = app.controller()
    controller.play()
    controller.play()
    expect(frames.size).toBe(1)
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(1000)
    await settle()
    expect(frames.size).toBe(1)
    controller.pause()
    expect(frames.size).toBe(0)
    controller.play()
    fixture.device!.dispatchEvent(
      Object.assign(new Event('uncapturederror'), {
        error: new Error('test device failure'),
      }),
    )
    expect(app.error).toHaveBeenCalledOnce()
    expect(controller.info().ready).toBe(false)
    expect(frames.size).toBe(0)
    await expect(controller.render()).rejects.toThrow('test device failure')
  })
})
