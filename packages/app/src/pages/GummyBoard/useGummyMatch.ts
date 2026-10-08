/** Keep legal game state separate from a skippable presentation of the last move. */
import { applyChessMove, claimChessDraw, createChessGame, importChessPgn, legalChessMoves, seekChessGame, undoChessMove, } from '@chaos-master/core/chess/chessGame'
import { batch, createMemo, createSignal } from 'solid-js'
import { createGummyMatchCapturePresentation, createGummyMatchCaptures, matchesGummyCapture, } from './gummyMatchCaptures'
import { defaultGummyMatchAppearance, loadGummyMatchSession, saveGummyMatchSession, } from './gummyMatchSession'
import type { ChessDrawClaim, ChessGame, ChessMoveInput, ChessMoveReceipt, ChessSquare, } from '@chaos-master/core/chess/chessGame'
import type { GummyMatchAppearance } from './gummyMatchSession'

export function useGummyMatch() {
  const restored = loadGummyMatchSession()
  const [game, setGame] = createSignal(
    restored.session?.game ?? createChessGame(),
  )
  const [cursor, setCursor] = createSignal(restored.session?.cursor ?? 0)
  const [appearance, setAppearance] = createSignal(
    restored.session?.appearance ?? defaultGummyMatchAppearance(),
  )
  const [captures, setCaptures] = createSignal(restored.session?.captures ?? [])
  const [headers, setHeaders] = createSignal<Record<string, string>>(
    restored.session?.headers ?? {},
  )
  const [selectedSquare, setSelectedSquare] = createSignal<ChessSquare>()
  const [receipt, setReceipt] = createSignal<ChessMoveReceipt>()
  const [promotion, setPromotion] =
    createSignal<ReturnType<typeof legalChessMoves>>()
  const [notice, setNotice] = createSignal(restored.error ?? '')
  const [error, setError] = createSignal('')
  const current = createMemo(() =>
    cursor() === game().history.length
      ? game()
      : seekChessGame(game(), cursor()),
  )
  const position = createMemo(() => current().position)
  const legalMoves = createMemo(() =>
    selectedSquare() ? legalChessMoves(current(), selectedSquare()) : [],
  )
  const legalSquares = createMemo(() => [
    ...new Set(legalMoves().map((move) => move.to)),
  ])
  const currentMove = createMemo(() => game().history[cursor() - 1])
  const currentPresentation = createMemo(() => {
    const move = currentMove()
    return move
      ? captures().find((entry) => matchesGummyCapture(entry, move))
      : undefined
  })
  const activePresentation = createMemo(() => {
    const move = receipt()
    return move
      ? captures().find((entry) => matchesGummyCapture(entry, move))
      : undefined
  })
  const reviewing = createMemo(() => cursor() < game().history.length)

  function persist(next = game(), ply = cursor(), nextHeaders = headers()) {
    try {
      saveGummyMatchSession({
        game: next,
        cursor: ply,
        headers: nextHeaders,
        appearance: appearance(),
        captures: captures(),
      })
      setNotice('')
      return true
    } catch {
      setNotice(
        'This match works for this visit, but the browser could not save it. Copy the PGN before leaving.',
      )
      return false
    }
  }

  function clearSelection() {
    setSelectedSquare(undefined)
    setPromotion(undefined)
  }

  function commit(move: ChessMoveInput) {
    if (receipt()) return
    try {
      const result = applyChessMove(current(), move)
      const retained = captures().filter(
        (entry) => entry.ply < result.receipt.ply,
      )
      const presentation = createGummyMatchCapturePresentation(
        result.receipt,
        appearance(),
        retained.at(-1),
      )
      batch(() => {
        setCaptures(presentation ? [...retained, presentation] : retained)
        setGame(result.game)
        setCursor(result.game.history.length)
        setReceipt(result.receipt)
        clearSelection()
        setError('')
      })
      persist()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That move could not be played.',
      )
    }
  }

  function selectSquare(square: string) {
    if (receipt() || promotion() || position().status !== 'active') return
    const destinations = legalMoves().filter((move) => move.to === square)
    if (destinations.length > 1) {
      setPromotion(destinations)
      return
    }
    if (destinations[0]) {
      commit(destinations[0])
      return
    }
    const piece = position().pieces.find(
      (candidate) => candidate.square === square,
    )
    setSelectedSquare(
      piece?.color === position().turn && square !== selectedSquare()
        ? piece.square
        : undefined,
    )
    setError('')
  }

  function seek(ply: number) {
    if (
      receipt() ||
      !Number.isInteger(ply) ||
      ply < 0 ||
      ply > game().history.length
    )
      return
    batch(() => {
      setCursor(ply)
      clearSelection()
      setError('')
    })
    persist()
  }

  function replay() {
    const move = currentMove()
    if (receipt() || !move) return
    clearSelection()
    setReceipt({ ...move })
  }

  function undo() {
    if (receipt() || cursor() === 0) return
    const next = undoChessMove(current())
    batch(() => {
      setGame(next)
      setCaptures((entries) =>
        entries.filter((entry) => entry.ply <= next.history.length),
      )
      setCursor(next.history.length)
      clearSelection()
      setError('')
    })
    persist()
  }

  function replace(next: ChessGame, nextHeaders: Record<string, string>) {
    batch(() => {
      setGame(next)
      setCaptures(createGummyMatchCaptures(next, appearance()))
      setCursor(0)
      setHeaders(nextHeaders)
      clearSelection()
      setError('')
    })
    persist()
  }

  function importPgn(text: string) {
    if (receipt()) return false
    try {
      const imported = importChessPgn(text)
      replace(imported.game, imported.headers)
      return true
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The PGN could not be imported.',
      )
      return false
    }
  }

  function claim(reason: ChessDrawClaim) {
    if (receipt()) return
    try {
      const claimed = claimChessDraw(current(), reason)
      batch(() => {
        setGame(claimed)
        setCaptures((entries) =>
          entries.filter((entry) => entry.ply <= claimed.history.length),
        )
        clearSelection()
      })
      persist()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'This draw cannot be claimed.',
      )
    }
  }

  return {
    appearance,
    updateAppearance: (patch: Partial<GummyMatchAppearance>) => {
      if (receipt()) return
      setAppearance((current) => ({ ...current, ...patch }))
      persist()
    },
    game,
    cursor,
    headers,
    position,
    selectedSquare,
    legalMoves,
    legalSquares,
    receipt,
    promotion,
    currentMove,
    currentPresentation,
    activePresentation,
    reviewing,
    notice,
    error,
    selectSquare,
    commit,
    seek,
    replay,
    undo,
    importPgn,
    claim,
    persist,
    clearSelection,
    finishAnimation: (completed?: ChessMoveReceipt) => {
      if (!completed || completed === receipt()) setReceipt(undefined)
    },
    newGame: () => {
      if (!receipt()) replace(createChessGame(), {})
    },
  }
}
