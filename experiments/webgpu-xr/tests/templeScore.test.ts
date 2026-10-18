// Musical identity, headroom and reveal timing remain independent of rendering speed.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { SCORE_RELEASE_SECONDS, TEMPLE_DURATION_SECONDS, TEMPLE_SCORE, TEMPLE_SECTIONS, TEMPLE_SOURCE_MOTIFS, templeCue, } from '../src/journey/templeScore'

await test('the ending states both complete original motifs without changing the earned-page scores', () => {
  const originals = ALMANAC_WORLDS.slice(0, 2).map((world) => world.motif!)
  const before = JSON.stringify(originals)
  assert.deepEqual(
    TEMPLE_SOURCE_MOTIFS,
    originals.map((motif) => motif.id),
  )
  for (const [index, motif] of originals.entries()) {
    const statement = TEMPLE_SCORE.notes.slice(index * 8, index * 8 + 8)
    assert.deepEqual(
      statement.map((note) => ({
        midi: note.midi,
        beat: note.beat - index * 9,
        duration: note.duration,
      })),
      motif.notes,
    )
    assert.ok(statement.every((note) => note.timbre === motif.timbre))
  }
  const dorian = TEMPLE_SCORE.notes.slice(8, 16)
  assert.equal(dorian[0].midi, 62)
  assert.equal(dorian.at(-1)!.midi, 62)
  assert.ok(dorian.some((note) => note.midi === 71))
  assert.equal(JSON.stringify(originals), before)
})

await test('the original duet has bounded voices and a D-centered cadence within thirty seconds', () => {
  assert.equal(TEMPLE_SCORE.notes.length, 29)
  assert.equal(TEMPLE_SCORE.tempo, 72)
  assert.ok(TEMPLE_DURATION_SECONDS >= 22 && TEMPLE_DURATION_SECONDS <= 30)
  assert.ok(Math.abs(TEMPLE_DURATION_SECONDS - 26.68) < 1e-10)
  const end = Math.max(
    ...TEMPLE_SCORE.notes.map((note) => note.beat + note.duration),
  )
  assert.equal(
    TEMPLE_DURATION_SECONDS,
    (end * 60) / TEMPLE_SCORE.tempo + SCORE_RELEASE_SECONDS,
  )
  for (const note of TEMPLE_SCORE.notes) {
    assert.ok(Number.isInteger(note.midi) && note.midi >= 24 && note.midi <= 96)
    assert.ok([0, 2, 4, 5, 7, 9, 11].includes(note.midi % 12))
    assert.ok(note.duration > 0 && note.duration <= 8)
    assert.ok(note.gain > 0 && note.gain <= 1)
  }
  const shared = TEMPLE_SCORE.notes.filter(
    (note) => note.beat >= 18 && note.beat < 26,
  )
  for (const beat of [18, 20, 22, 24]) {
    const pair = shared.filter((note) => note.beat === beat)
    assert.equal(pair.length, 2)
    assert.deepEqual(
      pair.map((note) => note.timbre),
      ['glass', 'reed'],
    )
  }
  // Each note uses two partials whose weights sum to one and peak scale is 0.11.
  // Include release tails in this upper bound, rather than measuring only attacks.
  for (let seconds = 0; seconds <= TEMPLE_DURATION_SECONDS; seconds += 0.01) {
    const sounding = TEMPLE_SCORE.notes.filter(
      (note) =>
        seconds >= (note.beat * 60) / TEMPLE_SCORE.tempo &&
        seconds <
          ((note.beat + note.duration) * 60) / TEMPLE_SCORE.tempo +
            SCORE_RELEASE_SECONDS,
    )
    assert.ok(sounding.length <= 4)
    assert.ok(sounding.reduce((sum, note) => sum + note.gain * 0.11, 0) < 0.2)
  }
  assert.equal(TEMPLE_SCORE.notes.at(-1)!.midi, 74)
  const lastChord = TEMPLE_SCORE.notes.filter(
    (note) => note.beat + note.duration === end,
  )
  assert.deepEqual(
    new Set(lastChord.map((note) => note.midi % 12)),
    new Set([2, 9]),
  )
})

await test('audio progress selects exact sections and only the full passage completes the reveal', () => {
  const atBeat = (beat: number) =>
    templeCue((beat * 60) / TEMPLE_SCORE.tempo / TEMPLE_DURATION_SECONDS)
  for (const section of TEMPLE_SECTIONS) {
    const cue = atBeat(section.startBeat + 1e-6)
    assert.equal(cue.section, section.id)
    assert.ok(cue.sectionProgress < 1e-5)
    assert.equal(cue.label, section.label)
  }
  assert.equal(atBeat(17.999).revealProgress, 0)
  assert.ok(atBeat(24).revealProgress > 0 && atBeat(24).revealProgress < 1)
  const tail = templeCue(
    (TEMPLE_DURATION_SECONDS - 0.09) / TEMPLE_DURATION_SECONDS,
  )
  assert.equal(tail.section, 'threshold')
  assert.equal(tail.revealProgress, 1)
  assert.equal(templeCue(1).section, 'complete')
  assert.equal(templeCue(1).elapsedSeconds, TEMPLE_DURATION_SECONDS)
  assert.equal(templeCue(-1).elapsedSeconds, 0)
  assert.equal(templeCue(NaN).elapsedSeconds, 0)
  assert.equal(templeCue(Infinity).elapsedSeconds, 0)
  assert.equal(templeCue(3).section, 'complete')
})
