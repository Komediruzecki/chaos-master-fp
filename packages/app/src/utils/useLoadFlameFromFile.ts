import { useAlert } from '@/components/Modal/useAlert'
import { MAX_SESSION_JSON_CHARS, parseSession, validateSession, } from '@/recorder/schema'
import { parseFlameEnvelope } from './flameImport'
import { extractMetadataFromMp4 } from './flameInMp4'
import { extractFlameFromPng, extractStepsFromPng } from './flameInPng'
import type { TimelineConfig, TimelineTrack } from './timeline'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { RecordedSession } from '@/recorder/schema'

export type FlameLoadResult = {
  /** Absent when the file was a bare `.steps.json`: there is a session to
   *  replay but no flame to load. */
  flame?: FlameDescriptor
  /** The config is absent when the file carried none. */
  animation?: { tracks: TimelineTrack[]; config?: TimelineConfig }
  /** The audio wiring a flame's JSON carries (a share payload's Copy JSON). */
  audio?: AudioMapping
  /** The session that produced this flame, when the PNG carries one — the
   *  caller can then offer to replay how it was made (M5). */
  session?: RecordedSession
}

/**
 * A JSON file read as a flame: a bare descriptor, a share payload or a Recents
 * record, with whatever animation and wiring it carries. Undefined when the
 * text holds no schema-valid flame, which is what a steps session is.
 */
function readFlameJson(text: string): FlameLoadResult | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const parsed = parseFlameEnvelope(raw)
  if (!parsed) return undefined
  const { flame, tracks, config, audio } = parsed
  return {
    flame,
    ...(tracks || config
      ? { animation: { tracks: tracks ?? [], config } }
      : {}),
    ...(audio ? { audio } : {}),
  }
}

// Flame/animation files carry small embedded metadata; a legitimately large
// exported animation is still well under this, so this only exists to catch
// an accidental multi-GB drop before reading the whole thing into memory.
const MAX_DROPPED_FILE_SIZE = 500 * 1024 * 1024

export function useLoadFlameFromFile() {
  const alert = useAlert()

  async function loadFromFile(
    file: File,
  ): Promise<FlameLoadResult | undefined> {
    const isJson =
      file.type === 'application/json' || file.name.endsWith('.json')
    if (isJson && file.size > MAX_SESSION_JSON_CHARS) {
      await alert(`'${file.name}' is too large to load as a steps session.`)
      return
    }
    if (file.size > MAX_DROPPED_FILE_SIZE) {
      await alert(`'${file.name}' is too large to load.`)
      return
    }
    const arrayBuffer = await file.arrayBuffer().catch(() => undefined)
    if (!arrayBuffer) {
      await alert(`Could not load file '${file.name}'.`)
      return
    }
    const arrBuf = new Uint8Array(arrayBuffer)

    // A JSON file is a flame when it holds one: a descriptor, a share
    // payload's Copy JSON, a Recents record. Otherwise it is a dropped
    // .steps.json, a session on its own with no flame to load, so the caller
    // gets one to replay against whatever is open. Validated the same way as
    // a session from a PNG: unknown format versions and initial flames that
    // fail the schema are refused.
    if (isJson) {
      const text = new TextDecoder().decode(arrBuf)
      const flame = readFlameJson(text)
      if (flame) return flame
      const session = parseSession(text)
      if (session) return { session }
      await alert(`No valid flame or steps found in '${file.name}'.`)
      return
    }

    if (file.type === 'video/mp4' || file.name.endsWith('.mp4')) {
      try {
        const result = await extractMetadataFromMp4(arrayBuffer)
        if (result) return result
      } catch (_) {
        // fall through to error
      }
      await alert(`No flame metadata found in '${file.name}'.`)
      return
    }

    try {
      const result = await extractFlameFromPng(arrBuf)
      // A missing or unreadable steps chunk is not an error: the PNG simply
      // predates step recording, or was not recorded.
      const session = validateSession(await extractStepsFromPng(arrBuf))
      return session ? { ...result, session } : result
    } catch (_) {
      await alert(`No valid flame found in '${file.name}'.`)
    }
  }

  return loadFromFile
}
