import { describe, expect, it } from 'vitest'
import { validateFlame } from '../schema/flameSchema'
import { createChessCandidate } from './chessCandidate'
import { CHESS_CANDIDATE_DRAFT_KEY, CHESS_CANDIDATE_LIBRARY_KEY, loadChessCandidateDraft, loadChessCandidateLibrary, removeChessCandidate, saveChessCandidate, saveChessCandidateDraft, } from './chessCandidateStorage'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

function candidate(name = 'Test') {
  return createChessCandidate(validateFlame({ transforms: {} }), name)
}

describe('chess candidate storage', () => {
  it('returns a recoverable message when the browser blocks access to localStorage itself', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    )
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Storage blocked')
      },
    })
    try {
      expect(loadChessCandidateDraft()).toMatchObject({
        error: expect.any(String),
      })
      expect(loadChessCandidateLibrary()).toMatchObject({
        candidates: [],
        error: expect.any(String),
      })
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('keeps draft, library, editor and pawn saves independent', () => {
    const store = storage()
    store.setItem('chaos-editor-draft', 'untouched')
    store.setItem('gummy-pawn-library-v1', 'untouched pawn')
    const original = candidate()
    saveChessCandidateDraft(original, store)
    saveChessCandidate(original, store)
    original.name = 'Changed later'
    expect(loadChessCandidateDraft(store).candidate!.name).toBe('Test')
    expect(loadChessCandidateLibrary(store).candidates[0]!.name).toBe('Test')
    expect(store.getItem('chaos-editor-draft')).toBe('untouched')
    expect(store.getItem('gummy-pawn-library-v1')).toBe('untouched pawn')
  })

  it('updates only the selected ID and refuses to evict candidates when full', () => {
    const store = storage()
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate(`Piece ${index}`),
    )
    for (const item of candidates) saveChessCandidate(item, store)
    const updated = { ...candidates[2]!, name: 'Updated' }
    saveChessCandidate(updated, store)
    expect(
      loadChessCandidateLibrary(store).candidates.map((item) => item.name),
    ).toEqual([
      'Piece 0',
      'Piece 1',
      'Updated',
      'Piece 3',
      'Piece 4',
      'Piece 5',
      'Piece 6',
      'Piece 7',
    ])
    const previous = store.getItem(CHESS_CANDIDATE_LIBRARY_KEY)
    expect(() => saveChessCandidate(candidate('Overflow'), store)).toThrow(
      'Eight candidates',
    )
    expect(store.getItem(CHESS_CANDIDATE_LIBRARY_KEY)).toBe(previous)
    removeChessCandidate(updated.id, store)
    expect(
      loadChessCandidateLibrary(store).candidates.map((item) => item.id),
    ).toEqual(
      candidates
        .filter((item) => item.id !== updated.id)
        .map((item) => item.id),
    )
  })

  it('refuses any rewrite of unreadable library and draft data', () => {
    const store = storage()
    store.setItem(CHESS_CANDIDATE_LIBRARY_KEY, '{broken saved artwork')
    store.setItem(CHESS_CANDIDATE_DRAFT_KEY, '{broken draft')
    expect(loadChessCandidateLibrary(store)).toMatchObject({
      candidates: [],
      error: expect.any(String),
    })
    expect(loadChessCandidateDraft(store)).toMatchObject({
      error: expect.any(String),
    })
    expect(() => saveChessCandidate(candidate(), store)).toThrow()
    expect(() => removeChessCandidate('unknown', store)).toThrow()
    expect(() => saveChessCandidateDraft(candidate(), store)).toThrow()
    expect(store.getItem(CHESS_CANDIDATE_LIBRARY_KEY)).toBe(
      '{broken saved artwork',
    )
    expect(store.getItem(CHESS_CANDIDATE_DRAFT_KEY)).toBe('{broken draft')
  })

  it('reports storage write failure without reporting a saved result', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded')
      },
    }
    expect(() => saveChessCandidate(candidate(), store)).toThrow(
      'Quota exceeded',
    )
    expect(() => saveChessCandidateDraft(candidate(), store)).toThrow(
      'Quota exceeded',
    )
  })
})
