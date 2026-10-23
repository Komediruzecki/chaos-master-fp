/** Select isolated or match-owned resting meshes without growing the board renderer. */
import { GUMMY_BOARD_MOULDS } from './gummyBoardInstances'
import { createGummyBoardRestMeshes } from './gummyBoardRestMeshes'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { GummyBoardRestSources } from './gummyBoardRestSources'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyChessArtStyle, GummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'

export type GummyBoardMeshQuality = {
  lightResolution?: 512 | 1024
  artStyle?: GummyChessArtStyle
  authoredPawn?: GummyAuthoredPawn
  signal?: AbortSignal
  /** A scene owner shares immutable moulds across static play and cinematic captures. */
  restMeshPool?: GummyBoardRestMeshPool
  restSpacing?: number
  /** Isolated inspection bakes only these moulds, outside the match-owned pool. */
  moulds?: readonly GummyChessMould[]
  /** Explicit candidate geometry is inspection-only and never enters a match cache. */
  restSources?: GummyBoardRestSources
}

export async function prepareGummyBoardMeshes(
  root: TgpuRoot,
  device: GPUDevice,
  quality: GummyBoardMeshQuality,
  particleSpacing?: number,
) {
  const moulds = [...new Set(quality.moulds ?? GUMMY_BOARD_MOULDS)]
  if (!moulds.length)
    throw new Error('The board renderer needs at least one mould')
  const spacing = quality.restSpacing ?? particleSpacing ?? 0.08
  const meshes =
    quality.moulds || quality.restSources
      ? await createGummyBoardRestMeshes(
          root,
          device,
          spacing,
          quality.artStyle,
          quality.signal,
          quality.authoredPawn,
          moulds,
          quality.restSources,
        )
      : await (quality.restMeshPool?.acquire ?? createGummyBoardRestMeshes)(
          root,
          device,
          spacing,
          quality.artStyle,
          quality.signal,
          quality.authoredPawn,
        )
  return { moulds, meshes }
}
