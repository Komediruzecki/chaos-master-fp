// A fixed original duet joins the two earned motifs; its cues follow the audio clock.
import type { AlmanacMotif, MotifNote } from '../almanac/catalog'

/** Orchestration is separate from the original motif stored in an earned page. */
export interface ArrangementNote extends MotifNote {
  timbre: AlmanacMotif['timbre']
  gain: number
}

export interface MotifArrangement {
  id: string
  tempo: number
  notes: readonly ArrangementNote[]
}

export const SCORE_RELEASE_SECONDS = 0.18
const TEMPLE_TEMPO = 72
const TEMPLE_LAST_BEAT = 31.8
export const TEMPLE_DURATION_SECONDS =
  (TEMPLE_LAST_BEAT * 60) / TEMPLE_TEMPO + SCORE_RELEASE_SECONDS

export const TEMPLE_SOURCE_MOTIFS = [
  'glasswake-first-light',
  'tideweave-rising-sixth',
] as const

function statement(
  pitches: readonly number[],
  offset: number,
  timbre: AlmanacMotif['timbre'],
): ArrangementNote[] {
  return pitches.map((midi, index) => ({
    midi,
    beat: offset + index,
    duration: index === pitches.length - 1 ? 1.6 : 0.7,
    timbre,
    gain: 0.78,
  }))
}

export const TEMPLE_SCORE: MotifArrangement = {
  id: 'irchiinnuss-two-worlds-v1',
  tempo: TEMPLE_TEMPO,
  notes: [
    // These complete statements preserve the book motifs' pitches and rhythm.
    ...statement([60, 64, 67, 71, 72, 67, 64, 60], 0, 'glass'),
    ...statement([62, 65, 67, 69, 71, 72, 69, 62], 9, 'reed'),
    // Four voiced pairs answer the rising figures, with headroom for overlap.
    { midi: 76, beat: 18, duration: 1.6, timbre: 'glass', gain: 0.55 },
    { midi: 60, beat: 18, duration: 1.6, timbre: 'reed', gain: 0.48 },
    { midi: 79, beat: 20, duration: 1.6, timbre: 'glass', gain: 0.55 },
    { midi: 62, beat: 20, duration: 1.6, timbre: 'reed', gain: 0.48 },
    { midi: 71, beat: 22, duration: 1.6, timbre: 'glass', gain: 0.55 },
    { midi: 67, beat: 22, duration: 1.6, timbre: 'reed', gain: 0.48 },
    { midi: 76, beat: 24, duration: 1.6, timbre: 'glass', gain: 0.55 },
    { midi: 69, beat: 24, duration: 1.6, timbre: 'reed', gain: 0.48 },
    // The threshold settles onto D and A; B has already marked Dorian above.
    { midi: 50, beat: 26, duration: 5.8, timbre: 'reed', gain: 0.42 },
    { midi: 77, beat: 26, duration: 1.5, timbre: 'glass', gain: 0.48 },
    { midi: 74, beat: 28, duration: 3.8, timbre: 'reed', gain: 0.35 },
    { midi: 69, beat: 28, duration: 3.8, timbre: 'glass', gain: 0.34 },
    { midi: 74, beat: 30, duration: 1.8, timbre: 'glass', gain: 0.52 },
  ],
}

export type TempleSectionId =
  | 'glasswake'
  | 'tideweave'
  | 'together'
  | 'threshold'
  | 'complete'

export const TEMPLE_SECTIONS = [
  { id: 'glasswake', label: 'Glasswake remembers', startBeat: 0, endBeat: 9 },
  { id: 'tideweave', label: 'Tideweave answers', startBeat: 9, endBeat: 18 },
  {
    id: 'together',
    label: 'Two worlds, one phrase',
    startBeat: 18,
    endBeat: 26,
  },
  {
    id: 'threshold',
    label: 'The temple appears',
    startBeat: 26,
    // Include the final release so the last chord completes before the ending.
    endBeat: (TEMPLE_DURATION_SECONDS * TEMPLE_TEMPO) / 60,
  },
] as const

export interface TempleCue {
  section: TempleSectionId
  label: string
  sectionProgress: number
  revealProgress: number
  elapsedSeconds: number
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (value: number) => value * value * (3 - 2 * value)

/** Progress belongs to the transport; rendering speed cannot advance the score. */
export function templeCue(progress: number): TempleCue {
  const bounded = Number.isFinite(progress) ? clamp(progress) : 0
  const elapsedSeconds = bounded * TEMPLE_DURATION_SECONDS
  if (bounded === 1)
    return {
      section: 'complete',
      label: 'The temple is waiting',
      sectionProgress: 1,
      revealProgress: 1,
      elapsedSeconds,
    }
  const beat = (elapsedSeconds * TEMPLE_TEMPO) / 60
  const section =
    TEMPLE_SECTIONS.find((candidate) => beat < candidate.endBeat) ??
    TEMPLE_SECTIONS[TEMPLE_SECTIONS.length - 1]
  return {
    section: section.id,
    label: section.label,
    sectionProgress: clamp(
      (beat - section.startBeat) / (section.endBeat - section.startBeat),
    ),
    revealProgress: ease(clamp((beat - 18) / (TEMPLE_LAST_BEAT - 18))),
    elapsedSeconds,
  }
}
