/**
 * A leaf seam between document owners and the recorder.
 *
 * The timeline needs to tell the recorder that an entry landed on its undo
 * stack — but importing `recorder/recorder.ts` from `utils/timeline.ts` closes
 * a cycle: the flame schema reaches the timeline through the variation
 * parameter editors, and the recorder reaches the flame schema through the
 * session format. The result was a half-initialised valibot schema and every
 * flame failing to parse.
 *
 * So this module holds nothing but a function reference. It imports nothing,
 * which is the whole point — anyone may depend on it. `recorder/recorder.ts`
 * installs the real reporter when it loads; until then the calls are no-ops,
 * which is correct, because with no recorder loaded there is no recording.
 */

import type { SeatId } from '@/seats/seatId'

type DocumentWriteReporter = (description?: string, seatId?: SeatId) => void
type TimelineTransportReporter = (description: string, seatId?: SeatId) => void
type TimelinePlaybackReporter = (
  playing: boolean,
  frame: number,
  seatId?: SeatId,
) => void

let reporter: DocumentWriteReporter | undefined
let transportReporter: TimelineTransportReporter | undefined
let playbackReporter: TimelinePlaybackReporter | undefined

export function setDocumentWriteReporter(fn: DocumentWriteReporter): void {
  reporter = fn
}

/** `seatId` is supplied by the store that owns the write — each timeline
 *  instance captures its own at construction. Omitted means the player. */
export function notifyDocumentWrite(
  description?: string,
  seatId?: SeatId,
): void {
  reporter?.(description, seatId)
}

/** Timeline transport does not push an undo entry, but it still changes the
 * visible workspace and therefore the fidelity/ownership of a recording. */
export function setTimelineTransportReporter(
  fn: TimelineTransportReporter,
): void {
  transportReporter = fn
}

export function notifyTimelineTransport(
  description: string,
  seatId?: SeatId,
): void {
  transportReporter?.(description, seatId)
}

/**
 * Playback started or stopped, and the frame it did so on.
 *
 * Separate from {@link notifyTimelineTransport} because the two mean opposite
 * things to a recording. A seek outside a command is transport the log cannot
 * name; a start or stop is a step it can: `frame` pins where the playhead was,
 * so a replay pauses exactly where the take paused. Reported only when the
 * playing state actually changes — a Pause with nothing playing is not one.
 */
export function setTimelinePlaybackReporter(
  fn: TimelinePlaybackReporter,
): void {
  playbackReporter = fn
}

export function notifyTimelinePlayback(
  playing: boolean,
  frame: number,
  seatId?: SeatId,
): void {
  playbackReporter?.(playing, frame, seatId)
}
