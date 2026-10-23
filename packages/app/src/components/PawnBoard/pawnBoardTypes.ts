/** Instance and frame contracts shared by board rendering and uploaded variants. */
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { Square } from '@/flame/chess/pawnGame'

export type BoardPawnInstance = {
  position: readonly [number, number, number]
  side: PawnSide
  selected: boolean
  age: number
  /** An uploaded study cloud; omitted keeps the original side-based pawn. */
  cloudKey?: string
  /** An explicitly uploaded hollow envelope, independent of the native cloud. */
  glassKey?: string
  /** Seconds since envelope fracture; omitted or negative keeps the shell intact. */
  glassAge?: number
  /** Uniform local-space scale, leaving the board position unchanged. */
  scale?: number
  /** Optional linear RGB tint for restrained variation between repeated shapes. */
  colorMultiplier?: readonly [number, number, number]
}
export type BoardFrame = {
  width: number
  height: number
  viewProjection: Float32Array
  eye: Float32Array
  pieces: readonly BoardPawnInstance[]
  shards?: BoardPawnInstance
  selected?: Square
  legal: readonly Square[]
  showGlass?: boolean
  inspection?: boolean
  /** Matte low-contrast checkers for native fractal collection studies. */
  mutedBoard?: boolean
}
