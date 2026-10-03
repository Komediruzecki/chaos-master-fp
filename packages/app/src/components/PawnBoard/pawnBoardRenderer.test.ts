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
  }[] = []
  const textures: { destroy: ReturnType<typeof vi.fn>; view: View }[] = []
  const passes: Pass[] = []
  const bindings: { entries: Record<string, unknown> }[] = []
  let failBinding = false
  let failTexture = false
  const pipeline = (
    config: GPURenderPipelineDescriptor,
    pass?: Pass,
    bound: unknown[] = [],
  ): object => ({
    with(resource: unknown) {
      if (
        typeof resource === 'object' &&
        resource !== null &&
        'descriptor' in resource
      )
        return pipeline(config, resource as Pass, bound)
      return pipeline(config, pass, [...bound, resource])
    },
    draw() {
      if (!pass) throw new Error('Draw without render pass')
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
