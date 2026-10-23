/** Pawn-race rules by legal board positions, complete move sequences and outcomes. */
import { describe, expect, it } from 'vitest'
import { createPawnGame, legalPawnMoves, movePawn, selectPawn, squareName, } from './pawnGame'
import type { PawnSide } from './pawnFlame'
import type { GameState, Piece, Square } from './pawnGame'

const pawn = (
  id: string,
  side: PawnSide,
  file: number,
  rank: number,
  moved = true,
): Piece => ({ id, side, square: { file, rank }, moved })
const position = (pieces: Piece[], turn: PawnSide = 'light'): GameState => ({
  pieces,
  turn,
  history: [],
})
const at = (state: GameState, id: string) =>
  state.pieces.find((piece) => piece.id === id)!
const destinations = (state: GameState, id: string) =>
  legalPawnMoves(state, id).map((move) => [squareName(move.to), move.kind])

function play(state: GameState, id: string, file: number, rank: number) {
  const result = movePawn(state, id, { file, rank })
  if (!result)
    throw new Error(
      `Expected legal move ${id} to ${squareName({ file, rank })}`,
    )
  return result
}

/** The same game played through its public API, with immediate light en passant. */
function lightEnPassantPosition() {
  let state = createPawnGame()
  state = play(state, 'light_4', 4, 3).state
  state = play(state, 'dark_0', 0, 5).state
  state = play(state, 'light_4', 4, 4).state
  return play(state, 'dark_3', 3, 4).state
}

function freezeGame(state: GameState) {
  for (const piece of state.pieces) {
    Object.freeze(piece.square)
    Object.freeze(piece)
  }
  Object.freeze(state.pieces)
  Object.freeze(state.history)
  return Object.freeze(state)
}

describe('new pawn games', () => {
  it('starts eight pawns per side on ranks 1 and 6, with Frost to move', () => {
    const state = createPawnGame()
    expect(state).toEqual(createPawnGame('standard'))
    expect(state.turn).toBe('light')
    expect(state.history).toEqual([])
    expect(state.selectedId).toBeUndefined()
    expect(state.winner).toBeUndefined()
    expect(state.pieces).toHaveLength(16)
    expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(16)
    for (const [index, piece] of state.pieces.entries()) {
      const side = index < 8 ? 'light' : 'dark'
      expect(piece).toEqual({
        id: `${side}_${index % 8}`,
        side,
        square: { file: index % 8, rank: side === 'light' ? 1 : 6 },
        moved: false,
      })
    }
  })

  it('creates independent board and history objects on reset', () => {
    const first = createPawnGame()
    const second = createPawnGame()
    first.pieces[0]!.square.rank = 4
    first.pieces.pop()
    expect(second.pieces).toHaveLength(16)
    expect(second.pieces[0]!.square).toEqual({ file: 0, rank: 1 })
    expect(first.history).not.toBe(second.history)
  })

  it('offers d4 takes e5 immediately while preserving all 16 pawns', () => {
    const state = createPawnGame('capture-demo')
    expect(state.pieces).toHaveLength(16)
    expect(at(state, 'light_3').square).toEqual({ file: 3, rank: 3 })
    expect(at(state, 'dark_4').square).toEqual({ file: 4, rank: 4 })
    expect(legalPawnMoves(state, 'light_3')).toContainEqual({
      pieceId: 'light_3',
      from: { file: 3, rank: 3 },
      to: { file: 4, rank: 4 },
      kind: 'capture',
      captureId: 'dark_4',
    })
    const result = play(state, 'light_3', 4, 4)
    expect(result.state.pieces).toHaveLength(15)
    expect(result.receipt.captured?.id).toBe('dark_4')
    expect(result.state.winner).toBeUndefined()
  })

  it('names all board corners and rejects off-board or fractional squares', () => {
    expect(squareName({ file: 0, rank: 0 })).toBe('a1')
    expect(squareName({ file: 7, rank: 0 })).toBe('h1')
    expect(squareName({ file: 0, rank: 7 })).toBe('a8')
    expect(squareName({ file: 7, rank: 7 })).toBe('h8')
    for (const square of [
      { file: -1, rank: 0 },
      { file: 0, rank: 8 },
      { file: 1.5, rank: 2 },
    ]) {
      expect(() => squareName(square)).toThrow(RangeError)
    }
  })
})

