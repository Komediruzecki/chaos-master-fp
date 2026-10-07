/** Special moves preserve identities and final squares even without a cinematic crush. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { gummyBoardSquare } from './gummyBoardPosition'
import { gummyMatchCaptureShot, gummyMatchFloorSquare, gummyMatchMoveFrame, gummyMatchPieces, } from './gummyMatchPresentation'

describe('chess receipt presentation', () => {
  it('renders all opening pieces and preserves sides and distinct colour families', () => {
    const game = createChessGame()
    const pieces = gummyMatchPieces(game.position, 0.9, 'marble')
    expect(pieces).toHaveLength(32)
    expect(new Set(pieces.map((p) => p.id)).size).toBe(32)
    expect(pieces.find((p) => p.square === 'e1')).toMatchObject({
      mould: 'king',
      side: 0,
      palette: 'marble',
    })
    expect(pieces.find((p) => p.square === 'e8')).toMatchObject({
      mould: 'king',
      side: 1,
      palette: 'blue',
    })
  })
  it('keeps the opponent distinct when a blue material is applied', () => {
    const pieces = gummyMatchPieces(createChessGame().position, 0.9, 'blue')
    expect(
      pieces.filter((p) => p.side === 0).every((p) => p.palette === 'blue'),
    ).toBe(true)
    expect(
      pieces.filter((p) => p.side === 1).every((p) => p.palette === 'marble'),
    ).toBe(true)
  })
  it('moves both castle actors and returns the exact committed final board', () => {
    const { receipt } = applyChessMove(
      createChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'),
      { from: 'e1', to: 'g1' },
    )
    const halfway = gummyMatchMoveFrame(receipt, 0.5, 0.9, 'marble')
    expect(
      halfway.find((p) => p.id === receipt.secondaryMove!.pieceId)!.position,
    ).not.toEqual(gummyBoardSquare('h1').position)
    expect(gummyMatchMoveFrame(receipt, 1, 0.9, 'marble')).toEqual(
      gummyMatchPieces(receipt.after, 0.9, 'marble'),
    )
    expect(
      receipt.after.pieces.find((p) => p.id === receipt.secondaryMove!.pieceId)!
        .square,
    ).toBe('f1')
  })
  it('removes the en-passant pawn from its actual square and moves the attacker onto the empty destination', () => {
    const { receipt } = applyChessMove(
      createChessGame('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'),
      { from: 'e5', to: 'd6' },
    )
    expect(gummyMatchCaptureShot(receipt, 'glass')).toBeUndefined()
    const halfway = gummyMatchMoveFrame(receipt, 0.5, 0.9, 'marble')
    expect(halfway.find((p) => p.id === receipt.captured!.id)).toMatchObject({
      square: 'd5',
      scale: 0.45,
    })
    const final = gummyMatchMoveFrame(receipt, 1, 0.9, 'marble')
    expect(final.some((p) => p.square === 'd5')).toBe(false)
    expect(final.find((p) => p.id === receipt.pieceId)!.square).toBe('d6')
  })
  it('uses the selected promotion mould at completion without changing identity', () => {
    const { receipt } = applyChessMove(
      createChessGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'),
      { from: 'a7', to: 'a8', promotion: 'knight' },
    )
    expect(
      gummyMatchMoveFrame(receipt, 0.9, 0.9, 'marble').find(
        (p) => p.id === receipt.pieceId,
      )!.mould,
    ).toBe('pawn')
    expect(
      gummyMatchMoveFrame(receipt, 1, 0.9, 'marble').find(
        (p) => p.id === receipt.pieceId,
      ),
    ).toMatchObject({ mould: 'knight', square: 'a8' })
  })
  it('directs ordinary captures from the pre-move FEN', () => {
    const game = createChessGame(
      '6k1/pp3ppp/4p3/3n4/4P3/8/PP3PPP/6K1 w - - 0 24',
    )
    const { receipt } = applyChessMove(game, { from: 'e4', to: 'd5' })
    expect(gummyMatchCaptureShot(receipt, 'lava')).toMatchObject({
      fen: receipt.before.fen,
      from: 'e4',
      to: 'd5',
      boardTheme: 'lava',
    })
    expect(receipt.before.fen).toBe(game.position.fen)
  })
  it('picks empty squares and rejects rays away from or outside the board', () => {
    const [x, , z] = gummyBoardSquare('a1').position
    expect(
      gummyMatchFloorSquare({ origin: [x, 3, z], direction: [0, -1, 0] }),
    ).toBe('a1')
    expect(
      gummyMatchFloorSquare({ origin: [20, 3, 0], direction: [0, -1, 0] }),
    ).toBeUndefined()
    expect(
      gummyMatchFloorSquare({ origin: [0, 3, 0], direction: [0, 1, 0] }),
    ).toBeUndefined()
    expect(
      gummyMatchFloorSquare({ origin: [0, 3, 0], direction: [1, 0, 0] }),
    ).toBeUndefined()
  })
})
