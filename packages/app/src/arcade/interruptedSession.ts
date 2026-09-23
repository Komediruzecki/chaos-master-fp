// An Arcade session a page reload cut short, remembered so the agent is told instead of editing the viewer's flame.
import { createSignal } from 'solid-js'

/**
 * The pilot's state is module signals, so a reload drops a running session
 * without a trace: `arcade_status` said `idle`, the take was never saved, and
 * the agent's next `get_flame` or `execute_command` read and wrote the
 * viewer's own flame while the agent still believed it was playing its seat.
 *
 * So a running session leaves a marker in `sessionStorage` (per tab, and it
 * survives a reload), and a clean ending removes it. A marker found when the
 * page loads is a session the reload ended. Until the agent acknowledges it
 * with `arcade_status`, or starts a new session, every other tool refuses with
 * `interruptionMessage` rather than act on the viewer's flame.
 */
export type InterruptedSession = {
  /** The pilot mode: `teach`, `cinema`, `duel` or `beats`. */
  mode: string
  /** The session's title as the pilot knew it, e.g. "Duelling you". */
  title: string
}

const ARCADE_SESSION_KEY = 'chaos-master:arcade-session'

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    // Blocked storage (sandboxed frames, some privacy modes) throws on access.
    return undefined
  }
}

function readMarker(): InterruptedSession | undefined {
  try {
    const raw = storage()?.getItem(ARCADE_SESSION_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<InterruptedSession>
    if (typeof parsed.mode !== 'string' || typeof parsed.title !== 'string') {
      return undefined
    }
    return { mode: parsed.mode, title: parsed.title }
  } catch {
    return undefined
  }
}

function removeMarker(): void {
  try {
    storage()?.removeItem(ARCADE_SESSION_KEY)
  } catch {
    // Nothing to clean up where storage is unavailable.
  }
}

const [interrupted, setInterrupted] = createSignal<
  InterruptedSession | undefined
>()

/** The session the last reload ended, until it is acknowledged. */
export const interruptedSession = interrupted

// Read once, when this module loads: in a fresh page that is before any
// session can have started, so a marker found here can only be one the reload
// ended. The tests reload with `vi.resetModules()`.
setInterrupted(readMarker())

/** A session started: remember it, and let it supersede any interrupted one. */
export function markSessionRunning(session: InterruptedSession): void {
  setInterrupted(undefined)
  try {
    storage()?.setItem(ARCADE_SESSION_KEY, JSON.stringify(session))
  } catch {
    // Without storage a reload cannot be detected; the session still runs.
  }
}

/** A session ended through the app: nothing was interrupted. */
export function markSessionClosed(): void {
  removeMarker()
}

/** The agent has been told: release the tools and forget the marker. */
export function acknowledgeInterruption(): InterruptedSession | undefined {
  const session = interrupted()
  setInterrupted(undefined)
  removeMarker()
  return session
}

const START_TOOL: Record<string, string> = {
  teach: 'arcade_start_lesson',
  cinema: 'arcade_start_cinema',
  duel: 'arcade_start_duel',
  beats: 'arcade_start_beats',
}

const MODE_NAME: Record<string, string> = {
  teach: 'lesson',
  cinema: 'cinema session',
  duel: 'duel',
  beats: 'beats session',
}

/** What the agent is told, in place of a tool's answer, until it acknowledges. */
export function interruptionMessage(session: InterruptedSession): string {
  const kind = MODE_NAME[session.mode] ?? 'session'
  const start = START_TOOL[session.mode]
  const again = start ? ` To play again, call ${start}.` : ''
  return (
    [
      `The Arcade ${kind} "${session.title}" was ended by a page reload, and no Arcade session is active.`,
      'Its recording was not saved.',
      "Other tools would now act on the viewer's own flame, so they are held until you call arcade_status, which acknowledges this.",
    ].join(' ') + again
  )
}

/** The viewer's half of the same news, for the launch toast. */
export function interruptionNotice(session: InterruptedSession): string {
  const kind = MODE_NAME[session.mode] ?? 'session'
  return `The reload ended the agent's ${kind}. Its recording was not saved.`
}
