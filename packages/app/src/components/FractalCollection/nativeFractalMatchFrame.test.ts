/** Native captures keep their source geometry and agree with authoritative special-move receipts. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { squareWorld } from '../PawnBoard/pawnBoardMath'
import { NATIVE_CAPTURE_IMPACT, NATIVE_CAPTURE_SECONDS, NATIVE_MOVE_SECONDS, nativeMatchDuration, nativeMatchFrame, nativeMatchMarker, nativeMatchPieces, nativeMatchSquare, } from './nativeFractalMatchFrame'
import type { NativeFractalMatchLook } from './nativeFractalMatchFrame'

const look: NativeFractalMatchLook = {
  collectionId: 'wild-canopy',
  enclosure: 'glass',
  scale: 0.9,
}
const position = (square: string) => squareWorld(nativeMatchSquare(square)!)

describe('native fractal match frames', () => {
  it('maps all roles and sides to their native clouds, enclosing only the approved role', () => {
    const pieces = nativeMatchPieces(createChessGame().position, look, 'b1')
    expect(pieces).toHaveLength(32)
    expect(new Set(pieces.map((piece) => piece.id)).size).toBe(32)
    expect(new Set(pieces.map((piece) => piece.cloudKey)).size).toBe(12)
    expect(pieces.find((piece) => piece.chessSquare === 'b1')).toMatchObject({
      role: 'knight',
      side: 'light',
      cloudKey: 'knight:light',
      glassKey: 'wild-canopy',
      selected: true,
      age: -1,
      scale: 0.9,
      position: position('b1'),
    })
    expect(pieces.filter((piece) => piece.glassKey)).toHaveLength(4)
    expect(pieces.find((piece) => piece.chessSquare === 'e8')).toMatchObject({
      cloudKey: 'king:dark',
      glassKey: undefined,
      selected: false,
    })
    expect(
      nativeMatchPieces(createChessGame().position, {
        ...look,
        enclosure: 'pure',
      }).every((piece) => piece.glassKey === undefined),
    ).toBe(true)
  })

  it('keeps the before position in the first frame and exact after position at completion', () => {
    const { receipt } = applyChessMove(createChessGame(), {
      from: 'e2',
      to: 'e4',
    })
    expect(nativeMatchDuration(receipt)).toBe(NATIVE_MOVE_SECONDS)
    expect(nativeMatchFrame(receipt, 0, look)).toEqual(
      nativeMatchPieces(receipt.before, look),
    )
    expect(nativeMatchFrame(receipt, -5, look)).toEqual(
      nativeMatchPieces(receipt.before, look),
    )
    expect(nativeMatchFrame(receipt, NATIVE_MOVE_SECONDS, look)).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
    expect(nativeMatchFrame(receipt, 50, look)).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
  })

  it('disperses the captured native knight and matching shell at its own square without shrinking its geometry', () => {
    const { receipt } = applyChessMove(
      createChessGame('6k1/pp3ppp/4p3/3n4/4P3/8/PP3PPP/6K1 w - - 0 24'),
      { from: 'e4', to: 'd5' },
    )
    const before = nativeMatchFrame(receipt, NATIVE_CAPTURE_IMPACT - 0.01, look)
    expect(before.find((piece) => piece.id === receipt.captured!.id)!.age).toBe(
      -1,
    )
    const impact = nativeMatchFrame(receipt, NATIVE_CAPTURE_IMPACT, look)
    expect(
      impact.find((piece) => piece.id === receipt.captured!.id),
    ).toMatchObject({
      cloudKey: 'knight:dark',
      glassKey: 'wild-canopy',
      glassAge: 0,
      age: 0,
      scale: 0.9,
      position: position('d5'),
    })
    const settled = nativeMatchFrame(receipt, 1.5, look)
    expect(
      settled.find((piece) => piece.id === receipt.pieceId)!.position,
    ).toEqual(position('d5'))
    expect(
      settled.find((piece) => piece.id === receipt.captured!.id)!.scale,
    ).toBe(0.9)
    expect(settled.filter((piece) => piece.age >= 0)).toHaveLength(1)
    expect(nativeMatchDuration(receipt)).toBe(NATIVE_CAPTURE_SECONDS)
    expect(nativeMatchFrame(receipt, NATIVE_CAPTURE_SECONDS, look)).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
  })

  it('keeps a long-range capture intact until near contact and leaves the full shell fade visible', () => {
    const { receipt } = applyChessMove(
      createChessGame('1n2k3/8/8/8/8/8/8/1R2K3 w - - 0 1'),
      { from: 'b1', to: 'b8' },
    )
    const approaching = nativeMatchFrame(receipt, 0.8, look)
    const intact = approaching.find(
      (piece) => piece.id === receipt.captured!.id,
    )!
    expect(intact.age).toBe(-1)
    expect(intact.glassAge).toBeUndefined()
    const contact = nativeMatchFrame(receipt, NATIVE_CAPTURE_IMPACT, look)
    const attacker = contact.find((piece) => piece.id === receipt.pieceId)!
    const target = position('b8')
    expect(
      Math.hypot(
        ...attacker.position.map((value, axis) => value - target[axis]!),
      ),
    ).toBeLessThan(0.25)
    expect(
      contact.find((piece) => piece.id === receipt.captured!.id),
    ).toMatchObject({ age: 0, glassAge: 0 })
    const fading = nativeMatchFrame(receipt, NATIVE_CAPTURE_IMPACT + 1.69, look)
    expect(
      fading.find((piece) => piece.id === receipt.captured!.id)!.glassAge,
    ).toBeCloseTo(1.69)
    expect(
      nativeMatchDuration(receipt) - NATIVE_CAPTURE_IMPACT,
    ).toBeGreaterThanOrEqual(1.7)
  })

  it('replays the same receipt in pure and glass while preserving cloud and transform identity', () => {
    const { receipt } = applyChessMove(
      createChessGame('6k1/pp3ppp/4p3/3n4/4P3/8/PP3PPP/6K1 w - - 0 24'),
      { from: 'e4', to: 'd5' },
    )
    const glass = nativeMatchFrame(receipt, 1, look)
    const pure = nativeMatchFrame(receipt, 1, { ...look, enclosure: 'pure' })
    expect(
      pure.map(({ id, position, cloudKey, scale, age }) => ({
        id,
        position,
        cloudKey,
        scale,
        age,
      })),
    ).toEqual(
      glass.map(({ id, position, cloudKey, scale, age }) => ({
        id,
        position,
        cloudKey,
        scale,
        age,
      })),
    )
    expect(pure.every((piece) => piece.glassKey === undefined)).toBe(true)
  })

  it('moves both castling actors, keeping every role cloud unchanged', () => {
    const { receipt } = applyChessMove(
      createChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
      { from: 'e1', to: 'g1' },
    )
    const frame = nativeMatchFrame(receipt, NATIVE_MOVE_SECONDS / 2, look)
    expect(
      frame.find((piece) => piece.id === receipt.pieceId)!.position[0],
    ).toBe(position('f1')[0])
    expect(
      frame.find((piece) => piece.id === receipt.secondaryMove!.pieceId),
    ).toMatchObject({ cloudKey: 'rook:light', scale: 0.9 })
    expect(
      frame.find((piece) => piece.id === receipt.secondaryMove!.pieceId)!
        .position[0],
    ).toBe(position('g1')[0])
    expect(nativeMatchFrame(receipt, NATIVE_MOVE_SECONDS, look)).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
  })

  it('disperses en-passant at the captured square and finishes the attacker on the empty destination', () => {
    const { receipt } = applyChessMove(
      createChessGame('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'),
      { from: 'e5', to: 'd6' },
    )
    const frame = nativeMatchFrame(receipt, NATIVE_CAPTURE_IMPACT, look)
    expect(
      frame.find((piece) => piece.id === receipt.captured!.id),
    ).toMatchObject({
      chessSquare: 'd5',
      position: position('d5'),
      age: 0,
      cloudKey: 'pawn:dark',
    })
    const final = nativeMatchFrame(receipt, NATIVE_CAPTURE_SECONDS, look)
    expect(final.some((piece) => piece.chessSquare === 'd5')).toBe(false)
    expect(final.find((piece) => piece.id === receipt.pieceId)).toMatchObject({
      chessSquare: 'd6',
      position: position('d6'),
    })
  })

  it('promotes only at completion and keeps the piece identity through a capture promotion', () => {
    const { receipt } = applyChessMove(
      createChessGame('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
      { from: 'a7', to: 'b8', promotion: 'knight' },
    )
    expect(
      nativeMatchFrame(receipt, 1, look).find(
        (piece) => piece.id === receipt.pieceId,
      ),
    ).toMatchObject({ cloudKey: 'pawn:light', glassKey: undefined })
    expect(
      nativeMatchFrame(receipt, NATIVE_CAPTURE_SECONDS, look).find(
        (piece) => piece.id === receipt.pieceId,
      ),
    ).toMatchObject({
      cloudKey: 'knight:light',
      glassKey: 'wild-canopy',
      chessSquare: 'b8',
      position: position('b8'),
    })
  })

  it('rejects invalid squares and projects legal markers on the native top plane', () => {
    expect(nativeMatchSquare('a1')).toEqual({ file: 0, rank: 0 })
    expect(nativeMatchSquare('h8')).toEqual({ file: 7, rank: 7 })
    expect(nativeMatchSquare('i9')).toBeUndefined()
    const vp = new Float32Array([
      0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 1,
    ])
    expect(nativeMatchMarker('e4', vp)!.x).toBeCloseTo(54)
    expect(nativeMatchMarker('e4', vp)!.y).toBeCloseTo(49.7)
    expect(nativeMatchMarker('bad', vp)).toBeUndefined()
    vp[15] = -1
    expect(nativeMatchMarker('e4', vp)).toBeUndefined()
  })
})
