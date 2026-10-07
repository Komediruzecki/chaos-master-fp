/** Optional live-rook rendering, independent revisions and failure/unmount resource ownership. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BOARD_MOULDS } from './gummyBoardInstances'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import { gummyBoardMaterialLayout } from './gummyBoardShaders'
import { gummyBoardStageLayout } from './gummyBoardStageShaders'
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
  const textures: GPUTextureDescriptor[] = []
  const materialWrites: Float32Array[] = []
  const stageWrites: Float32Array[] = []
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
    createTexture: (descriptor: GPUTextureDescriptor) => {
      textures.push(descriptor)
      return resource()
    },
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
    createBindGroup: (
      layout: unknown,
      bindings: {
        materials?: { write: ReturnType<typeof vi.fn> }
        stage?: { write: ReturnType<typeof vi.fn> }
      },
    ) => {
      if (layout === gummyBoardMaterialLayout)
        bindings.materials!.write.mockImplementation((data: ArrayBuffer) => {
          // Uploads reuse one CPU buffer; snapshot at submission, just as the GPU does.
          materialWrites.push(new Float32Array(data.slice(0)))
        })
      if (layout === gummyBoardStageLayout)
        bindings.stage!.write.mockImplementation((data: ArrayBuffer) => {
          stageWrites.push(new Float32Array(data.slice(0)))
        })
      return {}
    },
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
    textures,
    materialWrites,
    stageWrites,
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
  it('allocates glass transport only when enabled and reuses it across live theme changes', async () => {
    const test = harness()
    mocks.surfaces.mockReturnValueOnce(surface())
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
    expect(test.pipelines).toHaveLength(7)
    expect(test.textures.at(-1)!.size).toEqual([1, 1])
    const initialTextures = test.textures.length
    renderer.render(frame, settings)
    renderer.render(frame, { ...settings, boardTheme: 'lava' })
    renderer.render(frame, {
      ...settings,
      boardTheme: 'glass',
      caustics: false,
    })
    expect(test.textures).toHaveLength(initialTextures)
    expect(test.pipelines).toHaveLength(7)
    expect(renderer.readRenderStats().boardLightUpdates).toBe(0)
    renderer.render(frame, { ...settings, boardTheme: 'glass' })
    expect(test.textures).toHaveLength(initialTextures + 1)
    expect(test.textures.at(-1)!.size).toEqual([512, 512])
    expect(test.pipelines).toHaveLength(8)
    renderer.render(frame, { ...settings, boardTheme: 'classic' })
    renderer.render(frame, {
      ...settings,
      boardTheme: 'glass',
      caustics: false,
    })
    renderer.render(frame, { ...settings, boardTheme: 'glass' })
    expect(test.textures).toHaveLength(initialTextures + 1)
    expect(test.pipelines).toHaveLength(8)
    expect(renderer.readRenderStats().boardLightUpdates).toBe(1)
    renderer.destroy()
    for (const resource of test.resources)
      expect(resource.destroy).toHaveBeenCalledOnce()
  })
  it('caches glass transport across camera/material time and sanitizes molten time independently of physics', async () => {
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
    expect(renderer.readRenderStats().boardLightUpdates).toBe(0)
    renderer.render(frame, {
      ...settings,
      boardTheme: 'glass',
      boardTime: 1.25,
    })
    expect(renderer.readRenderStats().boardLightUpdates).toBe(1)
    expect([...test.stageWrites.at(-1)!.slice(4, 7)]).toEqual([1, 1.25, 1])
    renderer.render(
      { ...frame, eye: new Float32Array([1, 2, 5]) },
      { ...settings, boardTheme: 'glass', boardTime: 2 },
    )
    renderer.render(frame, { ...settings, boardTheme: 'lava', boardTime: NaN })
    expect(test.stageWrites.at(-1)![5]).toBe(0)
    renderer.render(frame, {
      ...settings,
      boardTheme: 'glass',
      boardTime: -5,
      caustics: false,
    })
    expect([...test.stageWrites.at(-1)!.slice(4, 7)]).toEqual([1, 0, 0])
    expect(renderer.readRenderStats().boardLightUpdates).toBe(1)
    expect(pawn.encode).toHaveBeenCalledOnce()
    // A caustics toggle invalidates the existing candy light once; time/camera/theme do not.
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(2)
    renderer.destroy()
  })
  it('indexes supporting density by piece identity and leaves both live surfaces and the moving mould unchanged', async () => {
    const test = harness()
    mocks.surfaces.mockReturnValueOnce(surface()).mockReturnValueOnce(surface())
    const renderer = await createGummyBoardRenderer(
      test.root,
      test.device,
      test.context,
      'bgra8unorm',
      input(),
      input(),
    )
    const settings: GummyBoardRenderOptions = {
      ...options(),
      movingPieceId: 9,
      victimPalette: 'amber',
      pieces: [
        {
          id: 2047,
          mould: 'king',
          position: [0, 0, 0],
          side: 1,
          palette: 'blue',
          scale: 0.9,
        },
        {
          id: 9,
          mould: 'rook',
          position: [1, 0, 0],
          side: 0,
          palette: 'candy',
        },
        {
          id: 0,
          mould: 'pawn',
          position: [2, 0, 0],
          side: 0,
          palette: 'berry',
        },
      ],
    }
    renderer.render(frame, settings)
    const baseline = test.materialWrites.at(-1)!
    expect(
      [...baseline]
        .filter((_, index) => index % 4 === 3)
        .every((value) => value === 0),
    ).toBe(true)
    expect([...baseline.slice(2047 * 4, 2047 * 4 + 3)]).toEqual([
      1,
      1,
      Math.fround(0.9),
    ])
    expect([...baseline.slice(0, 3)]).toEqual([3, 0, 1])

    renderer.render(frame, { ...settings, supportingDensity: 1.8 })
    const denser = test.materialWrites.at(-1)!
    expect(
      [...denser].flatMap((value, index) =>
        value === baseline[index] ? [] : index,
      ),
    ).toEqual([3, 2047 * 4 + 3])
    expect(denser[3]).toBe(Math.fround(1.8))
    expect(denser[2047 * 4 + 3]).toBe(Math.fround(1.8))
    for (const id of [
      settings.victimId,
      settings.secondary!.id,
      settings.movingPieceId!,
    ])
      expect([...denser.slice(id * 4, id * 4 + 4)]).toEqual([
        ...baseline.slice(id * 4, id * 4 + 4),
      ])

    renderer.render(frame, settings)
    expect(test.materialWrites.at(-1)).toEqual(baseline)
    renderer.destroy()
  })
  it('changes board materials through one uniform without rebuilding candy or piece lighting', async () => {
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
    const writeCounts = () =>
      test.resources.map((resource) =>
        'write' in resource
          ? (resource.write as ReturnType<typeof vi.fn>).mock.calls.length
          : 0,
      )
    let previous = writeCounts()
    const resourceCount = test.resources.length
    for (const boardTheme of ['glass', 'lava', 'classic'] as const) {
      renderer.render(frame, { ...settings, boardTheme })
      const counts = writeCounts()
      expect(
        counts.filter((value, index) => value !== (previous[index] ?? 0)),
      ).toHaveLength(1)
      previous = counts
      expect(pawn.encode).toHaveBeenCalledOnce()
      expect(test.copyTextureToTexture).toHaveBeenCalledOnce()
      expect(test.resources).toHaveLength(resourceCount + 1)
    }
    renderer.destroy()
  })
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
