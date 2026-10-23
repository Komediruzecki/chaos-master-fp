/** Select the three glass studies without changing their original native flame recipes. */
import { createMemo, For } from 'solid-js'
import { getFractalStudyGlassRole } from '@/flame/chess/fractalStudyGlass'
import ui from './ChessCollectionsPage.module.css'
import type { CollectionEnclosure, CollectionView, } from '@/components/FractalCollection/collectionStageLayout'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'

const STUDIES = [
  {
    collection: 'wild-canopy',
    role: 'knight',
    name: 'Fern knight',
    detail: 'Bent frond',
  },
  {
    collection: 'tidal-relics',
    role: 'bishop',
    name: 'Split-current bishop',
    detail: 'Split current',
  },
  {
    collection: 'lattice-court',
    role: 'rook',
    name: 'Window rook',
    detail: 'Window tower',
  },
] as const

type Props = {
  collectionId: string
  role: ChessCandidateRole
  view: CollectionView
  enclosure: CollectionEnclosure
  onEnclosure: (enclosure: CollectionEnclosure) => void
  onStudy: (collection: string, role: ChessCandidateRole) => void
}

export function collectionGlassCaption(
  view: CollectionView,
  enclosure: CollectionEnclosure,
  supportedRole: ChessCandidateRole | undefined,
  selectedRole: ChessCandidateRole,
): string {
  if (enclosure === 'pure')
    return 'Original fractals. Choose Glass or Both to compare the selected study.'
  if (!supportedRole) return 'This collection has no glass study yet.'
  if (view === 'solo' && selectedRole !== supportedRole)
    return `The glass study is the ${supportedRole}. Select it to compare.`
  if (enclosure === 'glass')
    return `The ${supportedRole} sits inside clear glass. Its fractal stays unchanged.`
  if (view === 'board')
    return `Compare each side’s ${supportedRole}s: files a–d are pure; files e–h have glass.`
  if (view === 'lineup')
    return `The two ${supportedRole}s share their shape and colour: pure first, then glass.`
  return 'Same shape and colour. At the starting angle: pure left, glass right.'
}

export function CollectionGlassControls(props: Props) {
  const caption = createMemo(() =>
    collectionGlassCaption(
      props.view,
      props.enclosure,
      getFractalStudyGlassRole(props.collectionId),
      props.role,
    ),
  )
  return (
    <fieldset class={ui.field}>
      <legend>Glass studies</legend>
      <div class={ui.studies}>
        <For each={STUDIES}>
          {(study) => (
            <button
              type="button"
              aria-pressed={
                props.collectionId === study.collection &&
                props.role === study.role
              }
              onClick={() => {
                props.onStudy(study.collection, study.role)
              }}
            >
              <span>{study.name}</span>
              <small>{study.detail}</small>
            </button>
          )}
        </For>
      </div>
      <div class={ui.segmented} aria-label="Fractal enclosure">
        <For each={['pure', 'glass', 'both'] as const}>
          {(mode) => (
            <button
              type="button"
              aria-pressed={props.enclosure === mode}
              onClick={() => {
                props.onEnclosure(mode)
              }}
            >
              {mode === 'pure' ? 'Pure' : mode === 'glass' ? 'Glass' : 'Both'}
            </button>
          )}
        </For>
      </div>
      <p class={ui.glassCaption}>{caption()}</p>
    </fieldset>
  )
}
