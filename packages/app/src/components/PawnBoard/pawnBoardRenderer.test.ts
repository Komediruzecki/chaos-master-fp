/** Validate real renderer pass compatibility, cached resources, and allocation rollback without a GPU. */
import { d } from 'typegpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPawnBoardCloud } from './pawnBoardCloud'
import { createPawnBoardRenderer } from './pawnBoardRenderer'
import type { TgpuRoot } from 'typegpu'
import type { BoardFrame } from './pawnBoardRenderer'

type View = { format: GPUTextureFormat; sampleCount: number }
type Pass = { descriptor: GPURenderPassDescriptor; end(): void }

function harness() {
  const buffers: {
    destroy: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    initial?: unknown
  }[] = []
  const textures: { destroy: ReturnType<typeof vi.fn>; view: View }[] = []
  const passes: Pass[] = []
  const draws: {
    vertices: number
    instances: number
    bound: unknown[]
    blend?: GPUBlendState
  }[] = []
  const bindings: { entries: Record<string, unknown> }[] = []
  let failBinding = false
  let failTexture = false
  let buffersUntilFailure = Infinity
  const pipeline = (
    config: GPURenderPipelineDescriptor,
    pass?: Pass,
    bound: unknown[] = [],
  ): object => ({
    with(resource: unknown, value?: unknown) {
      if (
        typeof resource === 'object' &&
        resource !== null &&
        'descriptor' in resource
      )
        return pipeline(config, resource as Pass, bound)
      return pipeline(config, pass, [...bound, resource, value])
    },
    draw(vertices: number, instances = 1) {
      if (!pass) throw new Error('Draw without render pass')
      const blend = Array.from(config.fragment?.targets ?? [])[0]?.blend
      draws.push({ vertices, instances, bound, blend })
      // Every current pass reads the camera, including the inspection backdrop.
      expect(
        bound.some(
          (group) =>
            typeof group === 'object' &&
            group !== null &&
            'entries' in group &&
            typeof group.entries === 'object' &&
            group.entries !== null &&
            'camera' in group.entries,
        ),
      ).toBe(true)
      const attachment = Array.from(pass.descriptor.colorAttachments)[0]!
      if (!attachment) throw new Error('Missing attachment')
      const view = attachment.view as unknown as View
      expect(config.multisample?.count ?? 1).toBe(view.sampleCount)
      const targets = config.fragment?.targets ?? []
      expect(Array.from(targets)[0]?.format).toBe(view.format)
      if (pass.descriptor.depthStencilAttachment) {
        const depth = pass.descriptor.depthStencilAttachment
          .view as unknown as View
        expect(config.depthStencil?.format).toBe(depth.format)
      } else expect(config.depthStencil).toBeUndefined()
    },
  })
  const root = {
    createBuffer(_schema: unknown, initial?: unknown) {
      if (buffersUntilFailure-- === 0) {
        buffersUntilFailure = Infinity
        throw new Error('buffer allocation failed')
      }
      const buffer = {
        destroy: vi.fn(),
        write: vi.fn(),
        initial,
        $usage() {
          return buffer
        },
      }
      buffers.push(buffer)
      if (typeof initial === 'function') initial(buffer)
      return buffer
    },
    createBindGroup(_layout: unknown, entries: Record<string, unknown>) {
      if (failBinding) throw new Error('binding allocation failed')
      const binding = { entries }
      bindings.push(binding)
      return binding
    },
    createRenderPipeline(config: Record<string, unknown>) {
      // TypeGPU's shorthand targets become a native fragment target record.
      return pipeline({
        ...config,
        fragment: { targets: [config.targets] },
      } as unknown as GPURenderPipelineDescriptor)
    },
    unwrap: vi.fn(),
    '~unstable': {
      createCommandEncoder() {
        return {
          beginRenderPass(descriptor: GPURenderPassDescriptor) {
            const pass = { descriptor, end: vi.fn() }
            passes.push(pass)
            return pass
          },
          submit: vi.fn(),
        }
      },
    },
  }
  const device = {
    createSampler: vi.fn(() => ({})),
    createTexture(descriptor: GPUTextureDescriptor) {
      if (failTexture) throw new Error('texture allocation failed')
      const view = {
        format: descriptor.format,
        sampleCount: descriptor.sampleCount ?? 1,
      }
      const texture = {
        destroy: vi.fn(),
        view,
        createView() {
          return view
        },
      }
      textures.push(texture)
      return texture
    },
  }
  const context = { format: 'bgra8unorm', sampleCount: 1 }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    context: context as unknown as GPUCanvasContext,
    buffers,
    textures,
    passes,
    draws,
    bindings,
    failBinding() {
      failBinding = true
    },
    failTexture() {
      failTexture = true
    },
    failBufferAfter(count: number) {
      buffersUntilFailure = count
    },
  }
}

