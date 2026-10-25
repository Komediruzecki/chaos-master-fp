/** Serializable chess candidate contracts, independent of validation and placement. */
import type { FlameDescriptor } from '../schema/flameSchema'
import type { CustomVariationDef } from '../variations/custom/types'
import type { ChessCandidateSolid } from './chessCandidateSolid'

export type ChessCandidateRole =
  | 'pawn'
  | 'rook'
  | 'knight'
  | 'bishop'
  | 'queen'
  | 'king'

export type ChessCandidate = {
  format: 'chess-piece-candidate'
  version: 1 | 2
  id: string
  name: string
  role: ChessCandidateRole
  source: { flame: FlameDescriptor; customVariations: CustomVariationDef[] }
  /** Only version 2 may carry a finite-solid request. Native source data stays unchanged. */
  solid?: ChessCandidateSolid
  placement: {
    /** Radians, applied about X, then Y, then Z in the source coordinate system. */
    rotation: [number, number, number]
    scale: number
    offset: [number, number, number]
  }
}
