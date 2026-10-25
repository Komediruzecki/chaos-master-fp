/** Sampling reuse evicts least-recently-used collections and honours the byte cap. */
import { describe, expect, it } from 'vitest'
import { createCollectionCloudCache } from './collectionCloudCache'
import type { CollectionCloudReply } from './collectionCloudWorker'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'

function result(count = 1): Exclude<CollectionCloudReply, { error: string }> {
  return {
    clouds: [
      {
        key: 'rook:light',
        side: 'light',
        points: new Float32Array(count * 4),
        colors: new Float32Array(count * 4),
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    ],
    shell: { vertices: new Float32Array(4), radius: 1 },
  }
}

describe('collection cloud cache', () => {
  it('has no retention unless the owning preview requests a budget', () => {
    const cache = createCollectionCloudCache()
    cache.set('a', result())
    expect(cache.get('a')).toBeUndefined()
  })

  it('retains identity while evicting the least recently used collection', () => {
    const cache = createCollectionCloudCache({ maxEntries: 2, maxBytes: 4096 })
    const first = result()
    cache.set('a', first)
    cache.set('b', result())
    expect(cache.get('a')).toBe(first)
    cache.set('c', result())
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(first)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBeUndefined()
  })

  it('counts prototype vertices toward the same retention budget', () => {
    const cache = createCollectionCloudCache({ maxEntries: 2, maxBytes: 100 })
    const solid: WindowRookFracture = {
      key: 'rook:light',
      vertices: new Float32Array(19),
      fragmentCount: 1,
      chunks: [],
      physics: { chunks: [], bonds: [], cellSize: 1 },
      diagnostics: {
        cellSize: 1,
        occupiedCells: 1,
        connectedComponents: 1,
        retainedFraction: 1,
        volume: 1,
        interfaceFaces: 0,
        exteriorFaces: 6,
      },
    }
    cache.set('with-solid', { ...result(), solids: [solid] })
    expect(cache.get('with-solid')).toBeUndefined()
    cache.set('with-solid-shell', {
      ...result(),
      solidShell: { vertices: new Float32Array(20), radius: 1 },
    })
    expect(cache.get('with-solid-shell')).toBeUndefined()
    cache.set('plain', result())
    expect(cache.get('plain')).toBeDefined()
  })

  it('includes glass bytes in the cap, skips oversize results and replaces without double accounting', () => {
    const cache = createCollectionCloudCache({ maxEntries: 4, maxBytes: 80 })
    const first = result()
    const next = result(2)
    cache.set('a', first) // 48 bytes including glass
    cache.set('b', first)
    expect(cache.get('a')).toBeUndefined()
    cache.set('b', next) // 80 bytes replaces the previous 48
    expect(cache.get('b')).toBe(next)
    cache.set('oversize', result(3))
    expect(cache.get('oversize')).toBeUndefined()
    expect(cache.get('b')).toBe(next)
  })
})
