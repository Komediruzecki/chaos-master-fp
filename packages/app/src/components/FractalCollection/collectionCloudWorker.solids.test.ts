/** The optional finite-solid bake cannot add work or a failure to ordinary point/glass previews. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionCloudReply, CollectionCloudRequest, } from './collectionCloudWorker'

const mocks = vi.hoisted(() => ({ solid: vi.fn() }))
vi.mock('@/flame/chess/fractalChessCollections', () => ({
  getFractalChessCollection: () => ({
    pieces: [{ role: 'pawn' }, { role: 'rook' }],
  }),
  buildFractalChessFlame: () => ({}),
}))
vi.mock('@/flame/chess/flameFigurineCloud', () => ({
  sampleFlameFigurineCloud: () => ({
    points: new Float32Array([0, 1, 0, 1]),
    colors: new Float32Array([0.1, 0.2, 0.8, 1]),
    bounds: { min: [0, 1, 0], max: [0, 1, 0] },
  }),
}))
vi.mock('@/flame/chess/fractalStudyGlass', () => ({
  getFractalStudyGlassRole: () => 'rook',
  buildFractalStudyGlass: () => ({ vertices: new Float32Array(18), radius: 1 }),
}))
vi.mock('@/flame/chess/windowRookFracture', () => ({
  buildWindowRookFracture: mocks.solid,
  assembledWindowRookPoints: () => new Float32Array([0, 0, 0, 1]),
}))

async function run(request: CollectionCloudRequest) {
  vi.resetModules()
  const postMessage =
    vi.fn<
      (
        message: CollectionCloudReply,
        transfer: { transfer: ArrayBuffer[] },
      ) => void
    >()
  const worker = {
    onmessage: undefined as
      | undefined
      | ((event: { data: CollectionCloudRequest }) => void),
    postMessage,
  }
  vi.stubGlobal('self', worker)
  await import('./collectionCloudWorker')
  worker.onmessage!({ data: request })
  return postMessage.mock.calls[0]!
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('native collection worker finite-solid opt-in', () => {
  it('keeps ordinary sampling free of solid work', async () => {
    const [reply, options] = await run({
      collectionId: 'lattice-court',
      count: 24_000,
    })
    expect(mocks.solid).not.toHaveBeenCalled()
    expect('clouds' in reply && reply.clouds.map(({ key }) => key)).toEqual([
      'pawn:light',
      'pawn:dark',
      'rook:light',
      'rook:dark',
    ])
    expect(options.transfer).toHaveLength(9)
  })

  it('returns both solid sides and transfers their owned buffers only when the scene requests them', async () => {
    mocks.solid.mockImplementation((key: string) => ({
      key,
      vertices: new Float32Array(19 * 3),
      fragmentCount: 1,
      physics: {
        chunks: [
          { boxes: new Float32Array(6), supportPoints: new Float32Array(24) },
        ],
      },
    }))
    const [reply, options] = await run({
      collectionId: 'lattice-court',
      count: 24_000,
      includeSolids: true,
    })
    if (!('clouds' in reply)) throw new Error('Expected sampled clouds')
    expect(reply.solids?.map(({ key }) => key)).toEqual([
      'rook:light',
      'rook:dark',
    ])
    expect(options.transfer).toHaveLength(16)
    expect(options.transfer.slice(9, -1)).toEqual(
      reply.solids!.flatMap((solid) => [
        solid.vertices.buffer,
        ...solid.physics.chunks.flatMap((chunk) => [
          chunk.boxes.buffer,
          chunk.supportPoints.buffer,
        ]),
      ]),
    )
    expect(new Set(options.transfer).size).toBe(options.transfer.length)
    expect(options.transfer.at(-1)).toBe(reply.solidShell!.vertices.buffer)
    expect(reply.solidShell).not.toBe(reply.shell)
    expect(reply.solidError).toBeUndefined()
  })

  it('reports a refused solid while retaining the ordinary point/glass result', async () => {
    mocks.solid.mockImplementation(() => {
      throw new Error('Disconnected volume')
    })
    const [reply, options] = await run({
      collectionId: 'lattice-court',
      count: 24_000,
      includeSolids: true,
    })
    if (!('clouds' in reply)) throw new Error('Expected sampled clouds')
    expect(reply.clouds).toHaveLength(4)
    expect(reply.shell?.vertices).toHaveLength(18)
    expect(reply.solids).toBeUndefined()
    expect(reply.solidShell).toBeUndefined()
    expect(reply.solidError).toBe('Disconnected volume')
    expect(options.transfer).toHaveLength(9)
  })

  it('does not apply the rook prototype to unrelated native collections', async () => {
    const [reply] = await run({
      collectionId: 'wild-canopy',
      count: 24_000,
      includeSolids: true,
    })
    expect(mocks.solid).not.toHaveBeenCalled()
    expect('clouds' in reply && reply.solids).toBeUndefined()
  })
})
