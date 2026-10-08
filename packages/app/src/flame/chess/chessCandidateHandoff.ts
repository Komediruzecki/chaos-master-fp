/** A new editor snapshot waits here until the inspector accepts replacing its draft. */
import { parseChessCandidate, serializeChessCandidate } from './chessCandidate'
import type { ChessCandidate } from './chessCandidate'

export const CHESS_CANDIDATE_HANDOFF_KEY = 'chess-candidate-incoming-v1'
type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function saveChessCandidateHandoff(
  candidate: ChessCandidate,
  storage: HandoffStorage = sessionStorage,
): void {
  const raw = serializeChessCandidate(candidate)
  try {
    storage.setItem(CHESS_CANDIDATE_HANDOFF_KEY, raw)
  } catch {
    throw new Error(
      'This tab could not keep the new chess candidate. Your editor and inspection draft are unchanged.',
    )
  }
}

export function loadChessCandidateHandoff(storage?: HandoffStorage): {
  candidate?: ChessCandidate
  error?: string
} {
  try {
    const raw = (storage ?? sessionStorage).getItem(CHESS_CANDIDATE_HANDOFF_KEY)
    return raw === null ? {} : { candidate: parseChessCandidate(raw) }
  } catch {
    return {
      error:
        'The incoming chess candidate could not be read. Your existing inspection draft and incoming data have been kept.',
    }
  }
}

/** Clear only the snapshot this inspector read, never a later handoff. */
export function clearChessCandidateHandoff(
  id: string,
  storage: HandoffStorage = sessionStorage,
): void {
  const raw = storage.getItem(CHESS_CANDIDATE_HANDOFF_KEY)
  if (raw !== null && parseChessCandidate(raw).id === id) {
    storage.removeItem(CHESS_CANDIDATE_HANDOFF_KEY)
  }
}
