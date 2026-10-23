/** Bounded, copyable art-study selections without touching game or editor storage. */
import { CHESS_CANDIDATE_ROLES } from '@/flame/chess/chessCandidate'
import type { CollectionCamera, CollectionQuality, CollectionView, } from '@/components/FractalCollection/collectionStageLayout'
import type { ChessCandidateRole } from '@/flame/chess/chessCandidate'
import type { PawnSide } from '@/flame/chess/pawnFlame'

export type CollectionPreviewSelection = {
  collection: string
  role: ChessCandidateRole
  side: PawnSide
  view: CollectionView
  camera: CollectionCamera
  quality: CollectionQuality
  variation: boolean
}

function choice<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? (value as T) : fallback
}

export function readCollectionPreviewSearch(
  search: string,
  collectionIds: readonly string[],
): CollectionPreviewSelection {
  const params = new URLSearchParams(search)
  return {
    collection: choice(
      params.get('collection'),
      collectionIds,
      collectionIds[0] ?? '',
    ),
    role: choice(params.get('role'), CHESS_CANDIDATE_ROLES, 'pawn'),
    side: choice(params.get('side'), ['light', 'dark'], 'light'),
    view: choice(params.get('view'), ['board', 'lineup', 'solo'], 'board'),
    camera: choice(
      params.get('camera'),
      ['perspective', 'front', 'top'],
      'perspective',
    ),
    quality: choice(params.get('quality'), ['normal', 'high'], 'normal'),
    variation: params.get('variation') === '1',
  }
}

export function collectionPreviewSearch(
  selection: CollectionPreviewSelection,
  existing = '',
): string {
  const params = new URLSearchParams(existing)
  for (const key of [
    'collection',
    'role',
    'side',
    'view',
    'camera',
    'quality',
  ] as const)
    params.set(key, selection[key])
  if (selection.variation) params.set('variation', '1')
  else params.delete('variation')
  return `?${params.toString()}`
}
