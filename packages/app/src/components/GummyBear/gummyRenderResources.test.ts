/** Borrowed render targets keep their owner, with atomic resize and failure rollback. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyRenderResources } from './gummyRenderResources'
import type { TgpuRoot } from 'typegpu'

function harness() {
  const textures: { destroy: ReturnType<typeof vi.fn> }[] = []
  let failAt = Infinity
  const device = {
    createSampler: () => ({}),
    createTexture() {
      if (textures.length === failAt) throw new Error('allocation failure')
      const texture = { destroy: vi.fn(), createView: () => ({}) }
      textures.push(texture)
      return texture
    },
  } as unknown as GPUDevice
  const root = {
    device,
    createBindGroup: vi.fn(() => ({})),
  } as unknown as TgpuRoot
  const context = {} as GPUCanvasContext
  return {
    root,
    device,
    context,
    textures,
    failAt: (index: number) => {
      failAt = index
    },
  }
}

beforeEach(() =>
  vi.stubGlobal('GPUTextureUsage', {
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 4,
  }),
)
afterEach(() => vi.unstubAllGlobals())

describe('gummy scene render resources', () => {
  it('disposes the light texture when its bind group cannot be constructed', () => {
    const state = harness()
    vi.spyOn(state.root, 'createBindGroup').mockImplementationOnce(() => {
      throw new Error('bind group failure')
    })
    expect(() =>
      createGummyRenderResources(
        state.root,
        state.device,
        state.context,
        'bgra8unorm',
      ),
    ).toThrow('bind group failure')
    expect(state.textures).toHaveLength(1)
    expect(state.textures[0]!.destroy).toHaveBeenCalledOnce()
  })
  it('shares stable targets, rejects another canvas, and preserves targets after resize failure', () => {
    const state = harness()
    const resources = createGummyRenderResources(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    const first = resources.targets(320, 240, true)
    expect(resources.targets(320, 240, true)).toBe(first)
    expect(state.textures).toHaveLength(9)
    state.failAt(11)
    expect(() => resources.targets(640, 240, true)).toThrow(
      'allocation failure',
    )
    expect(resources.targets(320, 240, true)).toBe(first)
    for (const texture of state.textures.slice(0, 9))
      expect(texture.destroy).not.toHaveBeenCalled()
    for (const texture of state.textures.slice(9))
      expect(texture.destroy).toHaveBeenCalledOnce()
    expect(() => {
      resources.assertCompatible(
        state.root,
        state.device,
        {} as GPUCanvasContext,
        'bgra8unorm',
      )
    }).toThrow('another canvas')
    resources.assertCompatible(
      state.root,
      state.device,
      state.context,
      'bgra8unorm',
    )
    state.failAt(Infinity)
    expect(resources.targets(640, 240, false)).not.toBe(first)
    for (const texture of state.textures.slice(1, 9))
      expect(texture.destroy).toHaveBeenCalledOnce()
    expect(state.textures[0]!.destroy).not.toHaveBeenCalled()
    resources.destroy()
    resources.destroy()
    for (const texture of state.textures)
      expect(texture.destroy).toHaveBeenCalledOnce()
    expect(() => resources.targets(320, 240, true)).toThrow('destroyed')
  })
})
