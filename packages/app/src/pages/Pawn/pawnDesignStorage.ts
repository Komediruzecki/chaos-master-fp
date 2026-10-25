/** Read saved pawn forms for the forge and board without modifying either draft. */
import { safeGetItem } from '@/utils/storage'
import { restorePawnDesignDraft } from './pawnDesign'
import type { PawnDesign } from './pawnDesign'

function readJson(key: string): unknown {
  const stored = safeGetItem(key)
  try {
    return stored === null ? undefined : (JSON.parse(stored) as unknown)
  } catch {
    return undefined
  }
}

export function readLegacyPawnDraft(): unknown {
  return readJson('chaos-master-pawn-forge-draft')
}

export function readSavedPawnDesign(): PawnDesign {
  return restorePawnDesignDraft(
    readJson('chaos-master-pawn-forge-experiments'),
    readLegacyPawnDraft(),
  )
}
