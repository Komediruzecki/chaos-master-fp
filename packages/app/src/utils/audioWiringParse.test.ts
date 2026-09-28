// Pins how a stored or shared flame's audio wiring is read: kept when it fits
// the wiring schema, dropped on its own when it does not.
import { describe, expect, it } from 'vitest'
import { parseAudioWiring } from './audioWiringParse'

const wiring = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.5, 1.5],
    },
  ],
}

describe('parseAudioWiring', () => {
  it('keeps a wiring that fits', () => {
    expect(parseAudioWiring(wiring)).toEqual(wiring)
  })

  it('is undefined where there is no wiring', () => {
    expect(parseAudioWiring(undefined)).toBeUndefined()
  })

  it('drops a wiring the schema refuses', () => {
    for (const hostile of [
      { ...wiring, preset: 'party' },
      { ...wiring, mappings: 'all of them' },
      {
        ...wiring,
        mappings: [
          {
            ...wiring.mappings[0],
            target: { kind: 'transformAffine', transformIdx: -1 },
          },
        ],
      },
      {
        ...wiring,
        mappings: Array.from({ length: 513 }, () => wiring.mappings[0]),
      },
    ]) {
      expect(parseAudioWiring(hostile)).toBeUndefined()
    }
  })
})
