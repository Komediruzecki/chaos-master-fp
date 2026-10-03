/** Attachment ownership and pass-input separation without requiring a browser or GPU. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParticleGummyTargets } from './particleGummyTargets'
import type { TgpuRoot } from 'typegpu'

function resources(failure?: 'texture' | 'view' | 'binding') {
  const descriptors: GPUTextureDescriptor[] = []
  const textures: {
    destroy: ReturnType<typeof vi.fn>
    createView: ReturnType<typeof vi.fn>
  }[] = []
  const inputs: Record<string, unknown>[] = []
  const device = {
    createTexture(descriptor: GPUTextureDescriptor) {
      const index = descriptors.length
      descriptors.push(descriptor)
      if (failure === 'texture' && index === 4)
        throw new Error('allocation failed')
      const texture = {
        destroy: vi.fn(),
        createView: vi.fn(() => {
          if (failure === 'view' && index === 4) throw new Error('view failed')
          return { index } as unknown as GPUTextureView
        }),
      }
      textures.push(texture)
      return texture as unknown as GPUTexture
    },
  } as unknown as GPUDevice
  const root = {
    createBindGroup(_layout: unknown, input: Record<string, unknown>) {
      if (failure === 'binding' && inputs.length === 2)
        throw new Error('binding failed')
      inputs.push(input)
      return input
    },
  } as unknown as TgpuRoot
  return { root, device, descriptors, textures, inputs }
}

describe('particle gummy target ownership', () => {
  beforeEach(() =>
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 0x10,
      TEXTURE_BINDING: 0x04,
    }),
  )
  afterEach(() => vi.unstubAllGlobals())

  it('keeps optical inputs separate from the output and caches the raw alternative', () => {
    const state = resources()
    const targets = createParticleGummyTargets(
      state.root,
      state.device,
      390,
      440,
      {} as GPUSampler,
    )
    for (const descriptor of state.descriptors)
      expect(descriptor.size).toEqual([390, 440])
    expect(
      state.descriptors.filter(
        (descriptor) => descriptor.format === 'r32float',
      ),
    ).toHaveLength(4)
    const composite = state.inputs.find(
      (input) =>
        input.depth === targets.filtered && input.scene === targets.scene,
    )
    const rawComposite = state.inputs.find(
      (input) =>
        input.depth === targets.surface && input.scene === targets.scene,
    )
    expect(composite).toMatchObject({
      depth: targets.filtered,
      original: targets.surface,
      scene: targets.scene,
    })
    expect(rawComposite).toMatchObject({
      depth: targets.surface,
      scene: targets.scene,
    })
    expect(Object.values(composite!)).not.toContain(targets.final)
    expect(state.inputs).toContainEqual({
      source: targets.filtered,
      original: targets.surface,
    })
    expect(state.inputs).toContainEqual({ surface: targets.filtered })
    expect(state.inputs).toContainEqual({ surface: targets.surface })
    expect(state.inputs).toContainEqual({
      original: targets.original,
      profileFirst: targets.profileFirst,
      profileSecond: targets.profileSecond,
      profileFar: targets.profileFar,
    })
    expect(state.inputs).toContainEqual({
      scene: targets.final,
      sampler: expect.anything(),
    })
    targets.destroy()
    targets.destroy()
    for (const texture of state.textures) {
      expect(texture.createView).toHaveBeenCalledTimes(1)
      expect(texture.destroy).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['texture', 'view', 'binding'] as const)(
    'rolls back every owned texture after %s creation fails',
    (failure) => {
      const state = resources(failure)
      expect(() =>
        createParticleGummyTargets(
          state.root,
          state.device,
          390,
          440,
          {} as GPUSampler,
        ),
      ).toThrow(/failed/)
      expect(state.textures.length).toBeGreaterThan(0)
      for (const texture of state.textures)
        expect(texture.destroy).toHaveBeenCalledTimes(1)
    },
  )
})
