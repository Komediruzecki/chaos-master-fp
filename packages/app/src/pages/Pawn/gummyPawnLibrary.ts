/** Bounded local chess-pawn snapshots and validated Forge handoff, independent of existing IFS drafts. */
import { createGummyAuthoredPawn, gummyAuthoredPawnKey, validateGummyAuthoredPawn, } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export const GUMMY_PAWN_LIBRARY_KEY = 'gummy-pawn-library-v1'
export const GUMMY_PAWN_EDIT_KEY = 'gummy-pawn-edit-v1'
export const GUMMY_PAWN_LIBRARY_LIMIT = 8
const JSON_LIMIT = 32_768
type PawnStorage = Pick<Storage, 'getItem' | 'setItem'>

function snapshot(value: unknown) {
  const pawn = validateGummyAuthoredPawn(value)
  if (!pawn)
    throw new Error(
      'This pawn has invalid shape settings or a name longer than 64 characters.',
    )
  return pawn
}

function parseLibrary(raw: string | null): GummyAuthoredPawn[] {
  if (raw === null) return []
  if (raw.length > JSON_LIMIT)
    throw new Error('The saved pawn library is too large.')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid pawn library.')
  const data = value as Record<string, unknown>
  if (
    data.format !== 'gummy-pawn-library' ||
    data.version !== 1 ||
    !Array.isArray(data.pawns) ||
    data.pawns.length > GUMMY_PAWN_LIBRARY_LIMIT
  )
    throw new Error('Invalid pawn library.')
  const pawns = data.pawns.map(snapshot)
  const names = new Set(pawns.map((pawn) => pawn.name.toLowerCase()))
  const keys = new Set(pawns.map(gummyAuthoredPawnKey))
  if (names.size !== pawns.length || keys.size !== pawns.length)
    throw new Error('Saved pawns have duplicate names or shapes.')
  return pawns
}

export function loadGummyPawnLibrary(storage?: PawnStorage): {
  pawns: GummyAuthoredPawn[]
  error?: string
} {
  try {
    return {
      pawns: parseLibrary(
        (storage ?? localStorage).getItem(GUMMY_PAWN_LIBRARY_KEY),
      ),
    }
  } catch {
    return {
      pawns: [],
      error:
        'Saved pawns could not be read. The existing library has been kept.',
    }
  }
}

function writeLibrary(pawns: GummyAuthoredPawn[], storage: PawnStorage) {
  storage.setItem(
    GUMMY_PAWN_LIBRARY_KEY,
    JSON.stringify({ format: 'gummy-pawn-library', version: 1, pawns }),
  )
  return pawns
}

/** Validate before writing; updating an opened shape is explicit and never overwrites a different saved pawn. */
export function saveGummyPawnSnapshot(
  value: unknown,
  replaceKey?: string,
  storage: PawnStorage = localStorage,
) {
  const pawn = snapshot(value)
  const pawns = parseLibrary(storage.getItem(GUMMY_PAWN_LIBRARY_KEY))
  if (
    replaceKey &&
    !pawns.some((item) => gummyAuthoredPawnKey(item) === replaceKey)
  )
    throw new Error('This saved pawn was removed. Save it as a new pawn.')
  const remaining = replaceKey
    ? pawns.filter((item) => gummyAuthoredPawnKey(item) !== replaceKey)
    : pawns
  const duplicate = remaining.find(
    (item) => gummyAuthoredPawnKey(item) === gummyAuthoredPawnKey(pawn),
  )
  if (duplicate) {
    if (!replaceKey && duplicate.name === pawn.name) return pawns
    throw new Error(
      `This shape is already saved as ${duplicate.name}. Open it to change its name.`,
    )
  }
  if (
    remaining.some(
      (item) => item.name.toLowerCase() === pawn.name.toLowerCase(),
    )
  )
    throw new Error(
      'A pawn with this name already exists. Choose another name.',
    )
  if (remaining.length >= GUMMY_PAWN_LIBRARY_LIMIT)
    throw new Error(
      'Eight pawns are saved. Open one to update or remove it first.',
    )
  return writeLibrary([...remaining, pawn], storage)
}

export function removeGummyPawnSnapshot(
  key: string,
  storage: PawnStorage = localStorage,
) {
  const pawns = parseLibrary(storage.getItem(GUMMY_PAWN_LIBRARY_KEY))
  return writeLibrary(
    pawns.filter((item) => gummyAuthoredPawnKey(item) !== key),
    storage,
  )
}

export function gummyPawnForgeUrl(pawn?: GummyAuthoredPawn) {
  return pawn
    ? `/pawn?${new URLSearchParams({ chessPawn: gummyAuthoredPawnKey(pawn) }).toString()}`
    : '/pawn?chessPawn=trial'
}

/** Retain the exact selected snapshot even if its library entry was renamed or removed. */
export function prepareGummyPawnEdit(
  value: unknown,
  storage: PawnStorage = localStorage,
) {
  const pawn = snapshot(value)
  storage.setItem(GUMMY_PAWN_EDIT_KEY, JSON.stringify(pawn))
  return gummyPawnForgeUrl(pawn)
}

export function readGummyPawnForForge(
  search: string,
  storage?: PawnStorage,
): { pawn?: GummyAuthoredPawn; error?: string } {
  const params = new URLSearchParams(search)
  if (!params.has('chessPawn')) return {}
  const key = params.get('chessPawn')
  try {
    if (params.getAll('chessPawn').length !== 1 || !key || key.length > 256)
      throw new Error('Invalid pawn reference.')
    if (key === 'trial')
      return { pawn: createGummyAuthoredPawn(undefined, 'Crystal lattice') }
    const store = storage ?? localStorage
    const draft = store.getItem(GUMMY_PAWN_EDIT_KEY)
    if (draft && draft.length <= JSON_LIMIT) {
      try {
        const pawn = validateGummyAuthoredPawn(JSON.parse(draft))
        if (pawn && gummyAuthoredPawnKey(pawn) === key) return { pawn }
      } catch {
        /* A broken handoff must not hide a valid library entry. */
      }
    }
    const pawn = parseLibrary(store.getItem(GUMMY_PAWN_LIBRARY_KEY)).find(
      (item) => gummyAuthoredPawnKey(item) === key,
    )
    if (pawn) return { pawn }
  } catch {
    /* Use the unchanged Forge draft and explain the missing selection. */
  }
  return {
    error:
      'That chess pawn could not be opened. Your Forge draft is still available.',
  }
}
