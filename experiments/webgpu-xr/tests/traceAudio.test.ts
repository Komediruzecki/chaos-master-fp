// Musical mapping tests preserve authored pitches while the spatial cursor moves continuously.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BRIDGE_PHRASES } from '../src/observatory/bridgePhrases'
import { BRIDGE_MOTIF, BRIDGE_TARGET } from '../src/observatory/encounter'
import { pitchForTraceHeight } from '../src/observatory/traceAudio'

void test('each ribbon anchor plays its exact D-F-B-A pitch', () => {
  BRIDGE_TARGET.forEach((point, index) => {
    assert.equal(pitchForTraceHeight(point[1]), BRIDGE_MOTIF.notes[index].midi)
  })
})

void test('moving upward raises pitch smoothly between anchors and clamps the study register', () => {
  assert.equal(pitchForTraceHeight(0.4), 67.66666666666667)
  assert.equal(pitchForTraceHeight(0), 71)
  assert.equal(pitchForTraceHeight(1), 62)
  let previous = 71
  for (let height = 0; height <= 1; height += 0.005) {
    const midi = pitchForTraceHeight(height)!
    assert.ok(midi <= previous)
    assert.ok(Math.abs(midi - previous) < 0.1)
    previous = midi
  }
  assert.equal(pitchForTraceHeight(NaN), null)
  assert.equal(pitchForTraceHeight(Infinity), null)
})

for (const phrase of BRIDGE_PHRASES) {
  void test(`${phrase.title} sounds its exact authored notes, including a copied descriptor`, () => {
    for (const selected of [phrase, structuredClone(phrase)]) {
      phrase.target.forEach((point, index) => {
        assert.equal(
          pitchForTraceHeight(point[1], selected),
          phrase.motif.notes[index].midi,
        )
      })
      let previous = 71
      for (let height = 0; height <= 1; height += 0.005) {
        const midi = pitchForTraceHeight(height, selected)!
        assert.ok(Number.isFinite(midi))
        assert.ok(midi >= 62 && midi <= 71)
        assert.ok(midi <= previous)
        assert.ok(Math.abs(midi - previous) < 0.1)
        previous = midi
      }
      assert.equal(pitchForTraceHeight(NaN, selected), null)
      assert.equal(pitchForTraceHeight(-Infinity, selected), null)
    }
  })
}
