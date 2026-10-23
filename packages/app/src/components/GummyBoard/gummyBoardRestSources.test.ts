/** Occupancy input checks keep malformed geometry out of the GPU allocation path. */
import { describe, expect, it } from 'vitest'
import { resolveGummyBoardRestSource, validateGummyBoardRestSource, } from './gummyBoardRestSources'

const source = {
  restPositions: new Float32Array([0, 0.1, 0, 1]),
  spacing: 0.04,
  bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
}
describe('resting solid sources', () => {
  it('preserves candidate spacing and sampling without sculpted projection', () => {
    const resolved = resolveGummyBoardRestSource(
      'rook',
      0.08,
      'sculpted',
      undefined,
      { rook: source },
    )
    expect(resolved.restPositions).toBe(source.restPositions)
    expect(resolved.spacing).toBe(0.04)
    expect(resolved.bounds).toBe(source.bounds)
    expect(resolved.refine).toBe(false)
  })
  it.each([
    { ...source, spacing: 0 },
    { ...source, restPositions: new Float32Array() },
    { ...source, restPositions: new Float32Array([0, 0, 0]) },
    { ...source, restPositions: new Float32Array([0, NaN, 0, 1]) },
    { ...source, restPositions: new Float32Array([0, 3, 0, 1]) },
    { ...source, bounds: { min: [0, 0, 0], max: [0, 1, 1] } },
  ])('rejects invalid samples or bounds before baking', (invalid) => {
    expect(() => {
      validateGummyBoardRestSource(invalid)
    }).toThrow()
  })
})
