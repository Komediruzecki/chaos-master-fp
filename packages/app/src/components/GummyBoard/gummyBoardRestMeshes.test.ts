/** Bake lifecycle checks: exact-size cache, bounded temporary ownership and failure cleanup. */
import { d } from 'typegpu'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyBoardRestMeshes } from './gummyBoardRestMeshes'
import type { TgpuRoot } from 'typegpu'

const mocks = vi.hoisted(() => ({ surface: vi.fn() }))
vi.mock('../GummyBear/marchingGummySurface', () => ({
  createMarchingGummySurface: mocks.surface,
}))

function harness() {
  const buffers: { bytes: number; destroy: ReturnType<typeof vi.fn> }[] = []
  const copies: ReturnType<typeof vi.fn>[] = []
  const device = {
    createCommandEncoder: vi.fn(() => {
      const copyBufferToBuffer = vi.fn()
      copies.push(copyBufferToBuffer)
      return { copyBufferToBuffer, finish: vi.fn(() => ({})) }
    }),
    queue: {
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
    },
  }
  const root = {
    device,
    createBuffer: vi.fn((schema: Parameters<typeof d.sizeOf>[0]) => {
      const result = {
        bytes: d.sizeOf(schema),
        destroy: vi.fn(),
        $usage: () => result,
      }
      buffers.push(result)
      return result
    }),
    unwrap: (value: unknown) => value,
  }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    buffers,
    copies,
    fence: device.queue.onSubmittedWorkDone,
  }
}
const surface = (vertexCount = 18, overflow = false) => ({
  vertices: {},
  encode: vi.fn(),
  destroy: vi.fn(),
  readStats: vi.fn(() => Promise.resolve({ vertexCount, overflow })),
})

beforeEach(() => mocks.surface.mockReset())
describe('gummy board rest mesh ownership', () => {
  it('finishes and releases each bake before allocating the next, retaining exact-size meshes', async () => {
    const test = harness()
    const pawn = surface(18),
      rook = surface(27)
    mocks.surface
      .mockImplementationOnce(() => pawn)
      .mockImplementationOnce(() => {
        expect(pawn.destroy).toHaveBeenCalledOnce()
        expect(test.buffers[0]!.destroy).toHaveBeenCalledOnce()
        return rook
      })
      .mockImplementation(() => surface(9))
    const result = await createGummyBoardRestMeshes(
      test.root,
      test.device,
      0.08,
    )
    expect(result.meshes.get('pawn')!.vertexCount).toBe(18)
    expect(result.meshes.get('rook')!.vertexCount).toBe(27)
    expect(
      test.buffers
        .map((buffer) => buffer.bytes)
        .filter((_, index) => index % 2 === 1),
    ).toEqual([18 * 48, 27 * 48, 9 * 48, 9 * 48, 9 * 48, 9 * 48])
    expect(test.copies[1]).toHaveBeenCalledWith(
      pawn.vertices,
      0,
      result.meshes.get('pawn')!.vertices,
      0,
      18 * 48,
    )
    expect(test.copies[3]).toHaveBeenCalledWith(
      rook.vertices,
      0,
      result.meshes.get('rook')!.vertices,
      0,
      27 * 48,
    )
    expect(rook.destroy).toHaveBeenCalledOnce()
    expect(result.meshes.size).toBe(6)
    expect(mocks.surface).toHaveBeenCalledTimes(6)
    expect(test.buffers[1]!.destroy).not.toHaveBeenCalled()
    result.destroy()
    result.destroy()
    for (const buffer of test.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
  })
  it('rejects a truncated bake rather than caching an incomplete visible mould', async () => {
    const test = harness(),
      failed = surface(300000, true)
    mocks.surface.mockReturnValueOnce(failed)
    await expect(
      createGummyBoardRestMeshes(test.root, test.device, 0.08),
    ).rejects.toThrow(/completely/)
    expect(mocks.surface).toHaveBeenCalledOnce()
    expect(failed.destroy).toHaveBeenCalledOnce()
    expect(test.buffers[0]!.destroy).toHaveBeenCalledOnce()
    expect(test.buffers).toHaveLength(1)
  })
  it('releases a completed pawn cache when the rook readback fails', async () => {
    const test = harness(),
      pawn = surface(),
      rook = surface()
    rook.readStats.mockRejectedValueOnce(new Error('Device lost'))
    mocks.surface.mockReturnValueOnce(pawn).mockReturnValueOnce(rook)
    await expect(
      createGummyBoardRestMeshes(test.root, test.device, 0.08),
    ).rejects.toThrow('Device lost')
    for (const buffer of test.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
    expect(pawn.destroy).toHaveBeenCalledOnce()
    expect(rook.destroy).toHaveBeenCalledOnce()
  })
  it('releases the compact destination if the submitted copy fails', async () => {
    const test = harness(),
      failed = surface()
    mocks.surface.mockReturnValueOnce(failed)
    test.fence.mockRejectedValueOnce(new Error('Copy failed'))
    await expect(
      createGummyBoardRestMeshes(test.root, test.device, 0.08),
    ).rejects.toThrow('Copy failed')
    for (const buffer of test.buffers)
      expect(buffer.destroy).toHaveBeenCalledOnce()
    expect(failed.destroy).toHaveBeenCalledOnce()
  })
})
