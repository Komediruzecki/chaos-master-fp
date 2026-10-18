// Versioned, bounded journey keeps earned world identities independent of live encounter state.
import type { AlmanacMotif, AlmanacWorld, SpecimenDescriptor, } from '../almanac/catalog'

export const JOURNEY_STORAGE_KEY = 'lumen-observatory-journey'
export const JOURNEY_WORLD_IDS = ['glasswake', 'tideweave'] as const
export type JourneyWorldId = (typeof JOURNEY_WORLD_IDS)[number]
const MAX_SAVE_LENGTH = 16384

export interface JourneyPage {
  worldId: JourneyWorldId
  name: string
  tonic: string
  mode: string
  specimen: SpecimenDescriptor
  motif: AlmanacMotif & { version: 1 }
  activity: { id: 'glasswake-seals' | 'tideweave-trace'; version: 1 }
}

export interface JourneyWorldProgress {
  discovered: boolean
  completion: JourneyPage | null
}

export interface JourneyProgress {
  version: 1
  onboardingCompleted: boolean
  lastSelectedWorld: JourneyWorldId
  worlds: Record<JourneyWorldId, JourneyWorldProgress>
}

export interface JourneyPersistence {
  status: 'ready' | 'saved' | 'memory' | 'protected'
  reason:
    | null
    | 'unavailable'
    | 'read-failed'
    | 'write-failed'
    | 'invalid-data'
    | 'unsupported-version'
}

export interface JourneySnapshot {
  progress: JourneyProgress
  persistence: JourneyPersistence
}

export interface JourneyStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface JourneyStore {
  read: () => JourneySnapshot
  subscribe: (listener: (snapshot: JourneySnapshot) => void) => () => void
  completeOnboarding: () => JourneySnapshot
  selectWorld: (id: JourneyWorldId) => JourneySnapshot
  discoverWorld: (id: JourneyWorldId) => JourneySnapshot
  completeWorld: (id: JourneyWorldId) => JourneySnapshot
  refresh: () => JourneySnapshot
  /** Explicitly replaces this journey save. Never called during ordinary recovery. */
  reset: () => JourneySnapshot
}

type RecordValue = Record<string, unknown>
type SaveResult =
  | { kind: 'empty' }
  | { kind: 'valid'; progress: JourneyProgress }
  | { kind: 'invalid-data' | 'unsupported-version' }

export function isJourneyWorldId(value: unknown): value is JourneyWorldId {
  return value === 'glasswake' || value === 'tideweave'
}

export function createJourneyProgress(): JourneyProgress {
  return {
    version: 1,
    onboardingCompleted: false,
    lastSelectedWorld: 'glasswake',
    worlds: {
      glasswake: { discovered: false, completion: null },
      tideweave: { discovered: false, completion: null },
    },
  }
}

export function getEarnedPages(progress: JourneyProgress): JourneyPage[] {
  return JOURNEY_WORLD_IDS.flatMap((id) => {
    const page = progress.worlds[id].completion
    return page ? [structuredClone(page)] : []
  })
}

export function isJourneyComplete(progress: JourneyProgress): boolean {
  return JOURNEY_WORLD_IDS.every(
    (id) => progress.worlds[id].completion !== null,
  )
}

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fields(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  )
}

function text(value: unknown, max = 64): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max)
    return false
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return false
  }
  return true
}

function bounded(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  )
}

