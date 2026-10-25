/** Collision paths match the visible legal move at every sample, regardless of board square or scale. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { nativeContactInput } from './nativeContactInput'
import { nativeMatchFrame, nativeMatchPieces } from './nativeFractalMatchFrame'
import { applyNativeFracture } from './nativeFractureFrame'
import type { NativeContactInput } from './nativeContactInput'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'

const receipt = applyChessMove(
  createChessGame('7k/8/8/3r4/4P3/8/8/K7 w - - 0 1'),
  { from: 'e4', to: 'd5' },
).receipt
const input: NativeContactInput = {
  receipt,
  look: {
    collectionId: 'lattice-court',
    enclosure: 'glass',
    scale: 0.9,
    fracture: 'contact',
  },
  clouds: [
    {
      key: 'pawn:light',
      side: 'light',
      points: new Float32Array(4),
      colors: new Float32Array(4),
      bounds: { min: [-0.4, 0.03, -0.5], max: [0.4, 1.3, 0.5] },
    },
  ],
  solids: [
    {
      key: 'rook:dark',
      vertices: new Float32Array(19),
      fragmentCount: 1,
      chunks: [],
      physics: { chunks: [], bonds: [], cellSize: 0.05 },
      diagnostics: {
        cellSize: 0.05,
        occupiedCells: 1,
        connectedComponents: 1,
        retainedFraction: 1,
        volume: 1,
        interfaceFaces: 0,
        exteriorFaces: 6,
      },
    },
  ],
}
const motion: RookContactMotion = {
  poses: new Float32Array(16),
  sampleRate: 120,
  frameCount: 2,
  chunkCount: 1,
  brokenAt: new Float32Array([-1, 0.6, 0.75]),
  stats: {
    boxCount: 1,
    steps: 1,
    contacts: 1,
    brokenBonds: 2,
    firstContact: 0.5,
    maxPenetration: 0,
  },
}

describe('native contact path and presentation', () => {
  it.each([0.85, 0.9, 1])(
    'uses the visible path and conservative bounds at scale %s',
    (scale) => {
      const look = { ...input.look, scale }
      const request = nativeContactInput({ ...input, look })!
      expect(request.attacker.radius).toBe(0.5)
      expect(request.attacker.height).toBeCloseTo(1.27)
      expect(request.attacker.path).toHaveLength(325 * 3)
      const victim = nativeMatchPieces(receipt.before, look).find(
        (piece) => piece.id === receipt.captured!.id,
      )!
      for (const sample of [0, 70, 110, 180, 324]) {
        const attacker = nativeMatchFrame(receipt, sample / 120, look).find(
          (piece) => piece.id === receipt.pieceId,
        )!
        for (let axis = 0; axis < 3; axis++)
          expect(
            request.attacker.path[sample * 3 + axis]! * scale +
              victim.position[axis]!,
          ).toBeCloseTo(
            attacker.position[axis]! + (axis === 1 ? 0.03 * scale : 0),
            5,
          )
      }
    },
  )
  it('does no bake for point comparisons and refuses absent contact geometry', () => {
    expect(
      nativeContactInput({
        ...input,
        look: { ...input.look, fracture: 'points' },
      }),
    ).toBeUndefined()
    expect(() => nativeContactInput({ ...input, solids: [] })).toThrow(
      'could not be prepared',
    )
  })
  it('holds contact material intact until its actual break and preserves legacy timing', () => {
    const prepared = { key: 'take', victimId: receipt.captured!.id, motion }
    const frame = (time: number) =>
      applyNativeFracture(
        nativeMatchFrame(receipt, time, input.look),
        input.look,
        prepared,
        time,
      )
    const early = frame(0.5).find((piece) => piece.id === prepared.victimId)!
    expect(early).toMatchObject({
      solidKey: 'rook:dark',
      solidMotionKey: 'take',
      solidMotionTime: 0.5,
      age: -1,
      glassAge: -1,
      glassKey: 'lattice-court:solid',
    })
    expect(
      frame(0.8).find((piece) => piece.id === prepared.victimId)!.glassAge,
    ).toBeCloseTo(0.2)
    expect(frame(2.7).some((piece) => piece.id === prepared.victimId)).toBe(
      false,
    )
    const legacy = applyNativeFracture(
      nativeMatchFrame(receipt, 1.2, input.look),
      { ...input.look, fracture: 'connected' },
    )
    const oldVictim = legacy.find((piece) => piece.id === prepared.victimId)!
    expect(oldVictim.age).toBeCloseTo(0.3)
    expect(oldVictim.solidMotionKey).toBeUndefined()
  })
})
