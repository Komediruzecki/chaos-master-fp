// Pins the check imported wiring passes before it is applied: the rows the
// flame and the commands accept, and the complaints a user reads when a row
// does not fit.
import { describe, expect, it } from 'vitest'
import { validateAudioMappingEntriesWithErrors } from './audioWiring'

const row = {
  audioFeature: 'bass',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0.5, 1.5],
}

describe('validateAudioMappingEntriesWithErrors', () => {
  it('returns the rows when every one fits', () => {
    const errors: string[] = []
    expect(
      validateAudioMappingEntriesWithErrors([row], (err) => errors.push(err)),
    ).toEqual([row])
    expect(errors).toEqual([])
  })

  it('names the row and the field that does not fit', () => {
    const errors: string[] = []
    const result = validateAudioMappingEntriesWithErrors(
      [row, { ...row, audioFeature: 'treble' }],
      (err) => errors.push(err),
    )
    expect(result).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^1\.audioFeature: /)
    expect(errors[0]).toContain('"treble"')
  })

  it('refuses more rows than a wiring may hold', () => {
    const errors: string[] = []
    const rows = Array.from({ length: 513 }, () => row)
    expect(
      validateAudioMappingEntriesWithErrors(rows, (err) => errors.push(err)),
    ).toBeUndefined()
    expect(errors.join(' ')).toContain('513')
  })

  it('refuses something that is not a list of rows', () => {
    const errors: string[] = []
    expect(
      validateAudioMappingEntriesWithErrors({ mappings: [row] }, (err) =>
        errors.push(err),
      ),
    ).toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
