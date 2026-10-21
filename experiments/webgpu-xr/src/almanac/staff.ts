// Diatonic treble-staff placement: E4 is step zero and each step is half a line gap.
const NATURAL_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const
const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
] as const

/** MIDI pitches use sharp spellings; C4 and C-sharp4 share a ledger line. */
export function staffStep(midi: number): number {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127)
    throw new RangeError('Expected a MIDI pitch from 0 to 127.')
  return (Math.floor(midi / 12) - 5) * 7 + NATURAL_STEP[midi % 12] - 2
}

export function staffLedgerSteps(midi: number): number[] {
  const step = staffStep(midi)
  const lines: number[] = []
  for (let line = -2; line >= step; line -= 2) lines.push(line)
  for (let line = 10; line <= step; line += 2) lines.push(line)
  return lines
}

export function staffNote(midi: number) {
  const step = staffStep(midi)
  return {
    step,
    y: 68 - step * 5,
    stemDown: step >= 4,
    accidental: NOTE_NAMES[midi % 12].includes('♯') ? '♯' : '',
    label: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`,
    ledgerSteps: staffLedgerSteps(midi),
  }
}