const points = new Float32Array([0, 0.9, 0, 1])
const colours = new Float32Array([0.02, 0.18, 0.65, 1])
const glassTriangle = new Float32Array([
  0, 0, 0, 0, 0, 1, 0.4, 0, 0, 0, 0, 1, 0, 0.4, 0, 0, 0, 1,
])
const frame = (): BoardFrame => ({
  width: 320,
  height: 240,
  eye: new Float32Array([0, 2, 4, 1]),
  viewProjection: new Float32Array(Array.from(d.mat4x4f())),
  pieces: [{ position: [0, 0.09, 0], side: 'light', selected: false, age: -1 }],
  legal: [],
  inspection: true,
})

function cloudDraws(state: ReturnType<typeof harness>) {
  return state.draws.filter((draw) =>
    draw.bound.some((bound) =>
      state.bindings.some(
        (binding) => binding === bound && 'points' in binding.entries,
      ),
    ),
  )
}

describe('fractal board variant clouds', () => {
  function setup() {
    const state = harness()
    const renderer = createPawnBoardRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    return { state, renderer }
  }

  it('bounds collection opacity while preserving the enclosed additive cloud profile', () => {
    const { state, renderer } = setup()
    renderer.setCloud('light', points, colours)
    renderer.setVariantCloud('study', 'light', points, colours)
    const settings = state.bindings
      .filter((binding) => 'points' in binding.entries)
      .map(
        (binding) => (binding.entries.settings as { initial: unknown }).initial,
      )
    expect(settings).toEqual([
      [0.11, 2.85, 1, 0],
      [0.36, 2.2, 1, 1.6],
    ])
    const base = frame()
    renderer.render({
      ...base,
      pieces: [base.pieces[0]!, { ...base.pieces[0]!, cloudKey: 'study' }],
    })
    expect(
      cloudDraws(state).map((draw) => draw.blend?.color.dstFactor),
    ).toEqual(['one', 'one-minus-src-alpha'])
    renderer.destroy()
  })

  it('opts into the muted collection board without changing the next legacy frame', () => {
    const { state, renderer } = setup()
    const camera = state.buffers[0]!
    renderer.render({ ...frame(), inspection: false, mutedBoard: true })
    const muted = new Float32Array(
      camera.write.mock.calls.at(-1)![0] as ArrayBuffer,
    )
    expect(muted[22]).toBe(0)
    expect(muted[25]).toBe(1)
    renderer.render({ ...frame(), inspection: false })
    const normal = new Float32Array(
      camera.write.mock.calls.at(-1)![0] as ArrayBuffer,
    )
    expect(normal[25]).toBe(0)
    renderer.destroy()
  })

  it('batches repeated shapes by key alongside the original side cloud, with independent scale', () => {
    const { state, renderer } = setup()
    renderer.setCloud('light', points, colours)
    renderer.setVariantCloud('coral-pawn', 'dark', points, colours)
    const variantBuffer = state.buffers.at(-1)!
    renderer.setVariantCloud(
      'coral-rook',
      'light',
      new Float32Array([0, 1, 0, 1, 0.2, 1, 0, 1]),
    )
    const base = frame()
    renderer.render({
      ...base,
      showGlass: false,
      pieces: [
        base.pieces[0]!,
        { ...base.pieces[0]!, cloudKey: 'coral-pawn', scale: 0.9 },
        {
          ...base.pieces[0]!,
          cloudKey: 'coral-pawn',
          position: [1.6, 0.09, 0],
          scale: 0.85,
          colorMultiplier: [1.06, 0.97, 0.95],
        },
        { ...base.pieces[0]!, cloudKey: 'coral-rook' },
      ],
    })
    expect(
      cloudDraws(state).map(({ vertices, instances }) => [vertices, instances]),
    ).toEqual([
      [6, 1],
      [6, 2],
      [12, 1],
    ])
    const data = new Float32Array(
      variantBuffer.write.mock.calls[0]![0] as ArrayBuffer,
    )
    expect(data[3]).toBeCloseTo(0.9)
    expect(data[12]).toBeCloseTo(1.6)
    expect(data[15]).toBeCloseTo(0.85)
    expect(Array.from(data.subarray(16, 19))).toEqual([
      Math.fround(1.06),
      Math.fround(0.97),
      Math.fround(0.95),
    ])
    expect(data[11]).toBe(0)
    expect(data[23]).toBe(1)
    const bufferCount = state.buffers.length
    const bindingCount = state.bindings.length
    state.draws.length = 0
    renderer.render({ ...base, showGlass: false })
    expect(cloudDraws(state).map(({ instances }) => instances)).toEqual([1])
    expect(state.buffers).toHaveLength(bufferCount)
    expect(state.bindings).toHaveLength(bindingCount)
    renderer.destroy()
  })

  it('never wraps study clouds in the legacy pawn shell or falls back for missing keys', () => {
    const { state, renderer } = setup()
    const base = frame()
    renderer.setVariantCloud('study', 'light', points, colours)
    renderer.render({
      ...base,
      pieces: [{ ...base.pieces[0]!, cloudKey: 'study' }],
    })
    expect(state.passes).toHaveLength(3)
    expect(() => {
      renderer.render({
        ...base,
        pieces: [{ ...base.pieces[0]!, cloudKey: 'missing' }],
      })
    }).toThrow('Missing board variant cloud: missing')
    expect(() => {
      renderer.render({
        ...base,
        pieces: [{ ...base.pieces[0]!, cloudKey: 'study', scale: NaN }],
      })
    }).toThrow('finite and positive')
    renderer.destroy()
  })

  it('bounds collection slots and releases replacement and cleared buffers exactly once', () => {
    const { state, renderer } = setup()
    renderer.setCloud('light', points, colours)
    const fixedCount = state.buffers.length
    for (let n = 0; n < 12; n++)
      renderer.setVariantCloud(`role-${n}`, 'light', points, colours)
    const allocated = state.buffers.length
    expect(() => {
      renderer.setVariantCloud('overflow', 'light', points, colours)
    }).toThrow('variant cloud capacity')
    expect(state.buffers).toHaveLength(allocated)
    const replaced = state.buffers.slice(fixedCount, fixedCount + 5)
    renderer.setVariantCloud('role-0', 'light', points, colours)
    for (const buffer of replaced) expect(buffer.destroy).toHaveBeenCalledOnce()
    renderer.clearVariantClouds()
    renderer.clearVariantClouds()
    for (const buffer of state.buffers.slice(fixedCount))
      expect(buffer.destroy).toHaveBeenCalledOnce()
    for (const buffer of state.buffers.slice(0, fixedCount))
      expect(buffer.destroy).not.toHaveBeenCalled()
    renderer.render({ ...frame(), showGlass: false })
    expect(cloudDraws(state).map(({ instances }) => instances)).toEqual([1])
    renderer.destroy()
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })

  it('retains the previous slot after an upload failure and frees the failed allocation', () => {
    const { state, renderer } = setup()
    renderer.setVariantCloud('study', 'light', points, colours)
    const nextFrame = {
      ...frame(),
      pieces: [{ ...frame().pieces[0]!, cloudKey: 'study' }],
    }
    renderer.render(nextFrame)
    const before = state.buffers.length
    state.failBinding()
    expect(() => {
      renderer.setVariantCloud('study', 'light', points, colours)
    }).toThrow('binding allocation failed')
    for (const buffer of state.buffers.slice(0, before))
      expect(buffer.destroy).not.toHaveBeenCalled()
    for (const buffer of state.buffers.slice(before))
      expect(buffer.destroy).toHaveBeenCalledOnce()
    state.draws.length = 0
    renderer.render(nextFrame)
    expect(cloudDraws(state).map(({ instances }) => instances)).toEqual([1])
    renderer.destroy()
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })
})

