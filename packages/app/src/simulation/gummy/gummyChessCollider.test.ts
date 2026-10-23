/** Sampled mould contacts keep visible shape, oriented normals and baseline WebGPU binding limits. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it, vi } from 'vitest'
import { createGummyChessCollider, gummyChessColliderContact, gummyChessColliderLocalPoint, gummyChessColliderMayContact, gummyChessColliderWorldNormal, } from './gummyChessCollider'
import { bakeGummyChessColliderField } from './gummyChessColliderField'
import { GUMMY_CHESS_MOULDS, gummyChessField } from './gummyChessMoulds'
import { gummyParticleG2P, gummyParticleP2G } from './gummyParticleShaders'
import { gummyColliderContactSlot, gummyColliderMayContactSlot, } from './gummyRookCollider'
import type { TgpuRoot } from 'typegpu'
import type { GummyChessMould } from './gummyChessMoulds'

describe('selected chess mould contact', () => {
  it.each(Object.keys(GUMMY_CHESS_MOULDS) as GummyChessMould[])(
    'samples the complete %s boundary and outward gradients from the visible field',
    (mould) => {
      const field = bakeGummyChessColliderField(mould)
      const [nx, ny, nz] = field.size
      expect(field.values.byteLength).toBeLessThan(4 * 1024 * 1024)
      for (let z = 1; z < nz - 1; z += 7)
        for (let y = 1; y < ny - 1; y += 7)
          for (let x = 1; x < nx - 1; x += 7) {
            const offset = ((z * ny + y) * nx + x) * 4
            const point = [
              field.origin[0] + x * field.step,
              field.origin[1] + y * field.step,
              field.origin[2] + z * field.step,
            ] as const
            const distance = gummyChessField(point, mould)
            expect(field.values[offset + 3]).toBeCloseTo(distance, 6)
            expect(
              [...field.values.subarray(offset, offset + 4)].every(
                Number.isFinite,
              ),
            ).toBe(true)
            if (Math.abs(distance) < 0.08) {
              const gradient = d.vec3f(
                field.values[offset]!,
                field.values[offset + 1]!,
                field.values[offset + 2]!,
              )
              if (std.length(gradient) > 0.2) {
                const direction = std.normalize(gradient)
                const outside = gummyChessField(
                  [
                    point[0] + direction.x * 0.015,
                    point[1] + direction.y * 0.015,
                    point[2] + direction.z * 0.015,
                  ],
                  mould,
                )
                expect(outside).toBeGreaterThan(distance - 0.002)
              }
            }
          }
    },
  )
  it('bakes the selected art field rather than reusing the classic solid', () => {
    const sculpted = bakeGummyChessColliderField('knight', 'sculpted')
    const classic = bakeGummyChessColliderField('knight')
    expect(sculpted.size).toEqual(classic.size)
    expect(sculpted.values).not.toEqual(classic.values)
  })
  it('uses inverse rotation for queries and forward rotation for outward normals', () => {
    const rotation = d.vec2f(1, 0)
    expect([
      ...gummyChessColliderLocalPoint(d.vec3f(0, 2, -1), rotation),
    ]).toEqual([1, 2, 0])
    expect([
      ...gummyChessColliderWorldNormal(d.vec3f(1, 0, 0), rotation),
    ]).toEqual([0, 0, -1])
  })
  it.each([gummyParticleP2G, gummyParticleG2P])(
    'resolves selected contact without a ninth storage binding or float filtering',
    (shader) => {
      const source = tgpu.resolve(
        [
          tgpu
            .lazy(() => shader)
            .with(gummyColliderContactSlot, gummyChessColliderContact)
            .with(gummyColliderMayContactSlot, gummyChessColliderMayContact),
        ],
        { names: 'strict' },
      )
      expect(source).toContain('texture_3d<f32>')
      expect(source).toContain('textureLoad(')
      expect(source).not.toContain('textureSample(')
      expect(source.match(/var<storage/g)!.length).toBeLessThanOrEqual(8)
      expect(source).not.toContain('rookLatheContact')
    },
  )
  it('destroys the sampled texture and uniform once, including a failed upload', () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 })
    const texture = { createView: () => ({}), destroy: vi.fn() }
    const buffer = { destroy: vi.fn(), $usage: () => buffer }
    const device = {
      createTexture: vi.fn((_descriptor: GPUTextureDescriptor) => texture),
      queue: { writeTexture: vi.fn() },
    }
    const root = { createBuffer: () => buffer, createBindGroup: () => ({}) }
    const contact = createGummyChessCollider(
      root as unknown as TgpuRoot,
      device as unknown as GPUDevice,
      'bishop',
    )
    expect(device.createTexture.mock.calls[0]![0]).toMatchObject({
      dimension: '3d',
      format: 'rgba32float',
    })
    contact.destroy()
    contact.destroy()
    expect(texture.destroy).toHaveBeenCalledOnce()
    expect(buffer.destroy).toHaveBeenCalledOnce()
    device.queue.writeTexture.mockImplementation(() => {
      throw new Error('upload failed')
    })
    expect(() =>
      createGummyChessCollider(
        root as unknown as TgpuRoot,
        device as unknown as GPUDevice,
        'pawn',
      ),
    ).toThrow('upload failed')
    expect(texture.destroy).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
