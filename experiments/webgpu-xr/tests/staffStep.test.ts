// Musical placement checks guard against a visually plausible but incorrect score.
import assert from 'node:assert/strict'
import test from 'node:test'
import { staffLedgerSteps, staffNote, staffStep } from '../src/almanac/staff'

await test('treble staff follows diatonic notes and preserves sharp positions', () => {
  assert.deepEqual(
    [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77].map(staffStep),
    [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.equal(staffStep(61), staffStep(60))
  assert.equal(staffStep(66), staffStep(65))
  assert.equal(staffNote(61).accidental, '♯')
  assert.equal(staffNote(64).accidental, '')
})
await test('ledger lines begin at C4 below and A5 above', () => {
  assert.deepEqual(staffLedgerSteps(60), [-2])
  assert.deepEqual(staffLedgerSteps(62), [])
  assert.deepEqual(staffLedgerSteps(79), [])
  assert.deepEqual(staffLedgerSteps(81), [10])
  assert.deepEqual(staffLedgerSteps(57), [-2, -4])
  assert.deepEqual(staffLedgerSteps(84), [10, 12])
})
await test('B4 starts downward stems and note labels retain the actual octave', () => {
  assert.equal(staffNote(69).stemDown, false)
  assert.equal(staffNote(71).stemDown, true)
  assert.equal(staffNote(60).label, 'C4')
  assert.equal(staffNote(71).y, 48)
  for (const invalid of [-1, 128, NaN, Infinity, 60.5])
    assert.throws(() => staffStep(invalid), RangeError)
})
