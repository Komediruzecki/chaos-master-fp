/** Inspector flows preserve source data while fitting, saving and recovering candidates. */
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChessCandidate } from '@/flame/chess/chessCandidate'
import { loadChessCandidateHandoff, saveChessCandidateHandoff, } from '@/flame/chess/chessCandidateHandoff'
import { CHESS_CANDIDATE_DRAFT_KEY, CHESS_CANDIDATE_LIBRARY_KEY, loadChessCandidateDraft, loadChessCandidateLibrary, saveChessCandidateDraft, } from '@/flame/chess/chessCandidateStorage'
import { buildFigurineStudy } from '@/flame/chess/figurineStudies'
import { examples } from '@/flame/examples'
import { ChessForgePage } from './ChessForgePage'
import type { PawnStageProps } from '@/components/PawnStage/PawnStage'

const preview = vi.hoisted(() => ({
  props: undefined as PawnStageProps | undefined,
  prepared: vi.fn(),
  disposed: vi.fn(),
}))
vi.mock('@/components/PawnStage/PawnStage', () => ({
  PawnStage: (props: PawnStageProps) => {
    preview.props = props
    return <div data-testid="native-candidate" />
  },
}))
vi.mock('@/flame/chess/chessCandidateVariations', () => ({
  createChessCandidateVariations: (
    candidate: ReturnType<typeof createChessCandidate>,
  ) => {
    preview.prepared(candidate.source)
    return Promise.resolve({
      flame: structuredClone(candidate.source.flame),
      dispose: preview.disposed,
    })
  },
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  preview.prepared.mockClear()
  preview.disposed.mockClear()
})
afterEach(() => {
  cleanup()
  preview.props = undefined
})

describe('Chess piece inspector', () => {
  it('opens a fresh editor handoff and keeps it as the new inspection draft', async () => {
    const incoming = createChessCandidate(
      buildFigurineStudy('menger-rook'),
      'New editor shape',
    )
    saveChessCandidateHandoff(incoming)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'New editor shape',
    )
    expect(loadChessCandidateDraft().candidate).toEqual(incoming)
    expect(loadChessCandidateHandoff().candidate).toBeUndefined()
  })

  it('keeps an unsaved existing draft when a new editor handoff arrives and is cancelled', async () => {
    const draft = createChessCandidate(
      buildFigurineStudy('menger-rook'),
      'Fitted tower',
    )
    draft.role = 'rook'
    draft.placement.scale = 0.8
    draft.placement.rotation[1] = 0.4
    const incoming = createChessCandidate(
      buildFigurineStudy('branching-knight'),
      'Editor knight',
    )
    saveChessCandidateDraft(draft)
    saveChessCandidateHandoff(incoming)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    expect(
      view.getByRole('group', { name: 'Replace inspection draft' }),
    ).toBeTruthy()
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'Fitted tower',
    )
    expect(loadChessCandidateDraft().candidate).toEqual(draft)
    expect(loadChessCandidateHandoff().candidate).toEqual(incoming)
    fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
    expect(loadChessCandidateDraft().candidate).toEqual(draft)
    expect(loadChessCandidateLibrary().candidates).toEqual([])
    expect(loadChessCandidateHandoff().candidate).toBeUndefined()
  })

  it('saves the old draft before accepting a new editor candidate', async () => {
    const draft = createChessCandidate(
      buildFigurineStudy('menger-rook'),
      'Keep fitted tower',
    )
    draft.role = 'rook'
    draft.placement.scale = 0.8
    const incoming = createChessCandidate(
      buildFigurineStudy('branching-knight'),
      'New knight',
    )
    saveChessCandidateDraft(draft)
    saveChessCandidateHandoff(incoming)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    fireEvent.click(view.getByRole('button', { name: 'Save & open' }))
    expect(loadChessCandidateLibrary().candidates).toEqual([draft])
    expect(loadChessCandidateDraft().candidate).toEqual(incoming)
    expect(loadChessCandidateHandoff().candidate).toBeUndefined()
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'New knight',
    )
  })

  it('keeps the queued candidate and old draft if replacement storage fails', async () => {
    const draft = createChessCandidate(
      buildFigurineStudy('menger-rook'),
      'Kept draft',
    )
    const incoming = createChessCandidate(
      buildFigurineStudy('branching-knight'),
      'Queued knight',
    )
    saveChessCandidateDraft(draft)
    saveChessCandidateHandoff(incoming)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage refused')
    })
    fireEvent.click(view.getByRole('button', { name: 'Replace draft' }))
    write.mockRestore()
    expect(loadChessCandidateDraft().candidate).toEqual(draft)
    expect(loadChessCandidateHandoff().candidate).toEqual(incoming)
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'Kept draft',
    )
    expect(
      view.getByRole('group', { name: 'Replace inspection draft' }),
    ).toBeTruthy()
  })

  it('does not overwrite corrupt draft data when an editor handoff arrives', () => {
    localStorage.setItem(CHESS_CANDIDATE_DRAFT_KEY, '{broken-draft')
    const incoming = createChessCandidate(
      buildFigurineStudy('menger-rook'),
      'Queued rook',
    )
    saveChessCandidateHandoff(incoming)
    const view = render(() => <ChessForgePage />)
    expect(view.queryByTestId('native-candidate')).toBeNull()
    expect(localStorage.getItem(CHESS_CANDIDATE_DRAFT_KEY)).toBe(
      '{broken-draft',
    )
    expect(loadChessCandidateHandoff().candidate).toEqual(incoming)
  })

  it('fits a study and saves a role without changing its original maps or camera', async () => {
    const view = render(() => <ChessForgePage />)
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'menger-rook' },
    })
    await view.findByTestId('native-candidate')
    const original = buildFigurineStudy('menger-rook')
    expect(preview.props?.camera3D?.target).toEqual([0, 0.9, 0])
    expect(preview.props?.fitGuide?.squareSize).toBe(1.6)
    fireEvent.input(view.getByRole('slider', { name: 'Rotate Y' }), {
      target: { value: '42' },
    })
    fireEvent.input(view.getByLabelText('Inspection scale'), {
      target: { value: '0.8' },
    })
    const fittedFlame = preview.props?.flame
    fireEvent.input(view.getByLabelText('Candidate name'), {
      target: { value: 'Window tower' },
    })
    fireEvent.change(view.getByLabelText('Chess role'), {
      target: { value: 'rook' },
    })
    expect(preview.props?.flame).toBe(fittedFlame)
    expect(preview.prepared).toHaveBeenCalledTimes(1)
    expect(preview.disposed).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Save candidate' }))
    const stored = loadChessCandidateLibrary().candidates[0]!
    expect(stored.role).toBe('rook')
    expect(stored.placement.rotation[1]).toBeCloseTo((42 * Math.PI) / 180)
    expect(stored.placement.scale).toBe(0.8)
    expect(stored.source.flame).toEqual(original)
    expect(preview.props?.flame.finalTransform).not.toEqual(
      original.finalTransform,
    )
    fireEvent.click(view.getByLabelText('Fractal source'))
    expect(preview.props?.flame).toEqual(original)
    expect(preview.props?.fitGuide).toBeUndefined()
    expect(preview.props?.camera3D).toBeUndefined()
    expect(loadChessCandidateDraft().candidate?.name).toBe('Window tower')
    expect(view.queryByRole('button', { name: 'Use in chess' })).toBeNull()
    expect(preview.prepared).toHaveBeenCalledTimes(1)
    expect(preview.disposed).not.toHaveBeenCalled()
  })

  it('restores a saved draft and removes a library copy without losing the open draft', async () => {
    const candidate = createChessCandidate(
      buildFigurineStudy('branching-knight'),
      'My knight',
    )
    candidate.role = 'knight'
    saveChessCandidateDraft(candidate)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'My knight',
    )
    fireEvent.click(view.getByRole('button', { name: 'Save candidate' }))
    fireEvent.click(view.getByRole('button', { name: 'Remove saved copy' }))
    expect(loadChessCandidateLibrary().candidates).toEqual([])
    expect(loadChessCandidateDraft().candidate?.id).toBe(candidate.id)
    expect(view.getByTestId('native-candidate')).toBeTruthy()
  })

  it('keeps 2D sources flat, retains their blend and hides 3D fitting', async () => {
    const candidate = createChessCandidate(examples.example1, 'Flat candidate')
    candidate.source.flame.renderSettings.blendFlame = structuredClone(
      examples.example2,
    )
    candidate.source.flame.renderSettings.blendWeight = 0.4
    saveChessCandidateDraft(candidate)
    const view = render(() => <ChessForgePage />)
    await view.findByTestId('native-candidate')
    expect(preview.props?.flame.renderSettings.dimensions).toBe(2)
    expect(preview.props?.blendWeight).toBe(0.4)
    expect(preview.props?.blendFlame).toEqual(examples.example2)
    expect(view.queryByLabelText('Rotate Y')).toBeNull()
    expect(view.getByText(/This source is 2D/)).toBeTruthy()
  })

  it('reports unreadable saved data and leaves it untouched', async () => {
    localStorage.setItem(CHESS_CANDIDATE_DRAFT_KEY, '{broken-draft')
    localStorage.setItem(CHESS_CANDIDATE_LIBRARY_KEY, '{broken-library')
    const view = render(() => <ChessForgePage />)
    expect(view.getByText(/inspection draft could not be read/)).toBeTruthy()
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'menger-rook' },
    })
    await view.findByTestId('native-candidate')
    fireEvent.click(view.getByRole('button', { name: 'Save candidate' }))
    expect(localStorage.getItem(CHESS_CANDIDATE_LIBRARY_KEY)).toBe(
      '{broken-library',
    )
    await waitFor(() => {
      expect(localStorage.getItem(CHESS_CANDIDATE_DRAFT_KEY)).toBe(
        '{broken-draft',
      )
    })
  })

  it('does not partially save a library copy when the protected draft cannot be written', async () => {
    localStorage.setItem(CHESS_CANDIDATE_DRAFT_KEY, '{broken-draft')
    const view = render(() => <ChessForgePage />)
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'menger-rook' },
    })
    await view.findByTestId('native-candidate')
    fireEvent.click(view.getByRole('button', { name: 'Save candidate' }))
    expect(localStorage.getItem(CHESS_CANDIDATE_LIBRARY_KEY)).toBeNull()
    expect(localStorage.getItem(CHESS_CANDIDATE_DRAFT_KEY)).toBe(
      '{broken-draft',
    )
  })

  it('releases owned custom registrations when changing source and leaving the inspector', async () => {
    const view = render(() => <ChessForgePage />)
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'menger-rook' },
    })
    await view.findByTestId('native-candidate')
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'sierpinski-bishop' },
    })
    expect(
      view.getByRole('group', { name: 'Replace inspection draft' }),
    ).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Replace draft' }))
    expect(preview.prepared).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(preview.disposed).toHaveBeenCalledTimes(1)
    })
    view.unmount()
    await waitFor(() => {
      expect(preview.disposed).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps unsaved edits when replacement is cancelled and saves them before Save & open', async () => {
    const view = render(() => <ChessForgePage />)
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'menger-rook' },
    })
    await view.findByTestId('native-candidate')
    fireEvent.input(view.getByLabelText('Candidate name'), {
      target: { value: 'Keep this tower' },
    })
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'sierpinski-bishop' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      'Keep this tower',
    )
    expect(
      view.queryByRole('group', { name: 'Replace inspection draft' }),
    ).toBeNull()
    expect(preview.disposed).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Start from a study'), {
      target: { value: 'sierpinski-bishop' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Save & open' }))
    await waitFor(() => {
      expect(preview.disposed).toHaveBeenCalledTimes(1)
    })
    const saved = loadChessCandidateLibrary().candidates
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('Keep this tower')
    expect(saved[0]!.source.flame).toEqual(buildFigurineStudy('menger-rook'))
    expect(view.getByLabelText<HTMLInputElement>('Candidate name').value).toBe(
      buildFigurineStudy('sierpinski-bishop').metadata.name,
    )
  })
})
