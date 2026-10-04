/** Check native pass compatibility, cached attachments and ownership without a GPU emulator. */
import { d } from 'typegpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGummyBearMesh } from '@/simulation/gummy/gummyMesh'
import { createGummyRenderer } from './gummyRenderer'
import type { TgpuRoot } from 'typegpu'
import type { GummyFrame, GummyRenderState } from './gummyRenderer'

type View = { format: GPUTextureFormat; sampleCount: number }
type Pass = { descriptor: GPURenderPassDescriptor; end(): void }

function harness() {
  const buffers: {
    destroy: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
  }[] = []
  const textures: { destroy: ReturnType<typeof vi.fn>; view: View }[] = []
  const passes: Pass[] = []
  const groups: Record<string, unknown>[] = []
  let failedAfter = Infinity
  const pipeline = (config?: Record<string, unknown>, pass?: Pass): object => ({
    with(resource: unknown) {
      if (
        typeof resource === 'object' &&
        resource !== null &&
        'descriptor' in resource
      )
        return pipeline(config, resource as Pass)
      return pipeline(config, pass)
    },
    withIndexBuffer() {
      return pipeline(config, pass)
    },
    dispatchWorkgroups() {
      expect(config).toBeUndefined()
    },
    draw() {
      if (!pass || !config) throw new Error('Draw outside a render pass')
      const attachments = Array.from(pass.descriptor.colorAttachments)
      const targets = config.targets as {
        format?: string
        colour?: { format: string }
        world?: { format: string }
        rest?: { format: string }
      }
      const formats = targets.world
        ? [targets.world.format, targets.rest?.format]
        : [targets.format ?? targets.colour?.format]
      expect(attachments).toHaveLength(formats.length)
      for (const [i, attachment] of attachments.entries()) {
        if (!attachment) throw new Error('Missing colour attachment')
        const view = attachment.view as unknown as View
        expect(formats[i]).toBe(view.format)
        expect(
          (config.multisample as { count: number } | undefined)?.count ?? 1,
        ).toBe(view.sampleCount)
      }
      if (pass.descriptor.depthStencilAttachment)
        expect(
          (config.depthStencil as GPUDepthStencilState | undefined)?.format,
        ).toBe(
          (pass.descriptor.depthStencilAttachment.view as unknown as View)
            .format,
        )
      else expect(config.depthStencil).toBeUndefined()
    },
    drawIndexed() {
      const current = pipeline(config, pass) as { draw(): void }
      current.draw()
    },
  })
  const device = {
    createSampler: vi.fn(() => ({})),
    createTexture(descriptor: GPUTextureDescriptor) {
      if (textures.length >= failedAfter)
        throw new Error('Texture allocation failed')
      const view = {
        format: descriptor.format,
        sampleCount: descriptor.sampleCount ?? 1,
      }
      const texture = { destroy: vi.fn(), view, createView: () => view }
      textures.push(texture)
      return texture
    },
  }
  const root = {
    device,
    createBuffer(_schema: unknown, initial?: unknown) {
      const buffer = { destroy: vi.fn(), write: vi.fn(), $usage: () => buffer }
      buffers.push(buffer)
      if (typeof initial === 'function') initial(buffer)
      return buffer
    },
    createBindGroup(_layout: unknown, entries: Record<string, unknown>) {
      groups.push(entries)
      return entries
    },
    createRenderPipeline: (config: Record<string, unknown>) => pipeline(config),
    createComputePipeline: () => pipeline(),
    unwrap: vi.fn(),
    '~unstable': {
      createCommandEncoder() {
        return {
          beginComputePass: () => ({ end: vi.fn() }),
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
  const solver = {
    positions: { destroy: vi.fn() },
    damage: { destroy: vi.fn() },
  }
  const context = { format: 'bgra8unorm', sampleCount: 1 }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    context: context as unknown as GPUCanvasContext,
    solver: solver as unknown as GummyRenderState,
    external: solver,
    samplerCalls: () => device.createSampler.mock.calls.length,
    buffers,
    textures,
    passes,
    groups,
    failAfter(count: number) {
      failedAfter = count
    },
  }
}

const mesh = buildGummyBearMesh()
const frame = (): GummyFrame => ({
  width: 320,
  height: 240,
  viewProjection: new Float32Array(Array.from(d.mat4x4f())),
  inverseViewProjection: new Float32Array(Array.from(d.mat4x4f())),
  eye: new Float32Array([0, 1.4, 4]),
})
beforeEach(() =>
  vi.stubGlobal('GPUTextureUsage', {
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 4,
  }),
)
afterEach(() => vi.unstubAllGlobals())

describe('gummy renderer ownership and passes', () => {
  it('collects the nearest visible component before its matching back exit in runtime fracture', () => {
    const state = harness()
    const intact = buildGummyBearMesh({ fracture: 'none' })
    const renderer = createGummyRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
      { ...intact, runtimeFracture: true },
      state.solver,
    )
    renderer.render(frame())
    expect(state.passes).toHaveLength(6)
    const provenance = state.passes[2]!.descriptor
    const exits = state.passes[3]!.descriptor
    expect(provenance.label).toBe('Gummy visible component')
    const frontView = Array.from(provenance.colorAttachments)[0]!.view
    expect((frontView as unknown as View).format).toBe('rg16float')
    const filter = state.groups.find((group) => 'fronts' in group)!
    expect(filter.fronts).toBe(frontView)
    expect(exits.depthStencilAttachment?.view).toBe(
      provenance.depthStencilAttachment?.view,
    )
    expect(exits.depthStencilAttachment?.depthLoadOp).toBe('clear')
    expect(exits.colorAttachments).toHaveLength(2)
    expect(state.textures).toHaveLength(9)
    renderer.destroy()
    for (const texture of state.textures)
      expect(texture.destroy).toHaveBeenCalledOnce()
  })
  it('matches all HDR/depth sample counts and caches texture bindings between frames', () => {
    const state = harness()
    const renderer = createGummyRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
      mesh,
      state.solver,
    )
    renderer.render(frame())
    expect(state.passes).toHaveLength(5)
    expect(state.textures).toHaveLength(8)
    const bindingCount = state.groups.length
    const normalGroup = state.groups.find((group) => 'restNormals' in group)!
    expect(Object.keys(normalGroup)).toHaveLength(8)
    expect(normalGroup.damage).toBe(state.external.damage)
    const meshGroup = state.groups.find((group) => 'metadata' in group)!
    expect(Object.keys(meshGroup)).toHaveLength(8)
    expect(state.buffers).toContain(meshGroup.metadata)
    renderer.render({ ...frame(), palette: 'berry', clay: true })
    expect(state.textures).toHaveLength(8)
    expect(state.groups).toHaveLength(bindingCount)
    expect(state.samplerCalls()).toBe(1)
    const camera = state.buffers[0]!
    const uploaded = new Float32Array(
      camera.write.mock.calls.at(-1)![0] as ArrayBuffer,
    )
    expect(uploaded[38]).toBe(1)
    expect(uploaded[39]).toBe(1)
    expect(uploaded[40]).toBeCloseTo(0.4, 6)
    expect(uploaded[47]).toBe(0)
    renderer.render({ ...frame(), press: { height: 0.75, halfExtent: 1.1 } })
    const pressUpload = new Float32Array(
      camera.write.mock.calls.at(-1)![0] as ArrayBuffer,
    )
    expect(pressUpload[48]).toBeCloseTo(0.75)
    expect(pressUpload[49]).toBeCloseTo(1.1)
    expect(pressUpload[50]).toBe(1)
    for (const [palette, mode] of [
      ['candy', 1],
      ['lagoon', 2],
      ['marble', 3],
      ['blue', 0],
    ] as const) {
      renderer.render({ ...frame(), palette })
      const next = new Float32Array(
        camera.write.mock.calls.at(-1)![0] as ArrayBuffer,
      )
      expect(next[47]).toBe(mode)
      expect(next[50]).toBe(0)
    }
    expect(state.textures).toHaveLength(8)
    expect(state.groups).toHaveLength(bindingCount)
    renderer.destroy()
    renderer.destroy()
    for (const resource of [...state.buffers, ...state.textures])
      expect(resource.destroy).toHaveBeenCalledOnce()
    expect(state.external.positions.destroy).not.toHaveBeenCalled()
    expect(state.external.damage.destroy).not.toHaveBeenCalled()
  })

  it('replaces sized textures atomically while keeping the fixed caustic map', () => {
    const state = harness()
    const renderer = createGummyRenderer(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
      mesh,
      state.solver,
    )
    renderer.render(frame())
    state.failAfter(10)
    expect(() => {
      renderer.render({ ...frame(), width: 640 })
    }).toThrow('allocation failed')
    for (const texture of state.textures.slice(0, 8))
      expect(texture.destroy).not.toHaveBeenCalled()
    for (const texture of state.textures.slice(8))
      expect(texture.destroy).toHaveBeenCalledOnce()
    state.failAfter(Infinity)
    renderer.render(frame())
    renderer.render({ ...frame(), width: 640 })
    for (const texture of state.textures.slice(1, 8))
      expect(texture.destroy).toHaveBeenCalledOnce()
    expect(state.textures[0]!.destroy).not.toHaveBeenCalled()
    renderer.destroy()
    for (const texture of state.textures)
      expect(texture.destroy).toHaveBeenCalledOnce()
    const count = state.passes.length
    renderer.render(frame())
    expect(state.passes).toHaveLength(count)
  })

  it('rolls back all owned buffers if setup cannot allocate the light map', () => {
    const state = harness()
    state.failAfter(0)
    expect(() =>
      createGummyRenderer(
        state.root,
        state.device,
        state.context,
        'bgra8unorm',
        mesh,
        state.solver,
      ),
    ).toThrow('allocation failed')
    for (const buffer of state.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
    expect(state.external.positions.destroy).not.toHaveBeenCalled()
  })
})
