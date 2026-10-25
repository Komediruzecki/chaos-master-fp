// Seal progression is earned by bounded held input and committed only by release.
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceGlassHold, beginGlassHold, cancelGlassHold, createGlasswakeEncounter, GLASS_HOLD_SECONDS, GLASS_MOTIF, GLASS_NOTES, releaseGlassHold, updateGlassPitch, } from '../src/observatory/glasswakeEncounter'
import { FIRST_GLASS_PHRASE, GLASS_PHRASES, } from '../src/observatory/glasswakePhrases'
import type { GlasswakeEncounterState } from '../src/observatory/glasswakeEncounter'
import type { GlassPhrase } from '../src/observatory/glasswakePhrases'

function hold(
  state: GlasswakeEncounterState,
  seconds: number,
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
) {
  let next = state
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.01)
    next = advanceGlassHold(next, Math.min(0.01, seconds - elapsed), phrase)
  return next
}

function arm(
  state = createGlasswakeEncounter(),
  phrase: GlassPhrase = FIRST_GLASS_PHRASE,
) {
  return hold(
    beginGlassHold(state, phrase.notes[state.accepted].midi, phrase),
    GLASS_HOLD_SECONDS,
    phrase,
  )
}

await test('the reference phrase uses the three seal pitches in order', () => {
  assert.deepEqual(
    GLASS_NOTES.map((note) => note.midi),
    [60, 64, 67],
  )
  assert.deepEqual(
    GLASS_MOTIF.notes.map((note) => note.midi),
    [60, 64, 67],
  )
  assert.equal(GLASS_MOTIF.tonic, 'C')
  assert.equal(GLASS_MOTIF.timbre, 'glass')
})

await test('holding charges one seal but only an explicit release commits it', () => {
  const initial = Object.freeze(createGlasswakeEncounter())
  const almost = hold(beginGlassHold(initial, 60), GLASS_HOLD_SECONDS - 0.01)
  assert.equal(almost.armed, false)
  assert.equal(almost.accepted, 0)
  const armed = advanceGlassHold(almost, 0.01)
  assert.equal(armed.armed, true)
  assert.equal(armed.charge, 1)
  assert.equal(hold(armed, 10).accepted, 0)
  const released = releaseGlassHold(armed)
  assert.equal(released.accepted, 1)
  assert.equal(released.holding, false)
  assert.equal(released.charge, 0)
  assert.equal(releaseGlassHold(released).accepted, 1)
  assert.deepEqual(initial, createGlasswakeEncounter())
})

await test('the pitch window includes 40 cents but excludes pitches beyond it', () => {
  assert.equal(arm({ ...createGlasswakeEncounter(), accepted: 1 }).armed, true)
  for (const pitch of [63.6, 64.4]) {
    const state = beginGlassHold(
      { ...createGlasswakeEncounter(), accepted: 1 },
      pitch,
    )
    assert.equal(hold(state, GLASS_HOLD_SECONDS).armed, true)
  }
  for (const pitch of [63.59, 64.41]) {
    const state = beginGlassHold(
      { ...createGlasswakeEncounter(), accepted: 1 },
      pitch,
    )
    assert.equal(hold(state, GLASS_HOLD_SECONDS).charge, 0)
  }
})

await test('wrong pitch gradually drains charge and the player can recover', () => {
  const charged = hold(beginGlassHold(createGlasswakeEncounter(), 60), 0.45)
  assert.ok(Math.abs(charged.charge - 0.5) < 1e-9)
  const slipped = hold(updateGlassPitch(charged, 62), 0.12)
  assert.ok(slipped.charge > 0 && slipped.charge < charged.charge)
  assert.equal(slipped.feedback, 'tune')
  const recovered = hold(updateGlassPitch(slipped, 60), GLASS_HOLD_SECONDS)
  assert.equal(recovered.armed, true)
  assert.equal(releaseGlassHold(recovered).accepted, 1)
})

