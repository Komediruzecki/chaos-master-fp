/** Worker replies own one shared fitted envelope and transfer every render buffer once. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFractalStudyGlass, getFractalStudyGlassRole, } from '@/flame/chess/fractalStudyGlass'
import type { CollectionCloudReply, CollectionCloudRequest, } from './collectionCloudWorker'

vi.mock('@/flame/chess/fractalChessCollections', () => ({
  getFractalChessCollection: () => ({
    pieces: ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'].map(
      (role) => ({ role }),
    ),
  }),
  buildFractalChessFlame: (_id: string, role: string, side: string) => ({
    name: `${role}:${side}`,
  }),
}))
vi.mock('@/flame/chess/flameFigurineCloud', () => ({
  sampleFlameFigurineCloud: ({ name }: { name: string }) => {
    const shift = name.endsWith(':dark') ? 0.13 : -0.09
    return {
      points: new Float32Array([
        -0.3 + shift,
        0,
        -0.2,
        1,
        0.4 + shift,
        1.3,
        0.3,
        1,
      ]),
      colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
      bounds: { min: [-0.4, 0, -0.2], max: [0.6, 1.3, 0.3] },
    }
  },
}))

async function worker() {
  const self = {
    onmessage: undefined as
      | ((event: MessageEvent<CollectionCloudRequest>) => void)
      | undefined,
    postMessage:
      vi.fn<
        (
          reply: CollectionCloudReply,
          options?: { transfer: ArrayBuffer[] },
        ) => void
      >(),
  }
  vi.stubGlobal('self', self)
  vi.resetModules()
  await import('./collectionCloudWorker')
  return self
}

describe('collection cloud worker', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['wild-canopy', 'tidal-relics', 'lattice-court'])(
    '%s fits the same combined-side shell and transfers it with the cloud buffers',
    async (collectionId) => {
      const job = await worker()
      job.onmessage!({
        data: { collectionId, count: 24_000 },
      } as MessageEvent<CollectionCloudRequest>)
      expect(job.postMessage).toHaveBeenCalledOnce()
      const [reply, options] = job.postMessage.mock.calls[0]!
      if ('error' in reply) throw new Error(reply.error)
      expect(reply.clouds).toHaveLength(12)
      const role = getFractalStudyGlassRole(collectionId)!
      const sources = reply.clouds.filter((cloud) =>
        cloud.key.startsWith(`${role}:`),
      )
      const combined = new Float32Array(
        sources.flatMap((cloud) => Array.from(cloud.points)),
      )
      const expected = buildFractalStudyGlass(collectionId, combined)
      expect(reply.shell?.vertices).toEqual(expected.vertices)
      expect(reply.shell?.radius).toBe(expected.radius)
      const buffers = options!.transfer
      expect(buffers).toHaveLength(25)
      expect(new Set(buffers).size).toBe(25)
      expect(buffers).toContain(reply.shell!.vertices.buffer)
      for (const cloud of reply.clouds) {
        expect(buffers).toContain(cloud.points.buffer)
        expect(buffers).toContain(cloud.colors.buffer)
        expect(cloud.points).toHaveLength(8)
      }
      const received = structuredClone(reply, { transfer: buffers })
      expect(buffers.every((buffer) => buffer.byteLength === 0)).toBe(true)
      expect(received.shell?.vertices).toEqual(expected.vertices)
      expect(received.clouds.every((cloud) => cloud.points.length === 8)).toBe(
        true,
      )
    },
  )

  it('keeps collections without a designated envelope as pure clouds', async () => {
    const job = await worker()
    job.onmessage!({
      data: { collectionId: 'future-pure-set', count: 24_000 },
    } as MessageEvent<CollectionCloudRequest>)
    const [reply, options] = job.postMessage.mock.calls[0]!
    if ('error' in reply) throw new Error(reply.error)
    expect(reply.shell).toBeUndefined()
    expect(options!.transfer).toHaveLength(24)
  })
})