describe('fractal study glass envelopes', () => {
  function setup() {
    const state = harness()
    const renderer = createPawnBoardRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    return { state, renderer }
  }

  it('draws the same cloud with or without its envelope and shares optical passes with legacy pawns', () => {
    const { state, renderer } = setup()
    renderer.setCloud('light', points, colours)
    renderer.setVariantCloud('fern', 'light', points, colours)
    renderer.setVariantGlass('fern-lens', glassTriangle, 0.7)
    const envelopeInstances = state.buffers.at(-1)!
    const base = frame().pieces[0]!
    renderer.render({
      ...frame(),
      pieces: [
        base,
        { ...base, cloudKey: 'fern', position: [1.6, 0.09, 0] },
        {
          ...base,
          cloudKey: 'fern',
          glassKey: 'fern-lens',
          position: [3.2, 0.09, 0],
          scale: 0.9,
        },
        {
          ...base,
          cloudKey: 'fern',
          glassKey: 'fern-lens',
          position: [4.8, 0.09, 0],
          scale: 0.8,
        },
      ],
    })
    expect(state.passes).toHaveLength(4)
    expect(
      cloudDraws(state).map(({ vertices, instances }) => [vertices, instances]),
    ).toEqual([
      [6, 1],
      [6, 3],
    ])
    expect(
      state.draws
        .filter((draw) => draw.bound.includes(envelopeInstances))
        .map(({ vertices, instances }) => [vertices, instances]),
    ).toEqual([
      [3, 2],
      [3, 2],
    ])
    const data = new Float32Array(
      envelopeInstances.write.mock.calls[0]![0] as ArrayBuffer,
    )
    expect([data[10], data[22]]).toEqual([2, 3])
    const camera = new Float32Array(
      state.buffers[0]!.write.mock.calls.at(-1)![0] as ArrayBuffer,
    )
    expect(camera[24]).toBe(3)
    expect(Array.from(camera.subarray(28, 32))).toEqual([
      0,
      Math.fround(0.09),
      0,
      Math.fround(0.67),
    ])
    expect(Array.from(camera.subarray(32, 36))).toEqual([
      Math.fround(3.2),
      Math.fround(0.09),
      0,
      Math.fround(0.63),
    ])
    expect(Array.from(camera.subarray(36, 40))).toEqual([
      Math.fround(4.8),
      Math.fround(0.09),
      0,
      Math.fround(0.56),
    ])
    renderer.destroy()
  })

  it('changes pure, enclosed and hidden views without allocating, retaining only current instances', () => {
    const { state, renderer } = setup()
    renderer.setVariantCloud('fern', 'light', points, colours)
    renderer.setVariantGlass('fern-lens', glassTriangle, 0.7)
    const envelopeInstances = state.buffers.at(-1)!
    const base = { ...frame().pieces[0]!, cloudKey: 'fern' }
    renderer.render({
      ...frame(),
      pieces: [{ ...base, glassKey: 'fern-lens' }],
    })
    const counts = [
      state.buffers.length,
      state.textures.length,
      state.bindings.length,
    ]
    for (const appearance of ['pure', 'glass', 'hidden', 'pure']) {
      state.draws.length = 0
      state.passes.length = 0
      renderer.render({
        ...frame(),
        showGlass: appearance !== 'hidden',
        pieces: [
          {
            ...base,
            glassKey: appearance === 'pure' ? undefined : 'fern-lens',
          },
        ],
      })
      expect([
        state.buffers.length,
        state.textures.length,
        state.bindings.length,
      ]).toEqual(counts)
      expect(
        cloudDraws(state).map(({ vertices, instances }) => [
          vertices,
          instances,
        ]),
      ).toEqual([[6, 1]])
      expect(
        state.draws.filter((draw) => draw.bound.includes(envelopeInstances)),
      ).toHaveLength(appearance === 'glass' ? 2 : 0)
      expect(state.passes).toHaveLength(appearance === 'glass' ? 4 : 3)
    }
    renderer.destroy()
  })

  it('bounds shared shell slots and releases replacement, clear and destroy allocations exactly once', () => {
    const { state, renderer } = setup()
    const fixedCount = state.buffers.length
    for (const key of ['fern', 'bishop', 'rook'])
      renderer.setVariantGlass(key, glassTriangle, 0.7)
    const allocated = state.buffers.length
    expect(() => {
      renderer.setVariantGlass('fourth', glassTriangle, 0.7)
    }).toThrow('variant glass capacity')
    expect(state.buffers).toHaveLength(allocated)
    renderer.setVariantGlass('fern', glassTriangle, 0.75)
    for (const buffer of state.buffers.slice(fixedCount, fixedCount + 4))
      expect(buffer.destroy).toHaveBeenCalledOnce()
    renderer.clearVariantGlass()
    renderer.clearVariantGlass()
    for (const buffer of state.buffers.slice(fixedCount))
      expect(buffer.destroy).toHaveBeenCalledOnce()
    renderer.destroy()
    renderer.destroy()
    renderer.setVariantGlass('disposed', glassTriangle, 0.7)
    expect(state.buffers).toHaveLength(allocated + 4)
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })

  it('rejects invalid meshes before allocating and preserves the prior mesh after failed replacement', () => {
    const { state, renderer } = setup()
    const fixedCount = state.buffers.length
    for (const vertices of [
      new Float32Array(),
      glassTriangle.subarray(0, 12),
      new Float32Array(18).fill(NaN),
      new Float32Array(18),
      new Float32Array(120_003 * 6),
    ])
      expect(() => {
        renderer.setVariantGlass('invalid', vertices, 0.7)
      }).toThrow()
    for (const radius of [NaN, Infinity, 0, -1])
      expect(() => {
        renderer.setVariantGlass('invalid', glassTriangle, radius)
      }).toThrow('radius')
    expect(() => {
      renderer.setVariantGlass(' ', glassTriangle, 0.7)
    }).toThrow('nonempty')
    expect(state.buffers).toHaveLength(fixedCount)
    renderer.setVariantGlass('fern', glassTriangle, 0.7)
    const original = state.buffers.slice(fixedCount)
    for (const completedAllocations of [0, 1, 2, 3]) {
      const before = state.buffers.length
      state.failBufferAfter(completedAllocations)
      expect(() => {
        renderer.setVariantGlass('fern', glassTriangle, 0.8)
      }).toThrow('buffer allocation failed')
      expect(state.buffers.length - before).toBe(completedAllocations)
      for (const buffer of state.buffers.slice(before))
        expect(buffer.destroy).toHaveBeenCalledOnce()
    }
    for (const buffer of original) expect(buffer.destroy).not.toHaveBeenCalled()
    renderer.render({
      ...frame(),
      pieces: [{ ...frame().pieces[0]!, glassKey: 'fern' }],
    })
    expect(
      state.draws.filter((draw) => draw.bound.includes(original[3]!)),
    ).toHaveLength(2)
    renderer.destroy()
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })

  it('uses distinct IDs through the 32-piece limit and rejects missing shells', () => {
    const { state, renderer } = setup()
    renderer.setVariantGlass('fern', glassTriangle, 0.7)
    const instanceBuffer = state.buffers.at(-1)!
    const base = frame().pieces[0]!
    const pieces = [
      base,
      ...Array.from({ length: 31 }, () => ({ ...base, glassKey: 'fern' })),
    ]
    renderer.render({ ...frame(), pieces })
    const data = new Float32Array(
      instanceBuffer.write.mock.calls[0]![0] as ArrayBuffer,
    )
    expect(
      Array.from({ length: 31 }, (_, index) => data[index * 12 + 10]),
    ).toEqual(Array.from({ length: 31 }, (_, index) => index + 2))
    expect(
      new Float32Array(
        state.buffers[0]!.write.mock.calls.at(-1)![0] as ArrayBuffer,
      )[24],
    ).toBe(32)
    expect(() => {
      renderer.render({ ...frame(), pieces: [...pieces, base] })
    }).toThrow('instance capacity')
    expect(() => {
      renderer.render({
        ...frame(),
        pieces: [{ ...base, glassKey: 'missing' }],
      })
    }).toThrow('Missing board variant glass')
    renderer.destroy()
  })

  it('batches exact shell fragments independently of point age and keeps only intact shells in optics', () => {
    const { state, renderer } = setup()
    renderer.setVariantCloud('fern', 'light', points, colours)
    renderer.setVariantGlass('lens', glassTriangle, 0.7)
    const [mesh, fragments, fragmentInstances, intactInstances] =
      state.buffers.slice(-4)
    const base = { ...frame().pieces[0]!, cloudKey: 'fern', glassKey: 'lens' }
    renderer.render({
      ...frame(),
      pieces: [
        { ...base, age: 0.8 },
        {
          ...base,
          age: -1,
          glassAge: 0.4,
          position: [1.6, 0.09, 0],
          scale: 0.9,
          colorMultiplier: [0.6, 0.8, 1],
        },
        { ...base, age: 0.7, glassAge: 0.7 },
        { ...base, age: 1.7, glassAge: 1.7 },
      ],
    })
    expect(
      state.draws
        .filter((draw) => draw.bound.includes(mesh))
        .map((draw) => draw.instances),
    ).toEqual([1, 1])
    expect(
      state.draws
        .filter((draw) => draw.bound.includes(fragments))
        .map((draw) => [draw.vertices, draw.instances]),
    ).toEqual([[3, 2]])
    expect(
      new Float32Array(
        intactInstances!.write.mock.calls[0]![0] as ArrayBuffer,
      )[10],
    ).toBe(1)
    const data = new Float32Array(
      fragmentInstances!.write.mock.calls[0]![0] as ArrayBuffer,
    )
    expect(Array.from(data.subarray(0, 9))).toEqual(
      [1.6, 0.09, 0, 0.9, 0.6, 0.8, 1, 1, 0.4].map(Math.fround),
    )
    expect(data[20]).toBeCloseTo(0.7)
    expect(
      new Float32Array(
        state.buffers[0]!.write.mock.calls.at(-1)![0] as ArrayBuffer,
      )[24],
    ).toBe(1)
    renderer.destroy()
  })

  it('reuses all resources through fracture, expiry and reset, and hides fragments with glass', () => {
    const { state, renderer } = setup()
    renderer.setVariantCloud('fern', 'light', points, colours)
    renderer.setVariantGlass('lens', glassTriangle, 0.7)
    const [mesh, fragments] = state.buffers.slice(-4)
    const base = { ...frame().pieces[0]!, cloudKey: 'fern', glassKey: 'lens' }
    renderer.render({ ...frame(), pieces: [base] })
    const counts = [
      state.buffers.length,
      state.textures.length,
      state.bindings.length,
    ]
    for (const [glassAge, showGlass, intact, fractured] of [
      [0, true, false, true],
      [0.8, true, false, true],
      [1.69, true, false, true],
      [1.7, true, false, false],
      [-1, true, true, false],
      [0.3, false, false, false],
    ] as const) {
      state.draws.length = 0
      renderer.render({
        ...frame(),
        showGlass,
        pieces: [{ ...base, glassAge }],
      })
      expect([
        state.buffers.length,
        state.textures.length,
        state.bindings.length,
      ]).toEqual(counts)
      expect(
        state.draws.filter((draw) => draw.bound.includes(mesh)),
      ).toHaveLength(intact ? 2 : 0)
      expect(
        state.draws.filter((draw) => draw.bound.includes(fragments)),
      ).toHaveLength(fractured ? 1 : 0)
    }
    for (const glassAge of [NaN, Infinity, -Infinity])
      expect(() => {
        renderer.render({ ...frame(), pieces: [{ ...base, glassAge }] })
      }).toThrow('fracture age must be finite')
    renderer.destroy()
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })

  it('packs all 32 fractured pieces into one bounded shell batch', () => {
    const { state, renderer } = setup()
    renderer.setVariantGlass('lens', glassTriangle, 0.7)
    const fragmentInstances = state.buffers.at(-2)!
    const base = { ...frame().pieces[0]!, glassKey: 'lens', glassAge: 0.2 }
    renderer.render({
      ...frame(),
      pieces: Array.from({ length: 32 }, (_, index) => ({
        ...base,
        position: [index, 0.09, 0] as const,
      })),
    })
    expect(
      state.draws
        .filter((draw) => draw.bound.includes(fragmentInstances))
        .map((draw) => draw.instances),
    ).toEqual([32])
    const data = new Float32Array(
      fragmentInstances.write.mock.calls[0]![0] as ArrayBuffer,
    )
    expect(data.length).toBe(32 * 12)
    expect(data[31 * 12]).toBe(31)
    expect(data[31 * 12 + 8]).toBeCloseTo(0.2)
    renderer.destroy()
  })
})

