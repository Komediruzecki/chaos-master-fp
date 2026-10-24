// The canonical crossing remains byte-for-value stable while reprises provide distinct bounded contours.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BRIDGE_PHRASES, FIRST_BRIDGE_PHRASE, } from '../src/observatory/bridgePhrases'
import { BRIDGE_RESOLUTION, bridgeResolutionFor, } from '../src/observatory/bridgeScore'
import { BRIDGE_MOTIF, BRIDGE_NOTE_NAMES, BRIDGE_TARGET, } from '../src/observatory/encounter'

void test('the first crossing preserves its published coordinates and teaching motif', () => {
  assert.equal(FIRST_BRIDGE_PHRASE.id, 'first-crossing')
  assert.equal(BRIDGE_TARGET, FIRST_BRIDGE_PHRASE.target)
  assert.equal(BRIDGE_MOTIF, FIRST_BRIDGE_PHRASE.motif)
  assert.equal(BRIDGE_NOTE_NAMES, FIRST_BRIDGE_PHRASE.noteNames)
  assert.deepEqual(BRIDGE_TARGET, [
    [0.12, 0.78],
    [0.37, 0.56],
    [0.63, 0.16],
    [0.88, 0.32],
  ])
  assert.deepEqual(BRIDGE_NOTE_NAMES, ['D', 'F', 'B', 'A'])
  assert.deepEqual(BRIDGE_MOTIF, {
    id: 'tideweave-bridge-four',
    tonic: 'D',
    mode: 'Dorian',
    tempo: 82,
    timbre: 'reed',
    notes: [
      { midi: 62, beat: 0, duration: 0.72 },
      { midi: 65, beat: 1, duration: 0.72 },
      { midi: 71, beat: 2, duration: 0.72 },
      { midi: 69, beat: 3, duration: 1.35 },
    ],
  })
})

void test('three authored phrases use distinct contours within the same four-station register', () => {
  assert.equal(new Set(BRIDGE_PHRASES.map((phrase) => phrase.id)).size, 3)
  assert.equal(
    new Set(BRIDGE_PHRASES.map((phrase) => JSON.stringify(phrase.target))).size,
    3,
  )
  for (const phrase of BRIDGE_PHRASES) {
    assert.equal(phrase.target.length, 4)
    assert.equal(phrase.motif.notes.length, 4)
    assert.equal(phrase.noteNames.length, 4)
    assert.equal(phrase.motif.mode, 'Dorian')
    assert.equal(phrase.motif.tonic, 'D')
    phrase.target.forEach((point, index) => {
      assert.ok(point.every((coordinate) => coordinate > 0 && coordinate < 1))
      if (index > 0) assert.ok(point[0] > phrase.target[index - 1][0])
      const midi = phrase.motif.notes[index].midi
      assert.ok([62, 64, 65, 67, 69, 71].includes(midi))
      phrase.target.forEach((other, otherIndex) => {
        if (other[1] === point[1])
          assert.equal(phrase.motif.notes[otherIndex].midi, midi)
      })
    })
  }
  assert.equal(BRIDGE_PHRASES[2].motif.notes.at(-1)?.midi, 62)
})

void test('each crossing answers the note actually played before returning to D', () => {
  assert.deepEqual(bridgeResolutionFor(FIRST_BRIDGE_PHRASE), BRIDGE_RESOLUTION)
  for (const phrase of BRIDGE_PHRASES) {
    const answer = bridgeResolutionFor(phrase)
    assert.equal(answer[0].midi, phrase.motif.notes.at(-1)!.midi)
    assert.deepEqual(
      answer.slice(1).map((note) => note.midi),
      [50, 62, 74],
    )
    assert.ok(answer.every((note) => note.gain <= 0.04 && note.duration < 1))
  }
  assert.equal(BRIDGE_RESOLUTION[0].midi, 69)
})
