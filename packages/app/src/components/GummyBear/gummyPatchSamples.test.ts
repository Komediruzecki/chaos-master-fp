/** Expanded triangles remain byte-identical to the previous unindexed patch reconstruction. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { prepareGummyPatchSamples } from './gummyPatchSamples'

function digest(corners: Float32Array, indices: Uint32Array) {
  const expanded = new Float32Array(indices.length * 4)
  for (const [offset, index] of indices.entries())
    expanded.set(corners.subarray(index * 4, index * 4 + 4), offset * 4)
  return createHash('sha256')
    .update(new Uint8Array(expanded.buffer))
    .digest('hex')
}

const surface = new Uint32Array([
  0,
  1,
  2,
  EXTERIOR_FACE,
  3,
  4,
  5,
  EXPOSED_TEAR_FACE,
])

describe('shared gummy patch samples', () => {
  it('retains the complete legacy triangle stream with only 15 samples per smooth face', () => {
    const result = prepareGummyPatchSamples(surface)
    expect(result.corners).toHaveLength((15 + 3) * 4)
    expect(result.indices).toHaveLength(16 * 3 + 3)
    expect(result.roundedIndices).toBe(result.indices)
    expect(digest(result.corners, result.indices)).toBe(
      '8689a23d9ce50510deb77000954ca7f28ffe0641ff59ec296195e52148b64b98',
    )
  })

  it('shares 45 samples on chip faces without changing either surface mode triangle stream', () => {
    const result = prepareGummyPatchSamples(
      surface,
      new Uint32Array([1, 4, 1, 0, 2, 7, 2, 0]),
    )
    expect(result.corners).toHaveLength((15 + 45) * 4)
    expect(result.indices).toHaveLength(2 * 16 * 3)
    expect(result.roundedIndices).toHaveLength((16 + 64) * 3)
    expect(digest(result.corners, result.indices)).toBe(
      'bfe3ed72681052944f3bae422040ba06df8f9cc9df8aba3b1d034c798eb8d0a6',
    )
    expect(digest(result.corners, result.roundedIndices)).toBe(
      'b86020fd6c97f9aa5b8c22e1be6eda1932c5eac6db9d04d231cf3424a0ba8c39',
    )
    // Each face retains its own samples and material owner, even for coincident geometry.
    for (const index of result.roundedIndices.slice(0, 48))
      expect(result.corners[index * 4 + 3]).toBe(0)
    for (const index of result.roundedIndices.slice(48))
      expect(result.corners[index * 4 + 3]).toBe(1)
  })
})
