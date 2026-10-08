/** Owns an inspection draft and its disposable native custom-variation registrations. */
import { batch, createEffect, createMemo, createSignal, on, onCleanup, untrack, } from 'solid-js'
import { candidateRenderFlame, createChessCandidate, parseChessCandidate, serializeChessCandidate, validateChessCandidate, } from '@/flame/chess/chessCandidate'
import { clearChessCandidateHandoff, loadChessCandidateHandoff, } from '@/flame/chess/chessCandidateHandoff'
import { loadChessCandidateDraft, loadChessCandidateLibrary, removeChessCandidate, saveChessCandidate, saveChessCandidateDraft, } from '@/flame/chess/chessCandidateStorage'
import { createChessCandidateVariations } from '@/flame/chess/chessCandidateVariations'
import { buildFigurineStudy, FIGURINE_STUDIES, } from '@/flame/chess/figurineStudies'
import { downloadBlob } from '@/utils/blob'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'
import type { FigurineStudyId } from '@/flame/chess/figurineStudies'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not save this candidate.'

export function useChessCandidate() {
  const draft = loadChessCandidateDraft()
  const library = loadChessCandidateLibrary()
  const incoming = loadChessCandidateHandoff()
  const [candidate, setCandidate] = createSignal<ChessCandidate | undefined>(
    draft.candidate,
  )
  const [saved, setSaved] = createSignal(library.candidates)
  const [notice, setNotice] = createSignal(
    draft.error ?? library.error ?? incoming.error ?? '',
  )
  const [draftStatus, setDraftStatus] = createSignal('')
  const [source, setSource] = createSignal<FlameDescriptor>()
  const [sourceError, setSourceError] = createSignal('')
  const [view, setView] = createSignal<'source' | 'fit'>('fit')
  const [resetKey, setResetKey] = createSignal(0)
  const [pending, setPending] = createSignal<ChessCandidate>()
  // on() tracks the signal read by its dependency function; it does not compare
  // the returned source object. These memos keep metadata/fit edits from
  // disposing the source registrations and briefly unmounting the canvas.
  const candidateSource = createMemo(() => candidate()?.source)
  const candidatePlacement = createMemo(() => candidate()?.placement)
  let importGeneration = 0
  let mounted = true
  let incomingResolved = !incoming.candidate
  onCleanup(() => {
    mounted = false
  })

  createEffect(
    on(candidateSource, (next) => {
      setSource(undefined)
      setSourceError('')
      if (!next) return
      let disposed = false
      let dispose: (() => void) | undefined
      onCleanup(() => {
        disposed = true
        // Let the outgoing canvas dispose before releasing its custom shader IDs.
        queueMicrotask(() => dispose?.())
      })
      const current = candidate()
      if (!current) return
      void createChessCandidateVariations(current)
        .then((prepared) => {
          if (disposed) {
            prepared.dispose()
            return
          }
          dispose = prepared.dispose
          setSource(prepared.flame)
        })
        .catch((error: unknown) => {
          if (!disposed) setSourceError(messageOf(error))
        })
    }),
  )

  createEffect(() => {
    const current = candidate()
    if (!current) return
    setDraftStatus('Saving draft…')
    const timer = setTimeout(() => {
      try {
        saveChessCandidateDraft(current)
        setDraftStatus('Draft saved on this device')
      } catch (error) {
        setDraftStatus(messageOf(error))
      }
    }, 300)
    onCleanup(() => {
      clearTimeout(timer)
    })
  })

  const flame = createMemo(() => {
    const original = source()
    const placement = candidatePlacement()
    const current = untrack(candidate)
    if (!original || !placement || !current) return undefined
    return view() === 'source'
      ? original
      : candidateRenderFlame(current, original)
  })

  function clearIncoming() {
    if (incomingResolved || !incoming.candidate) return
    clearChessCandidateHandoff(incoming.candidate.id)
    incomingResolved = true
  }

  function apply(next: ChessCandidate) {
    if (!incomingResolved) {
      try {
        // A new editor visit must not erase the previous draft on arrival.
        // Commit the accepted replacement before consuming its tab handoff.
        saveChessCandidateDraft(next)
        clearIncoming()
      } catch (error) {
        setNotice(messageOf(error))
        return
      }
    }
    batch(() => {
      setPending(undefined)
      setCandidate(next)
      setView('fit')
      setResetKey((key) => key + 1)
      setNotice('')
    })
  }

  function select(next: ChessCandidate) {
    importGeneration++
    const current = candidate()
    if (current && JSON.stringify(current) === JSON.stringify(next)) {
      try {
        clearIncoming()
      } catch (error) {
        setNotice(messageOf(error))
      }
      return
    }
    const stored = saved().find((item) => item.id === current?.id)
    if (current && JSON.stringify(current) !== JSON.stringify(stored)) {
      setPending(next)
    } else apply(next)
  }

  function replace(saveFirst: boolean) {
    const next = pending()
    if (!next || (saveFirst && !save())) return
    apply(next)
  }

  function study(id: FigurineStudyId) {
    try {
      const next = createChessCandidate(buildFigurineStudy(id))
      next.role =
        FIGURINE_STUDIES.find((item) => item.id === id)?.piece ?? 'pawn'
      select(next)
    } catch (error) {
      setNotice(messageOf(error))
    }
  }

  function update(change: Partial<Omit<ChessCandidate, 'source'>>) {
    setCandidate((current) => (current ? { ...current, ...change } : current))
  }

  function save() {
    const current = candidate()
    if (!current) return false
    try {
      const checked = validateChessCandidate(current)
      saveChessCandidateDraft(checked)
      saveChessCandidate(checked)
      setSaved(loadChessCandidateLibrary().candidates)
      setNotice(`Saved ${checked.name} to your candidate library.`)
      return true
    } catch (error) {
      setNotice(messageOf(error))
      return false
    }
  }

  function download() {
    const current = candidate()
    if (!current) return
    try {
      downloadBlob(
        new Blob([serializeChessCandidate(current)], {
          type: 'application/json',
        }),
        'chess-piece-candidate.json',
      )
    } catch (error) {
      setNotice(messageOf(error))
    }
  }

  function remove() {
    const current = candidate()
    if (!current) return
    try {
      setSaved(removeChessCandidate(current.id))
      setNotice(
        'Removed the saved copy. The current inspection draft is still open.',
      )
    } catch (error) {
      setNotice(messageOf(error))
    }
  }

  async function importFile(file: File) {
    const generation = ++importGeneration
    try {
      if (file.size > 512 * 1024)
        throw new Error('Choose a candidate file smaller than 512 KiB.')
      const text = await file.text()
      if (mounted && generation === importGeneration)
        select(parseChessCandidate(text))
    } catch (error) {
      if (mounted && generation === importGeneration)
        setNotice(messageOf(error))
    }
  }

  function saveDraftBeforeLeaving() {
    const current = candidate()
    if (!current) return true
    try {
      saveChessCandidateDraft(current)
      return true
    } catch (error) {
      setNotice(messageOf(error))
      return false
    }
  }

  // Run the ordinary replacement gate after reading the old draft. The editor
  // sends into a separate slot so unsaved fit, role and name edits remain here.
  if (incoming.candidate) select(incoming.candidate)

  return {
    candidate,
    saved,
    notice,
    draftStatus,
    sourceError,
    flame,
    view,
    setView,
    resetKey,
    pending,
    replace,
    cancelReplace: () => {
      try {
        clearIncoming()
        setPending(undefined)
      } catch (error) {
        setNotice(messageOf(error))
      }
    },
    resetView: () => setResetKey((key) => key + 1),
    select,
    study,
    update,
    save,
    download,
    remove,
    importFile,
    saveDraftBeforeLeaving,
  }
}