await test('early release and retry preserve completed seals but require a new hold', () => {
  const first = releaseGlassHold(arm())
  const early = releaseGlassHold(hold(beginGlassHold(first, 64), 0.5))
  assert.equal(early.accepted, 1)
  assert.equal(early.feedback, 'early')
  assert.equal(early.charge, 0)
  assert.equal(advanceGlassHold(early, 0.05).charge, 0)
  assert.equal(releaseGlassHold(arm(early)).accepted, 2)
})

await test('armed state survives pitch drift and repeated presses until release or cancel', () => {
  const armed = arm()
  const drift = hold(beginGlassHold(updateGlassPitch(armed, 72), 71), 2)
  assert.equal(drift.armed, true)
  assert.equal(drift.charge, 1)
  assert.equal(releaseGlassHold(drift).accepted, 1)
  const cancelled = cancelGlassHold(drift)
  assert.equal(cancelled.accepted, 0)
  assert.equal(cancelled.charge, 0)
  assert.equal(cancelled.holding, false)
  assert.equal(releaseGlassHold(cancelled).accepted, 0)
  assert.equal(hold(beginGlassHold(cancelled, 60), 0.1).armed, false)
})

await test('cancel during any seal retains only previously released seals', () => {
  let state = createGlasswakeEncounter()
  for (let accepted = 0; accepted < 3; accepted++) {
    const cancelled = cancelGlassHold(arm(state))
    assert.equal(cancelled.accepted, accepted)
    assert.equal(releaseGlassHold(cancelled).accepted, accepted)
    state = releaseGlassHold(arm(cancelled))
  }
  assert.equal(state.accepted, 3)
  assert.equal(state.feedback, 'complete')
  assert.equal(beginGlassHold(state, 60), state)
  assert.equal(releaseGlassHold(state), state)
  assert.equal(cancelGlassHold(state).accepted, 3)
  assert.equal(createGlasswakeEncounter().accepted, 0)
})

await test('stalled, hidden and invalid frame intervals never award charge', () => {
  const state = hold(beginGlassHold(createGlasswakeEncounter(), 60), 0.4)
  for (const dt of [0, -0.01, NaN, Infinity, 0.051, 1, 60])
    assert.deepEqual(advanceGlassHold(state, dt), state)
  assert.ok(advanceGlassHold(state, 0.05).charge > state.charge)
  assert.equal(releaseGlassHold(state).accepted, 0)
})

await test('invalid pitch cancels even an armed hold without committing', () => {
  for (const pitch of [NaN, Infinity, -Infinity, 59.99, 72.01]) {
    for (const next of [
      beginGlassHold(arm(), pitch),
      updateGlassPitch(arm(), pitch),
    ]) {
      assert.equal(next.accepted, 0)
      assert.equal(next.holding, false)
      assert.equal(next.armed, false)
      assert.ok(Number.isFinite(next.pitch))
      assert.equal(releaseGlassHold(next).accepted, 0)
    }
  }
})

await test('malformed numeric state fails closed with finite bounded fields', () => {
  for (const state of [
    { ...arm(), accepted: NaN },
    { ...arm(), accepted: -3 },
    { ...arm(), accepted: 1.5 },
    { ...arm(), accepted: 7 },
    { ...arm(), pitch: NaN },
    { ...arm(), charge: Infinity },
    { ...arm(), charge: 2 },
  ]) {
    for (const next of [
      advanceGlassHold(state, 0.05),
      releaseGlassHold(state),
      cancelGlassHold(state),
    ]) {
      assert.ok(
        Number.isInteger(next.accepted) &&
          next.accepted >= 0 &&
          next.accepted <= 3,
      )
      assert.ok(
        Number.isFinite(next.pitch) && next.pitch >= 60 && next.pitch <= 72,
      )
      assert.equal(next.charge, 0)
      assert.equal(next.holding, false)
      assert.equal(next.armed, false)
    }
  }
})

await test('returning to a world restores released seals without restoring a held gesture', () => {
  for (const accepted of [0, 1, 2, 3]) {
    const state = createGlasswakeEncounter(accepted)
    assert.equal(state.accepted, accepted)
    assert.equal(state.pitch, GLASS_NOTES[Math.min(accepted, 2)].midi)
    assert.equal(state.feedback, accepted === 3 ? 'complete' : 'ready')
    assert.equal(state.holding, false)
    assert.equal(state.armed, false)
    assert.equal(state.charge, 0)
    assert.equal(releaseGlassHold(state).accepted, accepted)
  }
  const resumed = createGlasswakeEncounter(1)
  assert.equal(releaseGlassHold(arm(resumed)).accepted, 2)
  assert.equal(createGlasswakeEncounter().accepted, 0)
})