function musicalIdentity(value: RecordValue): boolean {
  return (
    typeof value.tonic === 'string' &&
    /^[A-G](?:#|b)?$/u.test(value.tonic) &&
    typeof value.mode === 'string' &&
    [
      'Ionian',
      'Dorian',
      'Phrygian',
      'Lydian',
      'Mixolydian',
      'Aeolian',
      'Locrian',
    ].includes(value.mode)
  )
}

function validSpecimen(
  value: unknown,
  worldId: JourneyWorldId,
): value is SpecimenDescriptor {
  return (
    record(value) &&
    fields(
      value,
      ['kind', 'version', 'recipeId', 'seed', 'palette', 'rings'],
      ['visual'],
    ) &&
    value.kind === 'bench-recipe' &&
    value.version === 1 &&
    typeof value.recipeId === 'string' &&
    ['rosette', 'branching', 'shell'].includes(value.recipeId) &&
    bounded(value.seed, 1, 0x7fffffff) &&
    Number.isInteger(value.seed) &&
    typeof value.palette === 'string' &&
    ['lagoon', 'ember', 'violet', 'ivory'].includes(value.palette) &&
    typeof value.rings === 'boolean' &&
    (value.visual === undefined || value.visual === worldId)
  )
}

function validMotif(value: unknown): value is JourneyPage['motif'] {
  if (
    !record(value) ||
    !fields(value, [
      'id',
      'version',
      'tonic',
      'mode',
      'tempo',
      'timbre',
      'notes',
    ]) ||
    !text(value.id, 96) ||
    value.version !== 1 ||
    !musicalIdentity(value) ||
    !bounded(value.tempo, 30, 240) ||
    (value.timbre !== 'glass' && value.timbre !== 'reed') ||
    !Array.isArray(value.notes) ||
    value.notes.length < 1 ||
    value.notes.length > 64
  )
    return false
  let previousBeat = -1
  for (const note of value.notes) {
    if (
      !record(note) ||
      !fields(note, ['midi', 'beat', 'duration']) ||
      !bounded(note.midi, 24, 96) ||
      !Number.isInteger(note.midi) ||
      !bounded(note.beat, 0, 64) ||
      note.beat < previousBeat ||
      !bounded(note.duration, 0, 8) ||
      note.duration === 0
    )
      return false
    previousBeat = note.beat
  }
  return true
}

function validPage(value: unknown, id: JourneyWorldId): value is JourneyPage {
  return (
    record(value) &&
    fields(value, [
      'worldId',
      'name',
      'tonic',
      'mode',
      'specimen',
      'motif',
      'activity',
    ]) &&
    value.worldId === id &&
    text(value.name) &&
    musicalIdentity(value) &&
    validSpecimen(value.specimen, id) &&
    validMotif(value.motif) &&
    value.tonic === value.motif.tonic &&
    value.mode === value.motif.mode &&
    record(value.activity) &&
    fields(value.activity, ['id', 'version']) &&
    value.activity.version === 1 &&
    value.activity.id ===
      (id === 'glasswake' ? 'glasswake-seals' : 'tideweave-trace')
  )
}

function validProgress(value: unknown): value is JourneyProgress {
  if (
    !record(value) ||
    !fields(value, [
      'version',
      'onboardingCompleted',
      'lastSelectedWorld',
      'worlds',
    ]) ||
    value.version !== 1 ||
    typeof value.onboardingCompleted !== 'boolean' ||
    !isJourneyWorldId(value.lastSelectedWorld) ||
    !record(value.worlds) ||
    !fields(value.worlds, JOURNEY_WORLD_IDS)
  )
    return false
  return JOURNEY_WORLD_IDS.every((id) => {
    const world = (value.worlds as RecordValue)[id]
    return (
      record(world) &&
      fields(world, ['discovered', 'completion']) &&
      typeof world.discovered === 'boolean' &&
      (world.completion === null ||
        (world.discovered && validPage(world.completion, id)))
    )
  })
}

export function parseJourneyProgress(raw: string | null): SaveResult {
  if (raw === null) return { kind: 'empty' }
  if (raw.length > MAX_SAVE_LENGTH) return { kind: 'invalid-data' }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'invalid-data' }
  }
  if (record(value) && typeof value.version === 'number' && value.version !== 1)
    return { kind: 'unsupported-version' }
  return validProgress(value)
    ? { kind: 'valid', progress: value }
    : { kind: 'invalid-data' }
}

function pageForWorld(
  worlds: readonly AlmanacWorld[],
  id: JourneyWorldId,
): JourneyPage {
  const world = worlds.find((candidate) => candidate.id === id)
  if (!world?.specimen || !world.motif)
    throw new Error(`Missing journey identity: ${id}`)
  const page: JourneyPage = {
    worldId: id,
    name: world.name,
    tonic: world.tonic,
    mode: world.mode,
    specimen: structuredClone(world.specimen),
    motif: { ...structuredClone(world.motif), version: 1 },
    activity: {
      id: id === 'glasswake' ? 'glasswake-seals' : 'tideweave-trace',
      version: 1,
    },
  }
  if (!validPage(page, id)) throw new Error(`Invalid journey identity: ${id}`)
  return page
}

