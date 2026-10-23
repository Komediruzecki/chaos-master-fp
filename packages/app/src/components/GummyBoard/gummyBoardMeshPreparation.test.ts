/** Candidate sources bypass match caches; ordinary match scenes still borrow their owned meshes. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareGummyBoardMeshes } from './gummyBoardMeshPreparation'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'

const fixture = vi.hoisted(() => ({ bake: vi.fn() }))
vi.mock('./gummyBoardRestMeshes', () => ({
  createGummyBoardRestMeshes: fixture.bake,
}))
beforeEach(() =>
  fixture.bake
    .mockReset()
    .mockResolvedValue({ meshes: new Map(), destroy: vi.fn() }),
)
describe('board mesh preparation', () => {
  it('does not let an injected solid reuse or enter a match pool', async () => {
    const source = {
      restPositions: new Float32Array([0, 0.1, 0, 1]),
      spacing: 0.04,
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    }
    const acquire = vi.fn()
    const pool: GummyBoardRestMeshPool = { acquire, destroy: vi.fn() }
    const controller = new AbortController()
    await prepareGummyBoardMeshes({} as TgpuRoot, {} as GPUDevice, {
      restMeshPool: pool,
      restSources: { rook: source },
      signal: controller.signal,
    })
    expect(acquire).not.toHaveBeenCalled()
    expect(fixture.bake.mock.calls[0]!.slice(2)).toEqual([
      0.08,
      undefined,
      controller.signal,
      undefined,
      ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'],
      { rook: source },
    ])
  })
  it('preserves match pooling and requested unique inspection moulds', async () => {
    const acquire = vi
      .fn()
      .mockResolvedValue({ meshes: new Map(), destroy: vi.fn() })
    const pool: GummyBoardRestMeshPool = { acquire, destroy: vi.fn() }
    await prepareGummyBoardMeshes(
      {} as TgpuRoot,
      {} as GPUDevice,
      { restMeshPool: pool },
      0.1,
    )
    expect(acquire.mock.calls[0]![2]).toBe(0.1)
    expect(fixture.bake).not.toHaveBeenCalled()
    const result = await prepareGummyBoardMeshes(
      {} as TgpuRoot,
      {} as GPUDevice,
      { restMeshPool: pool, moulds: ['rook', 'pawn', 'rook'] },
    )
    expect(result.moulds).toEqual(['rook', 'pawn'])
    expect(fixture.bake.mock.calls[0]![6]).toEqual(['rook', 'pawn'])
    expect(acquire).toHaveBeenCalledOnce()
  })
})