await test('invalid restored counts start fresh and cannot manufacture completed seals', () => {
  for (const count of [NaN, Infinity, -Infinity, -1, 0.5, 1.5, 3.1, 4])
    assert.deepEqual(
      createGlasswakeEncounter(count),
      createGlasswakeEncounter(),
    )
})

for (const phrase of GLASS_PHRASES) {
  await test(`${phrase.id} requires three deliberate releases in its authored note order`, () => {
    let state = createGlasswakeEncounter(0, phrase)
    assert.equal(state.pitch, phrase.notes[0].midi)
    for (let index = 0; index < phrase.notes.length; index++) {
      const armed = arm(state, phrase)
      assert.equal(armed.accepted, index)
      assert.equal(armed.armed, true)
      assert.equal(hold(armed, 2, phrase).accepted, index)
      const cancelled = cancelGlassHold(armed, phrase)
      assert.equal(releaseGlassHold(cancelled, phrase).accepted, index)
      assert.equal(cancelled.charge, 0)
      state = releaseGlassHold(arm(cancelled, phrase), phrase)
      assert.equal(state.accepted, index + 1)
    }
    assert.equal(state.feedback, 'complete')
    assert.equal(beginGlassHold(state, 60, phrase), state)
    assert.equal(releaseGlassHold(state, phrase), state)
  })

  await test(`${phrase.id} restores the next authored note and fails closed on invalid input`, () => {
    for (let accepted = 0; accepted <= phrase.notes.length; accepted++) {
      const state = createGlasswakeEncounter(accepted, phrase)
      assert.equal(state.pitch, phrase.notes[Math.min(accepted, 2)].midi)
      assert.equal(state.holding, false)
      assert.equal(state.armed, false)
      assert.equal(releaseGlassHold(state, phrase).accepted, accepted)
    }
    for (const count of [NaN, Infinity, -1, 1.5, 4])
      assert.deepEqual(
        createGlasswakeEncounter(count, phrase),
        createGlasswakeEncounter(0, phrase),
      )
    const armed = arm(createGlasswakeEncounter(0, phrase), phrase)
    for (const pitch of [NaN, Infinity, 59.99, 72.01]) {
      const cancelled = updateGlassPitch(armed, pitch, phrase)
      assert.equal(cancelled.holding, false)
      assert.equal(cancelled.armed, false)
      assert.equal(releaseGlassHold(cancelled, phrase).accepted, 0)
    }
    const invalidState = { ...armed, pitch: NaN }
    const repaired = cancelGlassHold(invalidState, phrase)
    assert.equal(repaired.pitch, phrase.notes[0].midi)
    assert.equal(releaseGlassHold(invalidState, phrase).accepted, 0)
  })
}

await test('practice targets reject the original phrase note when its pitch differs', () => {
  for (const phrase of GLASS_PHRASES.slice(1)) {
    for (let accepted = 0; accepted < phrase.notes.length; accepted++) {
      if (phrase.notes[accepted].midi === GLASS_NOTES[accepted].midi) continue
      const state = createGlasswakeEncounter(accepted, phrase)
      const wrong = hold(
        beginGlassHold(state, GLASS_NOTES[accepted].midi, phrase),
        GLASS_HOLD_SECONDS * 2,
        phrase,
      )
      assert.equal(wrong.charge, 0)
      assert.equal(wrong.armed, false)
      assert.equal(wrong.feedback, 'tune')
      assert.equal(releaseGlassHold(wrong, phrase).accepted, accepted)
      const recovered = hold(
        updateGlassPitch(wrong, phrase.notes[accepted].midi, phrase),
        GLASS_HOLD_SECONDS,
        phrase,
      )
      assert.equal(releaseGlassHold(recovered, phrase).accepted, accepted + 1)
    }
  }
})
