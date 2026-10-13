/** Explicit sampled solids for isolated mesh inspection; these are never match-cache entries. */
import { GUMMY_CHESS_MOULDS, sampleGummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyChessArtStyle, GummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'

export type GummyBoardRestSource = {
  /** Uniform occupied cell centres, packed as xyz and inverse mass. */
  restPositions: Float32Array
  bounds: { min: readonly number[]; max: readonly number[] }
  /** The occupied-cell spacing controls density volume, independently of other moulds. */
  spacing: number
}
export type GummyBoardRestSources = Partial<
  Record<GummyChessMould, GummyBoardRestSource>
>

/** Reject malformed samples before allocating their first GPU resource. */
export function validateGummyBoardRestSource(source: GummyBoardRestSource) {
  const { restPositions, spacing, bounds } = source
  if (
    !Number.isFinite(spacing) ||
    spacing <= 0 ||
    !restPositions.length ||
    restPositions.length % 4 ||
    !restPositions.every(Number.isFinite)
  )
    throw new Error(
      'Solid inspection requires finite packed samples and positive spacing',
    )
  if (
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((value, axis) => value >= bounds.max[axis]!)
  )
    throw new Error(
      'Solid inspection bounds must contain three finite increasing axes',
    )
  for (let index = 0; index < restPositions.length; index += 4)
    for (let axis = 0; axis < 3; axis++)
      if (
        restPositions[index + axis]! < bounds.min[axis]! - 1e-6 ||
        restPositions[index + axis]! > bounds.max[axis]! + 1e-6
      )
        throw new Error(
          'Solid inspection samples must stay within their declared bounds',
        )
}

/** Keep native candidate occupancy separate from the regular sculpted mould refinement. */
export function resolveGummyBoardRestSource(
  mould: GummyChessMould,
  spacing: number,
  artStyle: GummyChessArtStyle,
  authoredPawn?: GummyAuthoredPawn,
  sources?: GummyBoardRestSources,
) {
  const source = sources?.[mould]
  if (source) {
    validateGummyBoardRestSource(source)
    return { ...source, refine: false }
  }
  return {
    restPositions: new Float32Array(
      sampleGummyChessMould(mould, spacing, undefined, artStyle, authoredPawn),
    ),
    bounds: GUMMY_CHESS_MOULDS[mould].bounds,
    spacing,
    refine: artStyle === 'sculpted' && !(mould === 'pawn' && authoredPawn),
  }
}
