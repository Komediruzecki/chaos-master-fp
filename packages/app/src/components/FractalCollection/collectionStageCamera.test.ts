/** Full-height crowns and near-side selection remain usable across portrait and wide canvases. */
import { describe, expect, it } from 'vitest'
import { collectionCameraMatrices, pickCollectionInstance, } from './collectionStageCamera'
import { collectionInstances } from './collectionStageLayout'
import type { CollectionCloud } from './collectionCloudWorker'

function project(point: readonly number[], vp: Float32Array) {
  const [x, y, z] = point as readonly [number, number, number]
  const w = x * vp[3]! + y * vp[7]! + z * vp[11]! + vp[15]!
  return [
    (x * vp[0]! + y * vp[4]! + z * vp[8]! + vp[12]!) / w,
    (x * vp[1]! + y * vp[5]! + z * vp[9]! + vp[13]!) / w,
  ] as const
}

describe('collection camera framing', () => {
  it.each([0.4, 0.75, 1.5, 2.6])(
    'keeps 2.5-unit shapes inside every preset at aspect %s',
    (aspect) => {
      for (const mode of ['board', 'lineup', 'solo'] as const)
        for (const phi of [0.08, 0.73, 1.34]) {
          const vp = new Float32Array(16)
          collectionCameraMatrices(
            mode,
            { theta: 0.38, phi, zoom: 1 },
            aspect,
            vp,
            new Float32Array(16),
            new Float32Array(3),
            new Float32Array(16),
            new Float32Array(16),
          )
          for (const piece of collectionInstances(mode, 'king', 'light', false))
            for (const dx of [-0.7, 0.7])
              for (const dz of [-0.7, 0.7])
                for (const dy of [0, 2.5]) {
                  const [x, y] = project(
                    [
                      piece.position[0] + dx,
                      piece.position[1] + dy,
                      piece.position[2] + dz,
                    ],
                    vp,
                  )
                  expect(Math.abs(x), `${mode} crown width`).toBeLessThan(0.91)
                  expect(Math.abs(y), `${mode} crown height`).toBeLessThan(0.91)
                }
        }
    },
  )
  it('selects the visible sampled crown before the floor or a further piece', () => {
    const vp = new Float32Array(16),
      inverse = new Float32Array(16)
    collectionCameraMatrices(
      'board',
      { theta: 0, phi: 1.2, zoom: 1 },
      1.5,
      vp,
      inverse,
      new Float32Array(3),
      new Float32Array(16),
      new Float32Array(16),
    )
    const pieces = collectionInstances('board', 'rook', 'light', false)
    const target = pieces.find(
      (item) => item.role === 'rook' && item.side === 'light',
    )!
    const clouds = [...new Set(pieces.map((piece) => piece.cloudKey!))].map(
      (key): CollectionCloud => ({
        key,
        side: key.endsWith('light') ? 'light' : 'dark',
        points: new Float32Array(),
        colors: new Float32Array(),
        bounds: { min: [-0.65, 0, -0.65], max: [0.65, 2.5, 0.65] },
      }),
    )
    const [x, y] = project([target.position[0], 2, target.position[2]], vp)
    expect(pickCollectionInstance(x, y, inverse, pieces, clouds)).toBe(target)
    expect(
      pickCollectionInstance(5, 5, inverse, pieces, clouds),
    ).toBeUndefined()
  })
  it('picks each lineup shape after orbiting and leaves empty space unselected', () => {
    const vp = new Float32Array(16),
      inverse = new Float32Array(16)
    collectionCameraMatrices(
      'lineup',
      { theta: 0.38, phi: 1.18, zoom: 1 },
      1.5,
      vp,
      inverse,
      new Float32Array(3),
      new Float32Array(16),
      new Float32Array(16),
    )
    const pieces = collectionInstances('lineup', 'pawn', 'dark', false)
    const clouds = pieces.map(
      (piece): CollectionCloud => ({
        key: piece.cloudKey!,
        side: piece.side,
        points: new Float32Array(),
        colors: new Float32Array(),
        bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1.8, 0.5] },
      }),
    )
    for (const piece of pieces) {
      const [x, y] = project([piece.position[0], 0.9, piece.position[2]], vp)
      expect(pickCollectionInstance(x, y, inverse, pieces, clouds)).toBe(piece)
    }
    const [x, y] = project([0, 4, 0], vp)
    expect(
      pickCollectionInstance(x, y, inverse, pieces, clouds),
    ).toBeUndefined()
  })
})
