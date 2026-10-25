/** Compare a sampled candidate with a neighbouring classic pawn using actual resting board meshes. */
import { createMemo } from 'solid-js'
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { BOARD_TILE_SIZE } from '../PawnBoard/pawnBoardMath'
import { RestPieceStage } from './RestPieceStage'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyBoardQuality } from '../GummyBoard/gummyBoardQuality'
import type { GummyBoardRestSource } from '../GummyBoard/gummyBoardRestSources'
import type { RestPieceScene, RestPieceStatus } from './RestPieceStage'

export type CandidateSolidStageProps = {
  source: GummyBoardRestSource
  geometryKey: string
  mould: 'rook' | 'bishop'
  palette?: GummyPalette
  quality?: GummyBoardQuality
  resetKey?: number
  onStatus?: (status: RestPieceStatus) => void
}

export function CandidateSolidStage(props: CandidateSolidStageProps) {
  const scene = createMemo<RestPieceScene>(() => {
    const source = props.source
    const halfTile = BOARD_TILE_SIZE / 2
    const scale = 0.9
    const pawn = GUMMY_CHESS_MOULDS.pawn.bounds
    const min = [0, 1, 2].map((axis) =>
      Math.min(
        source.bounds.min[axis]! * scale +
          (axis === 0 ? halfTile : axis === 2 ? halfTile : 0),
        pawn.min[axis]! * scale +
          (axis === 0 ? -halfTile : axis === 2 ? halfTile : 0),
      ),
    )
    const max = [0, 1, 2].map((axis) =>
      Math.max(
        source.bounds.max[axis]! * scale +
          (axis === 0 ? halfTile : axis === 2 ? halfTile : 0),
        pawn.max[axis]! * scale +
          (axis === 0 ? -halfTile : axis === 2 ? halfTile : 0),
      ),
    )
    return {
      key: `${props.geometryKey}:${props.mould}:${source.spacing}`,
      meshes: {
        artStyle: 'classic',
        restSpacing: 0.08,
        moulds: [props.mould, 'pawn'],
        restSources: { [props.mould]: source },
      },
      pieces: [
        {
          id: 0,
          mould: props.mould,
          position: [halfTile, 0, halfTile],
          side: 0,
          scale,
          palette: props.palette ?? 'blue',
        },
        {
          id: 1,
          mould: 'pawn',
          position: [-halfTile, 0, halfTile],
          side: 0,
          scale,
          palette: 'amber',
        },
      ],
      framing: {
        min: [min[0]!, min[1]!, min[2]!],
        max: [max[0]!, max[1]!, max[2]!],
        surfacePadding: source.spacing * 1.8,
      },
      inspectedMould: props.mould,
    }
  })
  return (
    <RestPieceStage
      {...props}
      scene={scene()}
      ariaLabel="Solid candidate beside a classic pawn"
      testId="candidate-solid-stage"
    />
  )
}
