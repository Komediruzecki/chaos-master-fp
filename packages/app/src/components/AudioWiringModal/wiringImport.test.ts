// Pins what the wiring editor's import says about text it cannot apply: not
// JSON, or JSON the wiring schema refuses, each in words a user can act on.
import { describe, expect, it } from 'vitest'
import { parseWiringImport } from './wiringImport'

const row = {
  audioFeature: 'bass',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0.5, 1.5],
}

describe('parseWiringImport', () => {
  it('reads wiring the schema accepts', () => {
    expect(parseWiringImport(JSON.stringify([row]))).toEqual({
      ok: true,
      mappings: [row],
    })
  })

  it('says when the text is not JSON', () => {
    const result = parseWiringImport('[{ "audioFeature": ')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/^That is not JSON: /)
  })

  it('says which row does not fit, and why', () => {
    const result = parseWiringImport(
      JSON.stringify([row, { ...row, target: { kind: 'renderSetting' } }]),
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(
      /^This wiring does not fit: 1\.target/,
    )
  })

  it('shows three complaints and counts the rest', () => {
    const bad = { ...row, audioFeature: 'treble' }
    const result = parseWiringImport(JSON.stringify([bad, bad, bad, bad, bad]))
    expect(!result.ok && result.error).toMatch(/\(and 2 more\)$/)
  })
})
