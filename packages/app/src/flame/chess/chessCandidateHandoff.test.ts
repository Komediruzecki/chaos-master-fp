/** Incoming editor candidates never replace the persistent draft before a choice. */
import { beforeEach, describe, expect, it } from 'vitest'
import { examples } from '../examples'
import { CHESS_CANDIDATE_SOLID_DEFAULT, createChessCandidate, validateChessCandidate, } from './chessCandidate'
import { CHESS_CANDIDATE_HANDOFF_KEY, clearChessCandidateHandoff, loadChessCandidateHandoff, saveChessCandidateHandoff, } from './chessCandidateHandoff'
import { CHESS_CANDIDATE_DRAFT_KEY } from './chessCandidateStorage'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('incoming chess candidate handoff', () => {
  it('retains a version 2 solid request and its original native source in an owned tab-local snapshot', () => {
    const candidate = validateChessCandidate({
      ...createChessCandidate(examples.example1),
      version: 2,
      solid: { ...CHESS_CANDIDATE_SOLID_DEFAULT, seed: 0, spacing: 0.06 },
    })
    const expected = JSON.parse(JSON.stringify(candidate)) as unknown
    saveChessCandidateHandoff(candidate)
    candidate.solid!.thickness = 0.18
    candidate.source.flame.metadata.name = 'Edited after handoff'
    expect(loadChessCandidateHandoff().candidate).toEqual(expected)
  })

  it('queues a copy in this tab without touching the existing persistent draft', () => {
    localStorage.setItem(CHESS_CANDIDATE_DRAFT_KEY, 'existing draft bytes')
    const candidate = createChessCandidate(examples.example1, 'Incoming source')
    saveChessCandidateHandoff(candidate)
    candidate.name = 'Later editor change'
    expect(loadChessCandidateHandoff().candidate?.name).toBe('Incoming source')
    expect(localStorage.getItem(CHESS_CANDIDATE_DRAFT_KEY)).toBe(
      'existing draft bytes',
    )
    expect(localStorage.getItem(CHESS_CANDIDATE_HANDOFF_KEY)).toBeNull()
  })

  it('only clears the candidate the inspector actually accepted or cancelled', () => {
    const earlier = createChessCandidate(examples.example1)
    const later = createChessCandidate(examples.example2)
    saveChessCandidateHandoff(earlier)
    saveChessCandidateHandoff(later)
    clearChessCandidateHandoff(earlier.id)
    expect(loadChessCandidateHandoff().candidate).toEqual(later)
    clearChessCandidateHandoff(later.id)
    expect(loadChessCandidateHandoff()).toEqual({})
  })

  it('reports unreadable incoming data without deleting it', () => {
    sessionStorage.setItem(CHESS_CANDIDATE_HANDOFF_KEY, '{broken')
    expect(loadChessCandidateHandoff()).toMatchObject({
      error: expect.stringContaining('kept'),
    })
    expect(() => {
      clearChessCandidateHandoff('some-id')
    }).toThrow()
    expect(sessionStorage.getItem(CHESS_CANDIDATE_HANDOFF_KEY)).toBe('{broken')
  })

  it('leaves the previous incoming snapshot intact if storage refuses a new one', () => {
    const candidate = createChessCandidate(examples.example1)
    saveChessCandidateHandoff(candidate)
    const storage = {
      getItem: (key: string) => sessionStorage.getItem(key),
      setItem: () => {
        throw new Error('Quota exceeded')
      },
      removeItem: (key: string) => {
        sessionStorage.removeItem(key)
      },
    }
    expect(() => {
      saveChessCandidateHandoff(
        createChessCandidate(examples.example2),
        storage,
      )
    }).toThrow('unchanged')
    expect(loadChessCandidateHandoff().candidate).toEqual(candidate)
  })
})
