/** Independent bounded chess-candidate drafts and library; corrupt saves are preserved for recovery. */
import { CHESS_CANDIDATE_JSON_LIMIT, parseChessCandidate, validateChessCandidate, } from './chessCandidate'
import type { ChessCandidate } from './chessCandidate'

export const CHESS_CANDIDATE_DRAFT_KEY = 'chess-candidate-draft-v1'
export const CHESS_CANDIDATE_LIBRARY_KEY = 'chess-candidate-library-v1'
export const CHESS_CANDIDATE_LIBRARY_LIMIT = 8
const LIBRARY_JSON_LIMIT = 2 * 1024 * 1024
type CandidateStorage = Pick<Storage, 'getItem' | 'setItem'>

function parseLibrary(raw: string | null): ChessCandidate[] {
  if (raw === null) return []
  if (raw.length > LIBRARY_JSON_LIMIT)
    throw new Error('The saved candidate library is too large.')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid chess candidate library.')
  const library = value as Record<string, unknown>
  if (
    library.format !== 'chess-candidate-library' ||
    library.version !== 1 ||
    !Array.isArray(library.candidates) ||
    library.candidates.length > CHESS_CANDIDATE_LIBRARY_LIMIT
  )
    throw new Error('Invalid chess candidate library.')
  const candidates = library.candidates.map(validateChessCandidate)
  if (
    new Set(candidates.map((candidate) => candidate.id)).size !==
    candidates.length
  )
    throw new Error('The saved candidate library contains duplicate IDs.')
  return candidates
}

export function saveChessCandidateDraft(
  value: ChessCandidate,
  storage: CandidateStorage = localStorage,
): ChessCandidate {
  const candidate = validateChessCandidate(value)
  const previous = storage.getItem(CHESS_CANDIDATE_DRAFT_KEY)
  if (previous !== null) parseChessCandidate(previous)
  storage.setItem(CHESS_CANDIDATE_DRAFT_KEY, JSON.stringify(candidate))
  return candidate
}

export function loadChessCandidateDraft(storage?: CandidateStorage): {
  candidate?: ChessCandidate
  error?: string
} {
  try {
    const raw = (storage ?? localStorage).getItem(CHESS_CANDIDATE_DRAFT_KEY)
    return raw === null ? {} : { candidate: parseChessCandidate(raw) }
  } catch {
    return {
      error:
        'The inspection draft could not be read. Its saved data has been kept.',
    }
  }
}

export function loadChessCandidateLibrary(storage?: CandidateStorage): {
  candidates: ChessCandidate[]
  error?: string
} {
  try {
    return {
      candidates: parseLibrary(
        (storage ?? localStorage).getItem(CHESS_CANDIDATE_LIBRARY_KEY),
      ),
    }
  } catch {
    return {
      candidates: [],
      error:
        'Saved chess candidates could not be read. The existing library has been kept.',
    }
  }
}

function writeLibrary(
  candidates: ChessCandidate[],
  storage: CandidateStorage,
): ChessCandidate[] {
  const raw = JSON.stringify({
    format: 'chess-candidate-library',
    version: 1,
    candidates,
  })
  if (raw.length > LIBRARY_JSON_LIMIT)
    throw new Error(
      'The candidate library is full. Export and remove an older candidate first.',
    )
  storage.setItem(CHESS_CANDIDATE_LIBRARY_KEY, raw)
  return candidates
}

/** An existing ID is explicitly updated; a new ID never evicts or silently replaces another candidate. */
export function saveChessCandidate(
  value: ChessCandidate,
  storage: CandidateStorage = localStorage,
): ChessCandidate[] {
  const candidate = validateChessCandidate(value)
  const existing = parseLibrary(storage.getItem(CHESS_CANDIDATE_LIBRARY_KEY))
  const index = existing.findIndex((item) => item.id === candidate.id)
  if (index >= 0) existing[index] = candidate
  else {
    if (existing.length >= CHESS_CANDIDATE_LIBRARY_LIMIT)
      throw new Error(
        'Eight candidates are saved. Export and remove one before saving another.',
      )
    existing.push(candidate)
  }
  return writeLibrary(existing, storage)
}

export function removeChessCandidate(
  id: string,
  storage: CandidateStorage = localStorage,
): ChessCandidate[] {
  const existing = parseLibrary(storage.getItem(CHESS_CANDIDATE_LIBRARY_KEY))
  return writeLibrary(
    existing.filter((candidate) => candidate.id !== id),
    storage,
  )
}

export { CHESS_CANDIDATE_JSON_LIMIT }
