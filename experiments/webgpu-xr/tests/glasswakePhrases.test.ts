// Published Glasswake identity stays canonical while practice calls keep teaching and target notes aligned.
import assert from 'node:assert/strict'
import test from 'node:test'
import { GLASS_MOTIF, GLASS_NOTES, GLASS_PITCH_RANGE, } from '../src/observatory/glasswakeEncounter'
import { FIRST_GLASS_PHRASE, GLASS_PHRASES, } from '../src/observatory/glasswakePhrases'

await test('First light preserves the original three-seal identity and teaching score', () => {
  assert.equal(FIRST_GLASS_PHRASE.id, 'first-light')
  assert.equal(GLASS_NOTES, FIRST_GLASS_PHRASE.notes)
  assert.equal(GLASS_MOTIF, FIRST_GLASS_PHRASE.motif)
  assert.deepEqual(GLASS_NOTES, [
    { midi: 60, name: 'C4' },
    { midi: 64, name: 'E4' },
    { midi: 67, name: 'G4' },
  ])
  assert.deepEqual(GLASS_MOTIF, {
    id: 'glasswake-three-seals',
    tonic: 'C',
    mode: 'Ionian',
    tempo: 82,
    timbre: 'glass',
    notes: [
      { midi: 60, beat: 0, duration: 0.7 },
      { midi: 64, beat: 1, duration: 0.7 },
      { midi: 67, beat: 2, duration: 1.1 },
    ],
  })
})

await test('practice calls have distinct contours and aligned teaching notes within the instrument register', () => {
  assert.equal(new Set(GLASS_PHRASES.map((phrase) => phrase.id)).size, 3)
  assert.equal(new Set(GLASS_PHRASES.map((phrase) => phrase.motif.id)).size, 3)
  assert.deepEqual(
    GLASS_PHRASES.map((phrase) => phrase.notes.map((note) => note.midi)),
    [
      [60, 64, 67],
      [60, 67, 72],
      [67, 64, 60],
    ],
  )
  assert.deepEqual(
    GLASS_PHRASES.map((phrase) => phrase.motif.tempo),
    [82, 78, 76],
  )
  const names = new Map([
    [60, 'C4'],
    [64, 'E4'],
    [67, 'G4'],
    [72, 'C5'],
  ])
  for (const phrase of GLASS_PHRASES) {
    assert.equal(phrase.notes.length, 3)
    assert.equal(phrase.motif.notes.length, 3)
    assert.equal(phrase.motif.tonic, 'C')
    assert.equal(phrase.motif.mode, 'Ionian')
    assert.equal(phrase.motif.timbre, 'glass')
    phrase.notes.forEach((note, index) => {
      assert.equal(note.name, names.get(note.midi))
      assert.ok(
        note.midi >= GLASS_PITCH_RANGE[0] && note.midi <= GLASS_PITCH_RANGE[1],
      )
      assert.equal(phrase.motif.notes[index].midi, note.midi)
      assert.equal(phrase.motif.notes[index].beat, index)
    })
  }
})
