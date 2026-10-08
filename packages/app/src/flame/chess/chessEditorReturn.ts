/** Tab-local editor handoff keeps inspection separate from the authored document. */
import { tryValidateTimelineSnapshot } from '../schema/timeline'
import { loadAndImportSharedVariations } from '../variations/custom/CustomVariationRegistry'
import { forEachChessCandidateTransform, validateChessCandidate, } from './chessCandidate'
import type { TimelineSnapshot } from '../schema/timeline'
import type { ChessCandidate } from './chessCandidate'
import type { SharePayload } from '@/utils/jsonQueryParam'

export const CHESS_EDITOR_RETURN_KEY = 'chess-editor-return-v1'
const RETURN_JSON_LIMIT = 2 * 1024 * 1024
type ReturnStorage = Pick<Storage, 'getItem' | 'setItem'>
interface EditorReturn {
  format: 'chess-editor-return'
  version: 1
  document: ChessCandidate
  timeline: TimelineSnapshot
  url: string
}
export type ChessEditorReturnPayload = SharePayload & {
  editorReturnTimeline: TimelineSnapshot
}

export function isChessEditorReturn(search: string): boolean {
  return new URLSearchParams(search).get('resume') === 'chess'
}

function editorUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error('The saved editor address is invalid.')
  }
  const url = new URL(value, 'https://editor.invalid')
  if (
    url.origin !== 'https://editor.invalid' ||
    !['/', '/index.html'].includes(url.pathname)
  ) {
    throw new Error('The saved editor address is invalid.')
  }
  url.searchParams.delete('resume')
  return url
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}

function validateReturn(value: unknown): EditorReturn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The saved editor document is invalid.')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 'chess-editor-return' || record.version !== 1) {
    throw new Error('The saved editor document is invalid.')
  }
  const timeline = tryValidateTimelineSnapshot(record.timeline)
  if (!timeline) throw new Error('The saved editor animation is invalid.')
  return {
    format: 'chess-editor-return',
    version: 1,
    document: validateChessCandidate(record.document),
    timeline,
    url: relativeUrl(editorUrl(record.url)),
  }
}

function parseReturn(raw: string | null): EditorReturn {
  if (raw === null)
    throw new Error(
      'The editor return document is no longer available in this tab. Open the saved flame from Library.',
    )
  if (raw.length > RETURN_JSON_LIMIT)
    throw new Error('The saved editor document is too large.')
  return validateReturn(JSON.parse(raw))
}

/** A failed write blocks departure, before replacing the inspection draft. */
export function saveChessEditorReturn(
  document: ChessCandidate,
  timeline: TimelineSnapshot,
  url: string,
  storage: ReturnStorage = sessionStorage,
): void {
  const record = validateReturn({
    format: 'chess-editor-return',
    version: 1,
    document,
    timeline,
    url,
  })
  const raw = JSON.stringify(record)
  if (raw.length > RETURN_JSON_LIMIT)
    throw new Error(
      'This document and animation are too large to take into chess inspection.',
    )
  try {
    storage.setItem(CHESS_EDITOR_RETURN_KEY, raw)
  } catch {
    throw new Error(
      'This tab could not keep the editor document for your return. Your flame is still open.',
    )
  }
}

/** Direct inspector visits have no editor document to resume. */
export function getChessEditorReturnUrl(storage?: ReturnStorage): string {
  try {
    const raw = (storage ?? sessionStorage).getItem(CHESS_EDITOR_RETURN_KEY)
    if (raw === null) return '/'
    const url = editorUrl(parseReturn(raw).url)
    url.searchParams.set('resume', 'chess')
    return relativeUrl(url)
  } catch {
    // Still request a restore so startup reports the failure, keeping the
    // original bytes available instead of silently showing a default flame.
    return '/?resume=chess'
  }
}

/** Restore authored data, never the fitted or renamed inspection candidate. */
export function loadChessEditorReturn(
  search: string,
  storage: ReturnStorage = sessionStorage,
): ChessEditorReturnPayload | undefined {
  if (!isChessEditorReturn(search)) return undefined
  const record = parseReturn(storage.getItem(CHESS_EDITOR_RETURN_KEY))
  const source = record.document.source
  const imported = loadAndImportSharedVariations(source.customVariations)
  if (imported.rejected.length > 0) {
    throw new Error(
      'The editor document was kept, but its custom variations could not compile. Return to chess inspection to export the candidate.',
    )
  }
  forEachChessCandidateTransform(source.flame, (transform) => {
    for (const variation of Object.values(transform.variations)) {
      variation.type = imported.remap[variation.type] ?? variation.type
    }
  })
  return { flame: source.flame, editorReturnTimeline: record.timeline }
}