describe('legal pawn movement', () => {
  it('allows initial one or two squares, alternating sides and direction', () => {
    const state = createPawnGame()
    expect(destinations(state, 'light_4')).toEqual([
      ['e3', 'advance'],
      ['e4', 'double'],
    ])
    expect(legalPawnMoves(state, 'dark_4')).toEqual([])
    const next = play(state, 'light_4', 4, 3).state
    expect(next.turn).toBe('dark')
    expect(at(next, 'light_4').moved).toBe(true)
    expect(destinations(next, 'dark_4')).toEqual([
      ['e6', 'advance'],
      ['e5', 'double'],
    ])
    expect(legalPawnMoves(next, 'light_4')).toEqual([])
  })

  it('requires both an unmoved pawn and its initial rank for a double step', () => {
    const opponent = pawn('enemy', 'dark', 7, 6)
    expect(
      destinations(position([pawn('p', 'light', 2, 1, true), opponent]), 'p'),
    ).toEqual([['c3', 'advance']])
    expect(
      destinations(position([pawn('p', 'light', 2, 2, false), opponent]), 'p'),
    ).toEqual([['c4', 'advance']])
  })

  it.each(['light', 'dark'] as const)(
    'cannot jump a %s pawn on the first square',
    (side) => {
      const state = position([
        pawn('p', 'light', 3, 1, false),
        pawn('blocker', side, 3, 2),
        pawn('enemy', 'dark', 7, 6),
      ])
      expect(legalPawnMoves(state, 'p')).toEqual([])
    },
  )

  it('still allows one square when only the double destination is blocked', () => {
    expect(
      destinations(
        position([
          pawn('p', 'light', 3, 1, false),
          pawn('enemy', 'dark', 3, 3),
        ]),
        'p',
      ),
    ).toEqual([['d3', 'advance']])
  })

  it('captures enemies diagonally, including an edge file, but never empty or friendly squares', () => {
    const state = position([
      pawn('p', 'light', 0, 3),
      pawn('enemy', 'dark', 1, 4),
      pawn('friend', 'light', 0, 4),
      pawn('farEnemy', 'dark', 7, 6),
    ])
    expect(destinations(state, 'p')).toEqual([['b5', 'capture']])
    expect(legalPawnMoves(state, 'p')[0]!.captureId).toBe('enemy')
    const friendly = position([
      pawn('p', 'light', 3, 3),
      pawn('friend', 'light', 2, 4),
      pawn('enemy', 'dark', 7, 6),
    ])
    expect(destinations(friendly, 'p')).toEqual([['d5', 'advance']])
  })

  it('rejects unsupported moves without changing selection, pieces, history or turn', () => {
    const state = freezeGame(selectPawn(createPawnGame(), 'light_4'))
    const before = JSON.stringify(state)
    const invalid: [string, Square][] = [
      ['missing', { file: 4, rank: 2 }],
      ['dark_4', { file: 4, rank: 5 }],
      ['light_4', { file: 4, rank: 0 }],
      ['light_4', { file: 5, rank: 2 }],
      ['light_4', { file: 4, rank: 4 }],
      ['light_4', { file: 8, rank: 2 }],
      ['light_4', { file: 4, rank: 2.5 }],
    ]
    for (const [id, to] of invalid)
      expect(movePawn(state, id, to)).toBeUndefined()
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('selection and immutable move receipts', () => {
  it('selects only the current players pawn, toggles it off and clears explicitly', () => {
    const original = freezeGame(createPawnGame())
    const selected = selectPawn(original, 'light_3')
    expect(original.selectedId).toBeUndefined()
    expect(selected.selectedId).toBe('light_3')
    expect(selectPawn(selected, 'dark_3')).toBe(selected)
    expect(selectPawn(selected, 'missing')).toBe(selected)
    expect(selectPawn(selected, 'light_3').selectedId).toBeUndefined()
    expect(selectPawn(selected).selectedId).toBeUndefined()
  })

  it('snapshots the captured pawn and appends a frozen receipt without mutating the input', () => {
    const original = freezeGame(
      selectPawn(createPawnGame('capture-demo'), 'light_3'),
    )
    const before = JSON.stringify(original)
    const result = play(original, 'light_3', 4, 4)
    expect(JSON.stringify(original)).toBe(before)
    expect(result.state.selectedId).toBeUndefined()
    expect(result.state.turn).toBe('dark')
    expect(at(result.state, 'light_3').square).toEqual({ file: 4, rank: 4 })
    expect(result.state.pieces.some((piece) => piece.id === 'dark_4')).toBe(
      false,
    )
    expect(result.receipt).toEqual({
      ply: 1,
      side: 'light',
      pieceId: 'light_3',
      from: { file: 3, rank: 3 },
      to: { file: 4, rank: 4 },
      kind: 'capture',
      captureId: 'dark_4',
      enPassant: false,
      captured: {
        id: 'dark_4',
        side: 'dark',
        square: { file: 4, rank: 4 },
        moved: true,
      },
    })
    expect(result.state.history).toEqual([result.receipt])
    expect(result.state.history[0]).toBe(result.receipt)
    expect(result.receipt.captured).not.toBe(at(original, 'dark_4'))
    for (const snapshot of [
      result.receipt,
      result.receipt.from,
      result.receipt.to,
      result.receipt.captured,
      result.receipt.captured?.square,
    ]) {
      expect(Object.isFrozen(snapshot)).toBe(true)
    }
    expect(Reflect.set(result.receipt.to, 'rank', 7)).toBe(false)
    expect(result.receipt.to.rank).toBe(4)
  })

  it('keeps earlier history entries when subsequent moves append receipts', () => {
    const first = play(createPawnGame(), 'light_1', 1, 2)
    const second = play(first.state, 'dark_1', 1, 5)
    expect(first.state.history).toEqual([first.receipt])
    expect(second.state.history).toEqual([first.receipt, second.receipt])
    expect(second.receipt.ply).toBe(2)
  })
})

describe('en passant', () => {
  it('captures the adjacent double-stepped pawn from its actual square as Frost', () => {
    const state = lightEnPassantPosition()
    expect(destinations(state, 'light_4')).toContainEqual(['d6', 'en-passant'])
    const result = play(freezeGame(state), 'light_4', 3, 5)
    expect(result.receipt.kind).toBe('en-passant')
    expect(result.receipt.enPassant).toBe(true)
    expect(result.receipt.captured?.id).toBe('dark_3')
    expect(result.receipt.captured?.square).toEqual({ file: 3, rank: 4 })
    expect(result.receipt.to).toEqual({ file: 3, rank: 5 })
    expect(result.state.pieces.some((piece) => piece.id === 'dark_3')).toBe(
      false,
    )
    expect(at(result.state, 'light_4').square).toEqual({ file: 3, rank: 5 })
  })

  it('also permits the mirrored capture for Ember', () => {
    let state = play(createPawnGame(), 'light_0', 0, 2).state
    state = play(state, 'dark_4', 4, 4).state
    state = play(state, 'light_0', 0, 3).state
    state = play(state, 'dark_4', 4, 3).state
    state = play(state, 'light_3', 3, 3).state
    expect(destinations(state, 'dark_4')).toContainEqual(['d3', 'en-passant'])
    const result = play(state, 'dark_4', 3, 2)
    expect(result.receipt.enPassant).toBe(true)
    expect(result.receipt.captured?.square).toEqual({ file: 3, rank: 3 })
    expect(at(result.state, 'dark_4').square).toEqual({ file: 3, rank: 2 })
  })

  it('expires immediately when the player chooses another move', () => {
    let state = lightEnPassantPosition()
    state = play(state, 'light_7', 7, 2).state
    state = play(state, 'dark_7', 7, 5).state
    expect(destinations(state, 'light_4')).toEqual([['e6', 'advance']])
    expect(movePawn(state, 'light_4', { file: 3, rank: 5 })).toBeUndefined()
  })

  it('does not allow the special capture after an adjacent one-square step', () => {
    let state = play(createPawnGame(), 'light_4', 4, 3).state
    state = play(state, 'dark_3', 3, 5).state
    state = play(state, 'light_4', 4, 4).state
    state = play(state, 'dark_3', 3, 4).state
    expect(destinations(state, 'light_4')).toEqual([['e6', 'advance']])
  })

  it('captures the destination occupant normally instead of the adjacent pawn', () => {
    const state = lightEnPassantPosition()
    state.pieces.push(pawn('occupant', 'dark', 3, 5))
    const result = play(state, 'light_4', 3, 5)
    expect(result.receipt.kind).toBe('capture')
    expect(result.receipt.enPassant).toBe(false)
    expect(result.receipt.captured?.id).toBe('occupant')
    expect(result.state.pieces.some((piece) => piece.id === 'dark_3')).toBe(
      true,
    )
  })
})

describe('pawn-race outcomes', () => {
  it.each([
    ['light', 6, 7, 'dark', 6],
    ['dark', 1, 0, 'light', 1],
  ] as const)(
    'wins when %s reaches the far rank, then rejects further actions',
    (side, rank, destination, enemy, enemyRank) => {
      const state = position(
        [pawn('p', side, 0, rank), pawn('enemy', enemy, 7, enemyRank)],
        side,
      )
      const result = play(state, 'p', 0, destination)
      expect(result.state.winner).toBe(side)
      expect(result.state.winReason).toBe('finish')
      expect(result.state.pieces).toHaveLength(2)
      expect(legalPawnMoves(result.state, 'enemy')).toEqual([])
      expect(
        movePawn(result.state, 'enemy', {
          file: 7,
          rank: enemyRank + (enemy === 'light' ? 1 : -1),
        }),
      ).toBeUndefined()
      expect(selectPawn(result.state, 'enemy')).toBe(result.state)
    },
  )

  it('wins by capturing the last opponent', () => {
    const state = position([
      pawn('p', 'light', 3, 3),
      pawn('enemy', 'dark', 4, 4),
    ])
    const result = play(state, 'p', 4, 4)
    expect(result.state.winner).toBe('light')
    expect(result.state.winReason).toBe('elimination')
    expect(result.state.pieces).toEqual([pawn('p', 'light', 4, 4)])
  })

  it('awards the mover a win when the next player has no legal move', () => {
    const state = position([
      pawn('blocker', 'light', 0, 5),
      pawn('p', 'light', 7, 1, false),
      pawn('enemy', 'dark', 0, 6),
    ])
    const result = play(state, 'p', 7, 2)
    expect(result.state.turn).toBe('dark')
    expect(result.state.winner).toBe('light')
    expect(result.state.winReason).toBe('blocked')
    expect(result.state.pieces.some((piece) => piece.id === 'enemy')).toBe(true)
  })

  it('does not declare a blocked loss while any opponent can capture', () => {
    const state = position([
      pawn('blocker', 'light', 0, 5),
      pawn('target', 'light', 1, 5),
      pawn('p', 'light', 7, 1, false),
      pawn('enemy', 'dark', 0, 6),
    ])
    const result = play(state, 'p', 7, 2)
    expect(result.state.winner).toBeUndefined()
    expect(destinations(result.state, 'enemy')).toEqual([['b6', 'capture']])
  })
})
