/** Public board render inputs, independent of GPU allocation and frame encoding. */
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { MarchingGummyInput } from '../GummyBear/marchingGummySurface'
import type { GummyBoardPiece } from './gummyBoardInstances'
import type { GummyBoardTheme } from './gummyBoardThemes'
/** Reconstruction bounds/cell size can differ from the solver's working grid. */
export type GummyBoardParticleState = MarchingGummyInput
export type GummyBoardSecondaryPiece = {
  id: number
  position: readonly [number, number, number]
  side: 0 | 1
  revision?: number
  scale?: number
  palette?: GummyPalette
  rotationY?: number
}

export type GummyBoardRenderOptions = {
  secondary?: GummyBoardSecondaryPiece
  pieces: readonly GummyBoardPiece[]
  victimPosition: readonly [number, number, number]
  victimId: number
  victimSide?: 0 | 1
  victimScale?: number
  victimPalette?: GummyPalette
  selectedPieceId?: number
  /** Optional world anchor for a live body whose particle coordinates already contain motion. */
  selectionPosition?: readonly [number, number, number]
  /** A cached mould whose transform moves; its floor lighting remains separate from waiting pieces. */
  movingPieceId?: number
  /** Extra absorption for supporting pieces in a directed shot; one preserves normal optics. */
  supportingDensity?: number
  boardTheme?: GummyBoardTheme
  /** Deterministic presentation time; only molten material changes with time. */
  boardTime?: number
  caustics?: boolean
  /** Particle-state version; camera and lighting changes can reuse the existing mesh. */
  revision?: number
}
