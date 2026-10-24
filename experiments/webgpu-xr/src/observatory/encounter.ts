// Ordered spatial tracing preserves completed notes while rejecting jumps and missed path sections.
import { FIRST_BRIDGE_PHRASE } from './bridgePhrases'
import type { BridgePhrase } from './bridgePhrases'

export type TracePoint = readonly [number, number]
export type TraceHint =
  | 'start'
  | 'continue'
  | 'rejoin'
  | 'gap'
  | 'outside'
  | 'complete'

export interface EncounterState {
  accepted: number
  drawing: boolean
  last: TracePoint | null
  response: TracePoint[]
  hint: TraceHint
}

export const BRIDGE_TARGET = FIRST_BRIDGE_PHRASE.target
export const BRIDGE_NOTE_NAMES = FIRST_BRIDGE_PHRASE.noteNames
export const BRIDGE_MOTIF = FIRST_BRIDGE_PHRASE.motif

const TARGET_RADIUS = 0.065
const PATH_RADIUS = 0.1
const MAX_STEP = 0.18

export function createEncounter(): EncounterState {
  return {
    accepted: 0,
    drawing: false,
    last: null,
    response: [],
    hint: 'start',
  }
}

export function isTracePoint(point: TracePoint): boolean {
  return (
    point.length === 2 &&
    point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )
}

function distance(a: TracePoint, b: TracePoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function distanceToPath(point: TracePoint, from: TracePoint, to: TracePoint) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  )
  return distance(point, [from[0] + t * dx, from[1] + t * dy])
}

export function endTrace(
  state: EncounterState,
  hint?: TraceHint,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
): EncounterState {
  return {
    ...state,
    drawing: false,
    last: null,
    response: phrase.target.slice(0, state.accepted),
    hint:
      state.accepted === phrase.target.length
        ? 'complete'
        : (hint ?? (state.accepted ? 'rejoin' : 'start')),
  }
}

export function beginTrace(
  state: EncounterState,
  point: TracePoint,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
): EncounterState {
  if (state.accepted === phrase.target.length) return state
  if (!isTracePoint(point)) return endTrace(state, 'outside', phrase)
  const anchor = phrase.target[Math.max(0, state.accepted - 1)]
  if (distance(point, anchor) > TARGET_RADIUS)
    return endTrace(state, 'rejoin', phrase)
  const accepted = Math.max(1, state.accepted)
  return {
    accepted,
    drawing: true,
    last: point,
    response: [...phrase.target.slice(0, accepted), point],
    hint: 'continue',
  }
}

export function moveTrace(
  state: EncounterState,
  point: TracePoint,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
): EncounterState {
  if (!state.drawing || !state.last || state.accepted === phrase.target.length)
    return state
  if (!isTracePoint(point)) return endTrace(state, 'outside', phrase)
  if (distance(state.last, point) > MAX_STEP)
    return endTrace(state, 'gap', phrase)
  const from = phrase.target[state.accepted - 1]
  const target = phrase.target[state.accepted]
  if (distanceToPath(point, from, target) > PATH_RADIUS)
    return endTrace(state, 'rejoin', phrase)
  const accepted =
    state.accepted + (distance(point, target) <= TARGET_RADIUS ? 1 : 0)
  const complete = accepted === phrase.target.length
  return {
    accepted,
    drawing: !complete,
    last: complete ? null : point,
    response: [...state.response.slice(-255), point],
    hint: complete ? 'complete' : 'continue',
  }
}

export function traceHint(
  state: EncounterState,
  phrase: BridgePhrase = FIRST_BRIDGE_PHRASE,
): string {
  if (state.hint === 'complete') return 'The crossing is yours.'
  if (state.hint === 'outside')
    return 'Keep your trace inside the four-note ribbon.'
  if (state.hint === 'gap')
    return 'Move a little slower. Your bridge is still here.'
  if (state.hint === 'rejoin')
    return `Start again at ${phrase.noteNames[Math.max(0, state.accepted - 1)]}. Your bridge is still here.`
  if (state.hint === 'continue')
    return `Follow the ribbon to ${phrase.noteNames[state.accepted]}.`
  return `Press on ${phrase.noteNames[0]}, then trace the rising and falling notes.`
}
