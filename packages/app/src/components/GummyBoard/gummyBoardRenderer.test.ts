/** Optional live-rook rendering, independent revisions and failure/unmount resource ownership. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BOARD_MOULDS } from './gummyBoardInstances'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardParticleState, GummyBoardRenderOptions, } from './gummyBoardRenderer'

const mocks = vi.hoisted(() => ({
  surfaces: vi.fn(),
  rest: vi.fn(),
  targets: vi.fn(),
}))
vi.mock('../GummyBear/marchingGummySurface', () => ({
  createMarchingGummySurface: mocks.surfaces,
}))
vi.mock('./gummyBoardRestMeshes', () => ({
  createGummyBoardRestMeshes: mocks.rest,
}))
vi.mock('../GummyBear/marchingGummyTargets', () => ({
  createMarchingGummyTargets: mocks.targets,
}))

function harness() {
  const resources: { destroy: ReturnType<typeof vi.fn> }[] = []
  const pipelines: { drawIndirect: ReturnType<typeof vi.fn> }[] = []
  const resource = () => {
    const value = {
      destroy: vi.fn(),
      write: vi.fn(),
      createView: () => ({}),
      $usage: () => value,
    }
    resources.push(value)
    return value
  }
  const copyTextureToTexture = vi.fn()
  const beginRenderPass = vi.fn(() => ({ end: vi.fn() }))
  const device = {
    createSampler: () => ({}),
    createTexture: resource,
    createCommandEncoder: () => ({
      beginRenderPass,
      copyTextureToTexture,
      finish: () => ({}),
    }),
    queue: { submit: vi.fn() },
  }
  const root = {
    device,
    with: () => root,
    createBuffer: resource,
    createBindGroup: () => ({}),
    unwrap: (value: unknown) => value,
    createRenderPipeline: () => {
      const pipeline = {
        with: () => pipeline,
        draw: vi.fn(),
        drawIndirect: vi.fn(),
      }
      pipelines.push(pipeline)
      return pipeline
    },
  }
  const rest = {
    meshes: new Map(
      GUMMY_BOARD_MOULDS.map((mould) => [
        mould,
        { vertices: {}, vertexCount: 12 },
      ]),
    ),
    destroy: vi.fn(),
  }
  const targets = { destroy: vi.fn() }
  mocks.rest.mockResolvedValue(rest)
  mocks.targets.mockReturnValue(targets)
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    context: {
      getCurrentTexture: () => ({ createView: () => ({}) }),
    } as unknown as GPUCanvasContext,
    resources,
    copyTextureToTexture,
    beginRenderPass,
    pipelines,
    rest,
    targets,
  }
}
const input = (destroy = vi.fn()): GummyBoardParticleState => ({
  positions: {
    destroy,
  } as unknown as GummyBoardParticleState['positions'],
  restPositions: new Float32Array([0, 0, 0, 1]),
  particleCount: 1,
  spacing: 0.08,
  gridBounds: { min: [-4.32, -0.32, -3.84], max: [3.36, 7.36, 3.84] },
  cellSize: 0.08,
  maxVertices: 120000,
})
const surface = () => ({
  vertices: { identity: Symbol('surface vertices') },
  indirect: { identity: Symbol('surface indirect draw') },
  cellSize: 0.08,
  encode: vi.fn(),
  destroy: vi.fn(),
  readStats: vi.fn(() => Promise.resolve({ vertexCount: 24 })),
})
const frame = {
  width: 100,
  height: 100,
  viewProjection: new Float32Array(16),
  inverseViewProjection: new Float32Array(16),
  eye: new Float32Array([0, 2, 5]),
}
const options = (): GummyBoardRenderOptions => ({
  pieces: [],
  victimId: 21,
  victimPosition: [0.8, 0, 0.8],
  revision: 1,
  secondary: { id: 1, position: [0.8, 0, 0.8], side: 1, revision: 1 },
})

beforeEach(() => {
  vi.stubGlobal('GPUTextureUsage', {
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 4,
    COPY_SRC: 1,
    COPY_DST: 2,
  })
  mocks.surfaces.mockReset()
  mocks.rest.mockReset()
  mocks.targets.mockReset()
})

describe('two live gummy board surfaces', () => {
  it('uses independent reconstruction inputs and revisions while drawing both in every optical pass', async () => {
    const pawnDestroy = vi.fn(),
      rookDestroy = vi.fn()
    const test = harness(),
      pawn = surface(),
      rook = surface(),
      pawnInput = input(pawnDestroy),
      rookInput = input(rookDestroy)
    mocks.surfaces.mockReturnValueOnce(pawn).mockReturnValueOnce(rook)
    const renderer = await createGummyBoardRenderer(
      test.root,
      test.device,
      test.context,
      'bgra8unorm',
      pawnInput,
      rookInput,
    )
    expect(mocks.surfaces.mock.calls[0]![2]).toBe(pawnInput)
    expect(mocks.surfaces.mock.calls[1]![2]).toBe(rookInput)
    const settings = options()
    renderer.render(frame, settings)
    for (const pipeline of test.pipelines.slice(0, 4))
      expect(pipeline.drawIndirect).toHaveBeenCalledWith(rook.indirect)
    renderer.render(frame, settings)
    expect(pawn.encode).toHaveBeenCalledOnce()
    expect(rook.encode).toHaveBeenCalledOnce()
    settings.secondary!.revision = 2
    renderer.render(frame, settings)
    expect(pawn.encode).toHaveBeenCalledOnce()
    expect(rook.encode).toHaveBeenCalledTimes(2)
    expect(await renderer.readSecondarySurfaceStats()).toEqual({
      vertexCount: 24,
    })
    renderer.destroy()
    renderer.destroy()
    expect(pawn.destroy).toHaveBeenCalledOnce()
    expect(rook.destroy).toHaveBeenCalledOnce()
    expect(test.rest.destroy).toHaveBeenCalledOnce()
    expect(test.targets.destroy).toHaveBeenCalledOnce()
    for (const resource of test.resources)
      expect(resource.destroy).toHaveBeenCalledOnce()
    expect(pawnDestroy).not.toHaveBeenCalled()
    expect(rookDestroy).not.toHaveBeenCalled()
  })

  it('preserves the single-surface API and rejects an unallocated secondary surface', async () => {
    const test = harness(),
      pawn = surface()
    mocks.surfaces.mockReturnValueOnce(pawn)
    const renderer = await createGummyBoardRenderer(
      test.root,
      test.device,
      test.context,
      'bgra8unorm',
      input(),
    )
    const settings = options()
    delete settings.secondary
    renderer.render(frame, settings)
    expect(mocks.surfaces).toHaveBeenCalledOnce()
    expect(await renderer.readSecondarySurfaceStats()).toBeUndefined()
    for (const pipeline of test.pipelines.slice(0, 4))
      expect(pipeline.drawIndirect).toHaveBeenCalledTimes(1)
    expect(() => {
      renderer.render(frame, options())
    }).toThrow(/second gummy surface/)
    renderer.destroy()
    expect(pawn.destroy).toHaveBeenCalledOnce()
  })

  it('releases the pawn and cached moulds if allocating the second surface fails', async () => {
    const test = harness(),
      pawn = surface()
    mocks.surfaces.mockReturnValueOnce(pawn).mockImplementationOnce(() => {
      throw new Error('Surface allocation failed')
    })
    await expect(
      createGummyBoardRenderer(
        test.root,
        test.device,
        test.context,
        'bgra8unorm',
        input(),
        input(),
      ),
    ).rejects.toThrow('Surface allocation failed')
    expect(pawn.destroy).toHaveBeenCalledOnce()
    expect(test.rest.destroy).toHaveBeenCalledOnce()
    for (const resource of test.resources)
      expect(resource.destroy).toHaveBeenCalledOnce()
  })
  it('reuses waiting-piece lighting and uploads during camera motion, invalidating palettes and poses', async () => {
    const test = harness(),
      pawn = surface()
    mocks.surfaces.mockReturnValueOnce(pawn)
    const renderer = await createGummyBoardRenderer(
      test.root,
      test.device,
      test.context,
      'bgra8unorm',
      input(),
      undefined,
      { lightResolution: 512 },
    )
    const settings = options()
    delete settings.secondary
    settings.pieces = GUMMY_BOARD_MOULDS.map((mould, id) => ({
      id,
      mould,
      side: 0,
      position: [id, 0, 0],
      scale: 0.9,
      palette: 'amber',
    }))
    renderer.render(frame, settings)
    const shadow = test.pipelines[3]!.drawIndirect
    expect(shadow).toHaveBeenCalledTimes(7)
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(1)
    const writes = test.resources.map(
      (resource) =>
        ('write' in resource
          ? (resource.write as ReturnType<typeof vi.fn>)
          : undefined
        )?.mock.calls.length ?? 0,
    )
    renderer.render({ ...frame, eye: new Float32Array([1, 2, 5]) }, settings)
    expect(shadow).toHaveBeenCalledTimes(7)
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(1)
    const changedWrites = test.resources.filter(
      (resource, index) =>
        'write' in resource &&
        (resource.write as ReturnType<typeof vi.fn>).mock.calls.length !==
          writes[index],
    )
    expect(changedWrites).toHaveLength(1)
    settings.revision = 2
    renderer.render(frame, settings)
    expect(shadow).toHaveBeenCalledTimes(8)
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(2)
    settings.pieces = settings.pieces.map((piece) =>
      piece.id === 0 ? { ...piece, palette: 'berry' } : piece,
    )
    renderer.render(frame, settings)
    expect(shadow).toHaveBeenCalledTimes(15)
    renderer.render({ ...frame, palette: 'lagoon' }, settings)
    expect(shadow).toHaveBeenCalledTimes(22)
    settings.caustics = false
    renderer.render({ ...frame, palette: 'lagoon' }, settings)
    expect(shadow).toHaveBeenCalledTimes(29)
    settings.pieces = settings.pieces.map((piece) =>
      piece.id === 0 ? { ...piece, position: [1, 0, 1] } : piece,
    )
    renderer.render({ ...frame, palette: 'lagoon' }, settings)
    expect(shadow).toHaveBeenCalledTimes(36)
    renderer.destroy()
  })

  it('keeps waiting-piece light cached while a driven rook moves, recolours or changes scale', async () => {
    const test = harness(),
      pawn = surface()
    mocks.surfaces.mockReturnValueOnce(pawn)
    const renderer = await createGummyBoardRenderer(
      test.root,
      test.device,
      test.context,
      'bgra8unorm',
      input(),
    )
    const settings = options()
    delete settings.secondary
    settings.pieces = [
      { id: 1, mould: 'rook', side: 1, position: [-2.4, 0, 0.8] },
      { id: 2, mould: 'knight', side: 0, position: [4, 0, 4] },
    ]
    settings.movingPieceId = 1
    renderer.render(frame, settings)
    expect(renderer.readRenderStats()).toMatchObject({
      staticLightUpdates: 1,
      dynamicLightUpdates: 1,
    })
    settings.pieces = [
      {
        ...settings.pieces[0]!,
        position: [0.8, 0, 0.8],
        palette: 'berry',
        scale: 0.9,
      },
      settings.pieces[1]!,
    ]
    renderer.render(frame, settings)
    expect(renderer.readRenderStats()).toMatchObject({
      staticLightUpdates: 1,
      dynamicLightUpdates: 2,
      staticLightCacheHits: 1,
    })
    settings.selectedPieceId = 1
    renderer.render(frame, settings)
    expect(renderer.readRenderStats()).toMatchObject({
      staticLightUpdates: 1,
      dynamicLightUpdates: 2,
      lightCacheHits: 1,
    })
    settings.victimPalette = 'amber'
    settings.victimScale = 0.9
    renderer.render(frame, settings)
    expect(renderer.readRenderStats()).toMatchObject({
      staticLightUpdates: 1,
      dynamicLightUpdates: 3,
    })
    renderer.destroy()
  })
})
