/** Shared mould lifetime checks across simultaneous scenes, skipped captures and device changes. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardRestMeshes } from './gummyBoardRestMeshes'

const mocks = vi.hoisted(() => ({ bake: vi.fn() }))
vi.mock('./gummyBoardRestMeshes', () => ({
  createGummyBoardRestMeshes: mocks.bake,
}))

function deviceRoot() {
  const device = {} as GPUDevice
  return { device, root: { device } as TgpuRoot }
}

function resource() {
  return { meshes: new Map(), destroy: vi.fn() }
}

function deferredBake() {
  let resolve!: (value: GummyBoardRestMeshes) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<GummyBoardRestMeshes>(
    (resolveValue, rejectValue) => {
      resolve = resolveValue
      reject = rejectValue
    },
  )
  return { promise, resolve, reject }
}

beforeEach(() => mocks.bake.mockReset())
describe('match-owned gummy mould pool', () => {
  it('bakes once for overlapping scenes and later captures, then releases only after its final borrower', async () => {
    const { root, device } = deviceRoot(),
      pool = createGummyBoardRestMeshPool()
    const bake = deferredBake(),
      mesh = resource()
    mocks.bake.mockReturnValue(bake.promise)
    const first = pool.acquire(root, device, 0.08, 'sculpted')
    const second = pool.acquire(root, device, 0.08, 'sculpted')
    expect(mocks.bake).toHaveBeenCalledOnce()
    bake.resolve(mesh)
    const [board, capture] = await Promise.all([first, second])
    expect(board.meshes).toBe(capture.meshes)
    board.destroy()
    board.destroy()
    expect(mesh.destroy).not.toHaveBeenCalled()
    capture.destroy()
    const replay = await pool.acquire(root, device, 0.08, 'sculpted')
    expect(mocks.bake).toHaveBeenCalledOnce()
    expect(replay.meshes).toBe(mesh.meshes)
    pool.destroy()
    pool.destroy()
    expect(mesh.destroy).not.toHaveBeenCalled()
    replay.destroy()
    replay.destroy()
    expect(mesh.destroy).toHaveBeenCalledOnce()
    await expect(pool.acquire(root, device, 0.08, 'sculpted')).rejects.toThrow(
      'closed',
    )
  })

  it('lets one waiting scene cancel without aborting a bake still needed by another', async () => {
    const { root, device } = deviceRoot(),
      pool = createGummyBoardRestMeshPool()
    const bake = deferredBake(),
      mesh = resource(),
      abort = new AbortController()
    mocks.bake.mockReturnValue(bake.promise)
    const cancelled = pool.acquire(root, device, 0.08, 'sculpted', abort.signal)
    const kept = pool.acquire(root, device, 0.08, 'sculpted')
    const rejection = expect(cancelled).rejects.toMatchObject({
      name: 'AbortError',
    })
    abort.abort()
    await rejection
    expect((mocks.bake.mock.calls[0]![4] as AbortSignal).aborted).toBe(false)
    bake.resolve(mesh)
    const lease = await kept
    expect(mesh.destroy).not.toHaveBeenCalled()
    lease.destroy()
    pool.destroy()
    expect(mesh.destroy).toHaveBeenCalledOnce()
  })

  it('aborts an abandoned bake and does not let its late completion replace a fresh attempt', async () => {
    const { root, device } = deviceRoot(),
      pool = createGummyBoardRestMeshPool()
    const stale = deferredBake(),
      oldMesh = resource(),
      newMesh = resource()
    const abort = new AbortController()
    mocks.bake.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(newMesh)
    const first = pool.acquire(root, device, 0.08, 'sculpted', abort.signal)
    const rejection = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    })
    abort.abort()
    await rejection
    expect((mocks.bake.mock.calls[0]![4] as AbortSignal).aborted).toBe(true)
    const next = await pool.acquire(root, device, 0.08, 'sculpted')
    stale.resolve(oldMesh)
    await stale.promise
    expect(oldMesh.destroy).toHaveBeenCalledOnce()
    const replay = await pool.acquire(root, device, 0.08, 'sculpted')
    expect(replay.meshes).toBe(next.meshes)
    expect(mocks.bake).toHaveBeenCalledTimes(2)
    pool.destroy()
    next.destroy()
    expect(newMesh.destroy).not.toHaveBeenCalled()
    replay.destroy()
    expect(newMesh.destroy).toHaveBeenCalledOnce()
  })

  it('retries a failed bake and cancels pending leases when their owning match closes', async () => {
    const { root, device } = deviceRoot(),
      pool = createGummyBoardRestMeshPool()
    const late = deferredBake(),
      mesh = resource()
    mocks.bake
      .mockRejectedValueOnce(new Error('Device unavailable'))
      .mockReturnValueOnce(late.promise)
    await expect(pool.acquire(root, device, 0.08)).rejects.toThrow(
      'Device unavailable',
    )
    const pending = pool.acquire(root, device, 0.08)
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })
    pool.destroy()
    expect((mocks.bake.mock.calls[1]![4] as AbortSignal).aborted).toBe(true)
    late.resolve(mesh)
    await rejection
    expect(mesh.destroy).toHaveBeenCalledOnce()
    expect(mocks.bake).toHaveBeenCalledTimes(2)
  })

  it('separates root, spacing and art style and never borrows from a mismatched device', async () => {
    const a = deviceRoot(),
      b = deviceRoot(),
      pool = createGummyBoardRestMeshPool()
    const meshes = Array.from({ length: 4 }, () => resource())
    for (const mesh of meshes) mocks.bake.mockResolvedValueOnce(mesh)
    const leases = await Promise.all([
      pool.acquire(a.root, a.device, 0.08, 'sculpted'),
      pool.acquire(a.root, a.device, 0.08, 'classic'),
      pool.acquire(a.root, a.device, 0.06, 'sculpted'),
      pool.acquire(b.root, b.device, 0.08, 'sculpted'),
    ])
    await expect(pool.acquire(a.root, b.device, 0.08)).rejects.toThrow(
      'must match',
    )
    expect(mocks.bake).toHaveBeenCalledTimes(4)
    for (const lease of leases) lease.destroy()
    pool.destroy()
    for (const mesh of meshes) expect(mesh.destroy).toHaveBeenCalledOnce()
  })
})