/** Awards merge monotonically; the source already saved in the browser owns existing page identities. */
function mergeProgress(
  local: JourneyProgress,
  saved: JourneyProgress,
): JourneyProgress {
  const merged = structuredClone(local)
  merged.onboardingCompleted ||= saved.onboardingCompleted
  for (const id of JOURNEY_WORLD_IDS) {
    merged.worlds[id].discovered ||= saved.worlds[id].discovered
    merged.worlds[id].completion = structuredClone(
      saved.worlds[id].completion ?? local.worlds[id].completion,
    )
  }
  return merged
}

export function createJourneyStore(options: {
  worlds: readonly AlmanacWorld[]
  storage?: () => JourneyStorage | null | undefined
}): JourneyStore {
  let progress = createJourneyProgress()
  let persistence: JourneyPersistence = { status: 'ready', reason: null }
  const listeners = new Set<(snapshot: JourneySnapshot) => void>()
  const read = (): JourneySnapshot => ({
    progress: structuredClone(progress),
    persistence: { ...persistence },
  })
  const notify = () => {
    for (const listener of listeners) listener(read())
    return read()
  }

  function accessStorage(): JourneyStorage | undefined {
    try {
      const storage = options.storage?.()
      if (storage) return storage
      persistence = { status: 'memory', reason: 'unavailable' }
    } catch {
      persistence = { status: 'memory', reason: 'unavailable' }
    }
    return undefined
  }

  function load(storage: JourneyStorage): SaveResult | undefined {
    try {
      const result = parseJourneyProgress(storage.getItem(JOURNEY_STORAGE_KEY))
      if (
        result.kind === 'invalid-data' ||
        result.kind === 'unsupported-version'
      )
        persistence = { status: 'protected', reason: result.kind }
      return result
    } catch {
      persistence = { status: 'memory', reason: 'read-failed' }
      return undefined
    }
  }

  function write(storage: JourneyStorage) {
    try {
      storage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify(progress))
      persistence = { status: 'saved', reason: null }
    } catch {
      persistence = { status: 'memory', reason: 'write-failed' }
    }
  }

  function persist(): JourneySnapshot {
    const storage = accessStorage()
    if (storage) {
      const saved = load(storage)
      if (saved?.kind === 'valid')
        progress = mergeProgress(progress, saved.progress)
      if (saved?.kind === 'valid' || saved?.kind === 'empty') write(storage)
    }
    return notify()
  }

  function selectWorld(id: JourneyWorldId): void {
    if (!isJourneyWorldId(id)) throw new Error('Unknown journey world')
    progress.lastSelectedWorld = id
  }
  const initialStorage = accessStorage()
  if (initialStorage) {
    const initial = load(initialStorage)
    if (initial?.kind === 'valid') {
      progress = initial.progress
      persistence = { status: 'saved', reason: null }
    }
  }
  return {
    read,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    completeOnboarding() {
      progress.onboardingCompleted = true
      return persist()
    },
    selectWorld(id) {
      selectWorld(id)
      return persist()
    },
    discoverWorld(id) {
      selectWorld(id)
      progress.worlds[id].discovered = true
      return persist()
    },
    completeWorld(id) {
      if (!isJourneyWorldId(id)) throw new Error('Unknown journey world')
      progress.worlds[id].completion ??= pageForWorld(options.worlds, id)
      progress.worlds[id].discovered = true
      return persist()
    },
    refresh() {
      const storage = accessStorage()
      if (storage) {
        const saved = load(storage)
        if (saved?.kind === 'valid') {
          // A storage event imports awards without changing this tab's current selection.
          const merged = mergeProgress(progress, saved.progress)
          const hasUnsavedProgress =
            merged.onboardingCompleted !== saved.progress.onboardingCompleted ||
            JSON.stringify(merged.worlds) !==
              JSON.stringify(saved.progress.worlds)
          progress = merged
          // Never write from a storage listener: tabs may have different selections.
          // Their next explicit action merges awards again before committing.
          persistence = {
            status: hasUnsavedProgress ? 'ready' : 'saved',
            reason: null,
          }
        } else if (saved?.kind === 'empty') {
          persistence = { status: 'ready', reason: null }
        }
      }
      return notify()
    },
    reset() {
      progress = createJourneyProgress()
      const storage = accessStorage()
      if (storage) write(storage)
      return notify()
    },
  }
}
