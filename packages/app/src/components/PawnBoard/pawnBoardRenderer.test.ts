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
  }
}

const points = new Float32Array([0, 0.9, 0, 1])
const colours = new Float32Array([0.02, 0.18, 0.65, 1])
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
