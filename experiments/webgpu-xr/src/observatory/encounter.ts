// Ordered spatial tracing preserves completed notes while rejecting jumps and missed path sections.
import type { AlmanacMotif } from '../almanac/catalog'

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

export const BRIDGE_TARGET: readonly TracePoint[] = [
  [0.12, 0.78],
  [0.37, 0.56],
  [0.63, 0.16],
  [0.88, 0.32],
]

export const BRIDGE_NOTE_NAMES = ['D', 'F', 'B', 'A'] as const

export const BRIDGE_MOTIF: AlmanacMotif = {
  id: 'tideweave-bridge-four',
  tonic: 'D',
  mode: 'Dorian',
  tempo: 82,
  timbre: 'reed',
  notes: [62, 65, 71, 69].map((midi, beat) => ({
    midi,
    beat,
    duration: beat === 3 ? 1.35 : 0.72,
  })),
}

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
): EncounterState {
  return {
    ...state,
    drawing: false,
    last: null,
    response: BRIDGE_TARGET.slice(0, state.accepted),
    hint:
      state.accepted === BRIDGE_TARGET.length
        ? 'complete'
        : (hint ?? (state.accepted ? 'rejoin' : 'start')),
  }
}

export function beginTrace(
  state: EncounterState,
  point: TracePoint,
): EncounterState {
  if (state.accepted === BRIDGE_TARGET.length) return state
  if (!isTracePoint(point)) return endTrace(state, 'outside')
  const anchor = BRIDGE_TARGET[Math.max(0, state.accepted - 1)]
  if (distance(point, anchor) > TARGET_RADIUS) return endTrace(state, 'rejoin')
  const accepted = Math.max(1, state.accepted)
  return {
    accepted,
    drawing: true,
    last: point,
    response: [...BRIDGE_TARGET.slice(0, accepted), point],
    hint: 'continue',
  }
}

export function moveTrace(
  state: EncounterState,
  point: TracePoint,
): EncounterState {
  if (!state.drawing || !state.last || state.accepted === BRIDGE_TARGET.length)
    return state
  if (!isTracePoint(point)) return endTrace(state, 'outside')
  if (distance(state.last, point) > MAX_STEP) return endTrace(state, 'gap')
  const from = BRIDGE_TARGET[state.accepted - 1]
  const target = BRIDGE_TARGET[state.accepted]
  if (distanceToPath(point, from, target) > PATH_RADIUS)
    return endTrace(state, 'rejoin')
  const accepted =
    state.accepted + (distance(point, target) <= TARGET_RADIUS ? 1 : 0)
  const complete = accepted === BRIDGE_TARGET.length
  return {
    accepted,
    drawing: !complete,
    last: complete ? null : point,
    response: [...state.response.slice(-255), point],
    hint: complete ? 'complete' : 'continue',
  }
}

export function traceHint(state: EncounterState): string {
  if (state.hint === 'complete') return 'The crossing is yours.'
  if (state.hint === 'outside')
    return 'Keep your trace inside the four-note ribbon.'
  if (state.hint === 'gap')
    return 'Move a little slower. Your bridge is still here.'
  if (state.hint === 'rejoin')
    return `Start again at ${BRIDGE_NOTE_NAMES[Math.max(0, state.accepted - 1)]}. Your bridge is still here.`
  if (state.hint === 'continue')
    return `Follow the ribbon to ${BRIDGE_NOTE_NAMES[state.accepted]}.`
  return 'Press on D, then trace the rising and falling notes.'
}
