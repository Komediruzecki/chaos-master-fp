// A held desktop instrument charges one seal; only an explicit release can break it.
import { FIRST_GLASS_PHRASE } from './glasswakePhrases'
import type { GlassPhrase } from './glasswakePhrases'

export const GLASS_NOTES = FIRST_GLASS_PHRASE.notes
export const GLASS_PITCH_RANGE = [60, 72] as const
export const GLASS_HOLD_SECONDS = 0.9
export const GLASS_PITCH_TOLERANCE = 0.4
const MAX_STEP_SECONDS = 0.05
const DECAY_SECONDS = 0.6

export const GLASS_MOTIF = FIRST_GLASS_PHRASE.motif

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
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  const accepted =
    Number.isInteger(initialAccepted) &&
    initialAccepted >= 0 &&
    initialAccepted <= phrase.notes.length
      ? initialAccepted
      : 0
  return {
    accepted,
    holding: false,
    pitch: phrase.notes[Math.min(accepted, phrase.notes.length - 1)].midi,
    charge: 0,
    armed: false,
    feedback: accepted === phrase.notes.length ? 'complete' : 'ready',
  }
}

function validPitch(pitch: number) {
  return (
    Number.isFinite(pitch) &&
    pitch >= GLASS_PITCH_RANGE[0] &&
    pitch <= GLASS_PITCH_RANGE[1]
  )
}

function inTune(state: GlasswakeEncounterState, phrase: GlassPhrase) {
  const target = phrase.notes[state.accepted]
  return (
    state.accepted < phrase.notes.length &&
    Math.abs(state.pitch - target.midi) <= GLASS_PITCH_TOLERANCE + 1e-9
  )
}

function validState(state: GlasswakeEncounterState, phrase: GlassPhrase) {
  return (
    Number.isInteger(state.accepted) &&
    state.accepted >= 0 &&
    state.accepted <= phrase.notes.length &&
    validPitch(state.pitch) &&
    Number.isFinite(state.charge) &&
    state.charge >= 0 &&
    state.charge <= 1 &&
    (!state.armed || (state.holding && state.charge === 1))
  )
}

export function cancelGlassHold(
  state: GlasswakeEncounterState,
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  const accepted = Number.isFinite(state.accepted)
    ? Math.max(0, Math.min(phrase.notes.length, Math.trunc(state.accepted)))
    : 0
  return {
    ...state,
    accepted,
    pitch: validPitch(state.pitch)
      ? state.pitch
      : phrase.notes[Math.min(accepted, phrase.notes.length - 1)].midi,
    holding: false,
    charge: 0,
    armed: false,
    feedback: accepted === phrase.notes.length ? 'complete' : 'cancelled',
  }
}

export function updateGlassPitch(
  state: GlasswakeEncounterState,
  pitch: number,
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  if (!validState(state, phrase) || !validPitch(pitch))
    return cancelGlassHold(state, phrase)
  const next = { ...state, pitch }
  if (state.accepted === phrase.notes.length || state.armed) return next
  return {
    ...next,
    feedback: state.holding
      ? inTune(next, phrase)
        ? 'charging'
        : 'tune'
      : 'ready',
  }
}

export function beginGlassHold(
  state: GlasswakeEncounterState,
  pitch: number,
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  if (!validState(state, phrase)) return cancelGlassHold(state, phrase)
  if (state.accepted === phrase.notes.length) return state
  if (!validPitch(pitch)) return cancelGlassHold(state, phrase)
  // Repeated press events cannot erase an already earned release opportunity.
  if (state.holding) return updateGlassPitch(state, pitch, phrase)
  return updateGlassPitch(
    { ...state, holding: true, charge: 0, armed: false },
    pitch,
    phrase,
  )
}

export function advanceGlassHold(
  state: GlasswakeEncounterState,
  elapsedSeconds: number,
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  if (!validState(state, phrase)) return cancelGlassHold(state, phrase)
  if (!state.holding || state.armed || state.accepted === phrase.notes.length)
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
  const tuned = inTune(state, phrase)
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
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
): GlasswakeEncounterState {
  if (!validState(state, phrase)) return cancelGlassHold(state, phrase)
  if (!state.holding || state.accepted === phrase.notes.length) return state
  const accepted = state.accepted + Number(state.armed)
  return {
    ...state,
    accepted,
    holding: false,
    charge: 0,
    armed: false,
    feedback:
      accepted === phrase.notes.length
        ? 'complete'
        : state.armed
          ? 'ready'
          : 'early',
  }
}
