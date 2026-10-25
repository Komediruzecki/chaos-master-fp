/** Inspect the exact authored pawn resting mesh through the shared board-material stage. */
import { createMemo } from 'solid-js'
import { gummyAuthoredPawnKey } from '@/simulation/gummy/gummyAuthoredPawn'
import { RestPieceStage } from './RestPieceStage'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyBoardQuality } from '../GummyBoard/gummyBoardQuality'
import type { RestPieceScene, RestPieceStatus } from './RestPieceStage'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export type PlayablePawnStatus = RestPieceStatus
export type PlayablePawnStageProps = {
  pawn: GummyAuthoredPawn
  palette?: GummyPalette
  quality?: GummyBoardQuality
  resetKey?: number
  onStatus?: (status: PlayablePawnStatus) => void
}

export function PlayablePawnStage(props: PlayablePawnStageProps) {
  const scene = createMemo<RestPieceScene>(() => ({
    key: gummyAuthoredPawnKey(props.pawn),
    meshes: {
      artStyle: 'sculpted',
      authoredPawn: { ...props.pawn, name: 'Playable pawn' },
      restSpacing: 0.08,
      moulds: ['pawn'],
    },
    pieces: [
      {
        id: 0,
        mould: 'pawn',
        position: [0.8, 0, 0.8],
        side: props.pawn.recipe.side === 'dark' ? 1 : 0,
        scale: 0.9,
        palette: props.palette ?? 'marble',
      },
    ],
    framing: {
      min: [-0.08, 0, -0.08],
      max: [1.68, 2.48, 1.68],
      surfacePadding: 0.06,
    },
    inspectedMould: 'pawn',
  }))
  return (
    <RestPieceStage
      {...props}
      scene={scene()}
      ariaLabel="Playable gummy pawn"
      testId="playable-pawn-stage"
    />
  )
}
