// Pins the attack and release a mapping row runs at, which is what the wiring
// editor and the panel rows show: an unset time follows the other one, as the
// envelope does, and nothing stands in for a time that is not there.
import { describe, expect, it } from 'vitest'
import { effectiveEnvelope, envelopeLabel } from './audioEnvelope'

describe('effectiveEnvelope', () => {
  it('keeps the times a row sets', () => {
    expect(effectiveEnvelope({ attackMs: 1500, releaseMs: 1800 })).toEqual({
      attackMs: 1500,
      releaseMs: 1800,
    })
  })

  it('runs an unset attack at the release, as the envelope does', () => {
    expect(effectiveEnvelope({ releaseMs: 300 })).toEqual({
      attackMs: 300,
      releaseMs: 300,
    })
  })

  it('keeps an explicit zero attack instant', () => {
    expect(effectiveEnvelope({ attackMs: 0, releaseMs: 300 })).toEqual({
      attackMs: 0,
      releaseMs: 300,
    })
  })

  it('is instant both ways when neither is set', () => {
    expect(effectiveEnvelope({})).toEqual({ attackMs: 0, releaseMs: 0 })
  })
})

describe('envelopeLabel', () => {
  it('names both times in milliseconds', () => {
    expect(envelopeLabel({ attackMs: 1500, releaseMs: 1800 })).toBe(
      'Attack 1500 ms · Release 1800 ms',
    )
  })
})
