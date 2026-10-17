// A held desktop instrument charges one seal; only an explicit release can break it.
import type { AlmanacMotif } from '../almanac/catalog'

export const GLASS_NOTES = [
  { midi: 60, name: 'C4' },
  { midi: 64, name: 'E4' },
  { midi: 67, name: 'G4' },
] as const
export const GLASS_PITCH_RANGE = [60, 72] as const
export const GLASS_HOLD_SECONDS = 0.9
export const GLASS_PITCH_TOLERANCE = 0.4
const MAX_STEP_SECONDS = 0.05
const DECAY_SECONDS = 0.6

export const GLASS_MOTIF: AlmanacMotif = {
  id: 'glasswake-three-seals',
  tonic: 'C',
  mode: 'Ionian',
  tempo: 82,
  timbre: 'glass',
  notes: GLASS_NOTES.map((note, beat) => ({
    midi: note.midi,
    beat,
    duration: beat === GLASS_NOTES.length - 1 ? 1.1 : 0.7,
  })),
}

export type GlasswakeFeedback =
  | 'ready'
  | 'tune'
  | 'charging'
  | 'armed'
  | 'early'
  | 'cancelled'
  | 'complete'

export interface GlasswakeEncounterState {
  accepted: number
  holding: boolean
  pitch: number
  charge: number
  armed: boolean
  feedback: GlasswakeFeedback
}

export function createGlasswakeEncounter(
  initialAccepted = 0,
): GlasswakeEncounterState {
  const accepted =
    Number.isInteger(initialAccepted) &&
    initialAccepted >= 0 &&
    initialAccepted <= GLASS_NOTES.length
      ? initialAccepted
      : 0
  return {
    accepted,
    holding: false,
    pitch: GLASS_NOTES[Math.min(accepted, GLASS_NOTES.length - 1)].midi,
    charge: 0,
    armed: false,
    feedback: accepted === GLASS_NOTES.length ? 'complete' : 'ready',
  }
}

function validPitch(pitch: number) {
  return (
    Number.isFinite(pitch) &&
    pitch >= GLASS_PITCH_RANGE[0] &&
    pitch <= GLASS_PITCH_RANGE[1]
  )
}

function inTune(state: GlasswakeEncounterState) {
  const target = GLASS_NOTES[state.accepted]
  return (
    state.accepted < GLASS_NOTES.length &&
    Math.abs(state.pitch - target.midi) <= GLASS_PITCH_TOLERANCE + 1e-9
  )
}

function validState(state: GlasswakeEncounterState) {
  return (
    Number.isInteger(state.accepted) &&
    state.accepted >= 0 &&
    state.accepted <= GLASS_NOTES.length &&
    validPitch(state.pitch) &&
    Number.isFinite(state.charge) &&
    state.charge >= 0 &&
    state.charge <= 1 &&
    (!state.armed || (state.holding && state.charge === 1))
  )
}

export function cancelGlassHold(
  state: GlasswakeEncounterState,
): GlasswakeEncounterState {
  const accepted = Number.isFinite(state.accepted)
    ? Math.max(0, Math.min(GLASS_NOTES.length, Math.trunc(state.accepted)))
    : 0
  return {
    ...state,
    accepted,
    pitch: validPitch(state.pitch)
      ? state.pitch
      : GLASS_NOTES[Math.min(accepted, GLASS_NOTES.length - 1)].midi,
    holding: false,
    charge: 0,
    armed: false,
    feedback: accepted === GLASS_NOTES.length ? 'complete' : 'cancelled',
  }
}

export function updateGlassPitch(
  state: GlasswakeEncounterState,
  pitch: number,
): GlasswakeEncounterState {
  if (!validState(state) || !validPitch(pitch)) return cancelGlassHold(state)
  const next = { ...state, pitch }
  if (state.accepted === GLASS_NOTES.length || state.armed) return next
  return {
    ...next,
    feedback: state.holding ? (inTune(next) ? 'charging' : 'tune') : 'ready',
  }
}

export function beginGlassHold(
  state: GlasswakeEncounterState,
  pitch: number,
): GlasswakeEncounterState {
  if (!validState(state)) return cancelGlassHold(state)
  if (state.accepted === GLASS_NOTES.length) return state
  if (!validPitch(pitch)) return cancelGlassHold(state)
  // Repeated press events cannot erase an already earned release opportunity.
  if (state.holding) return updateGlassPitch(state, pitch)
  return updateGlassPitch(
    { ...state, holding: true, charge: 0, armed: false },
    pitch,
  )
}

export function advanceGlassHold(
  state: GlasswakeEncounterState,
  elapsedSeconds: number,
): GlasswakeEncounterState {
  if (!validState(state)) return cancelGlassHold(state)
  if (!state.holding || state.armed || state.accepted === GLASS_NOTES.length)
    return state
  // A gap is not evidence of a continuously held note. Ignore stalled/hidden
  // frames rather than converting elapsed wall time into a completed seal.
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0 ||
    elapsedSeconds > MAX_STEP_SECONDS + 1e-9
  )
    return state
  const dt = Math.min(MAX_STEP_SECONDS, elapsedSeconds)
  const tuned = inTune(state)
  const charge = Math.max(
    0,
    Math.min(
      1,
      state.charge + (tuned ? dt / GLASS_HOLD_SECONDS : -dt / DECAY_SECONDS),
    ),
  )
  const armed = charge >= 1 - 1e-9
  return {
    ...state,
    charge: armed ? 1 : charge,
    armed,
    feedback: armed ? 'armed' : tuned ? 'charging' : 'tune',
  }
}

export function releaseGlassHold(
  state: GlasswakeEncounterState,
): GlasswakeEncounterState {
  if (!validState(state)) return cancelGlassHold(state)
  if (!state.holding || state.accepted === GLASS_NOTES.length) return state
  const accepted = state.accepted + Number(state.armed)
  return {
    ...state,
    accepted,
    holding: false,
    charge: 0,
    armed: false,
    feedback:
      accepted === GLASS_NOTES.length
        ? 'complete'
        : state.armed
          ? 'ready'
          : 'early',
  }
}
