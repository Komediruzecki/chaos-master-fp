/** Contact fixtures start separated and carry permanent colour labels with the material. */
import { describe, expect, it } from 'vitest'
import { sampleGummyChessMould } from './gummyChessMoulds'
import { gummyBlobDyePositions, sampleGummyParticleBlobs, sampleGummyParticleFixture, } from './gummyParticleFixtures'

describe('particle contact fixture', () => {
  it.each(['knight', 'bishop', 'queen', 'king'] as const)(
    'routes %s through its own filled chess mould',
    (fixture) => {
      const result = sampleGummyParticleFixture({ fixture, spacing: 0.12 })
      expect(result.points).toEqual(sampleGummyChessMould(fixture, 0.12))
      expect(result.pinHeight).toBe(0.22)
      expect(
        Math.max(...result.points.filter((_, i) => i % 4 === 1)),
      ).toBeGreaterThan(2.6)
    },
  )
  it('samples equal free bodies with a real initial gap at every supported resolution', () => {
    for (const spacing of [0.06, 0.08, 0.12]) {
      const samples = sampleGummyParticleBlobs(spacing)
      const left: number[] = [],
        right: number[] = []
      for (let i = 0; i < samples.length; i += 4) {
        const x = samples[i]!
        ;(x < 0 ? left : right).push(x)
        expect(samples[i + 3]).toBe(1)
        expect(samples[i + 1]).toBeGreaterThan(0)
      }
      expect(left.length).toBe(right.length)
      expect(Math.min(...right) - Math.max(...left)).toBeGreaterThan(0.5)
      const volume = (samples.length / 4) * spacing ** 3
      expect(volume).toBeCloseTo(((2 * 4) / 3) * Math.PI * 0.42 ** 3, 1)
    }
  })
  it('labels by original body without mutating physics rest positions', () => {
    const rest = new Float32Array([-0.7, 0.55, 0.1, 1, 0.7, 0.55, 0.1, 1])
    const before = rest.slice()
    const dye = gummyBlobDyePositions(rest)
    expect(rest).toEqual(before)
    expect([...dye]).toEqual([
      0,
      Math.fround(0.4),
      0,
      0,
      0,
      Math.fround(1.1),
      0,
      0,
    ])
  })
})