beforeEach(() =>
  vi.stubGlobal('GPUTextureUsage', {
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 4,
  }),
)
afterEach(() => vi.unstubAllGlobals())

describe('pawn glass render attachments and resources', () => {
  it('matches all pipeline/pass formats and sample counts, with separate scene and optical targets', () => {
    const state = harness()
    const renderer = createPawnBoardRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    renderer.setCloud('light', points, colours)
    renderer.render(frame())
    expect(state.passes).toHaveLength(4)
    const source = Array.from(state.passes[0]!.descriptor.colorAttachments)[0]!
    const optical = Array.from(state.passes[2]!.descriptor.colorAttachments)[0]!
    expect(source.resolveTarget).not.toBe(optical.resolveTarget)
    expect(
      state.passes[1]!.descriptor.depthStencilAttachment?.depthLoadOp,
    ).toBe('clear')
    const bindingCount = state.bindings.length
    renderer.render(frame())
    expect(state.textures).toHaveLength(6)
    expect(state.bindings).toHaveLength(bindingCount)
    renderer.destroy()
    for (const resource of [...state.textures, ...state.buffers])
      expect(resource.destroy).toHaveBeenCalledOnce()
  })

  it('resizes atomically, omits the exit pass when glass is hidden, and disposes idempotently', () => {
    const state = harness()
    const renderer = createPawnBoardRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    renderer.render({ ...frame(), showGlass: false })
    expect(state.passes).toHaveLength(3)
    renderer.render({ ...frame(), width: 640, showGlass: false })
    expect(state.textures).toHaveLength(12)
    for (const resource of state.textures.slice(0, 6))
      expect(resource.destroy).toHaveBeenCalledOnce()
    for (const resource of state.textures.slice(6))
      expect(resource.destroy).not.toHaveBeenCalled()
    renderer.destroy()
    renderer.destroy()
    renderer.render(frame())
    for (const resource of [...state.textures, ...state.buffers])
      expect(resource.destroy).toHaveBeenCalledOnce()
  })

  it('preserves the previous sized targets when a replacement allocation fails', () => {
    const state = harness()
    const renderer = createPawnBoardRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    renderer.render(frame())
    state.failTexture()
    expect(() => {
      renderer.render({ ...frame(), width: 640 })
    }).toThrow('texture allocation failed')
    for (const resource of state.textures)
      expect(resource.destroy).not.toHaveBeenCalled()
    renderer.render(frame())
    renderer.destroy()
  })

  it('rejects malformed clouds before allocation and rolls back buffers after binding failure', () => {
    const state = harness()
    expect(() =>
      createPawnBoardCloud(state.root, 'light', new Float32Array([1, 2, 3])),
    ).toThrow('packed xyzw')
    expect(() =>
      createPawnBoardCloud(
        state.root,
        'light',
        points,
        new Float32Array([2, 0, 0, 1]),
      ),
    ).toThrow('linear RGBA')
    expect(state.buffers).toHaveLength(0)
    state.failBinding()
    expect(() =>
      createPawnBoardCloud(state.root, 'light', points, colours),
    ).toThrow('binding allocation failed')
    expect(state.buffers).toHaveLength(4)
    for (const resource of state.buffers)
      expect(resource.destroy).toHaveBeenCalledOnce()
  })
})
