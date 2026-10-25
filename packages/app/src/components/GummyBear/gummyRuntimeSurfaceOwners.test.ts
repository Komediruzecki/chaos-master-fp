/** Owner metadata goldens preserve component, opposite node, chip eligibility and pigment after a tear. */
import { describe, expect, it } from 'vitest'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { prepareRuntimeGummyMetadata } from './gummyRuntimeSurface'

function fixture(torn: boolean) {
  const positions = new Float32Array([
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1, 0, -1, 0, 1, 0,
    0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1,
  ])
  const tetrahedra = new Uint32Array([
    ...(torn ? [6, 7, 8, 3] : [0, 1, 2, 3]),
    0,
    2,
    1,
    4,
    0,
    1,
    5,
    4,
  ])
  const faces = new Map<string, number[]>()
  for (let offset = 0; offset < tetrahedra.length; offset += 4) {
    const [a, b, c, q] = tetrahedra.slice(offset, offset + 4)
    for (const face of [
      [b!, c!, q!],
      [a!, q!, c!],
      [a!, b!, q!],
      [a!, c!, b!],
    ]) {
      const key = [...face].sort((x, y) => x - y).join(':')
      if (faces.has(key)) faces.delete(key)
      else faces.set(key, face)
    }
  }
  const surface = Uint32Array.from(
    [...faces.entries()].flatMap(([key, face]) => [
      ...face,
      torn && (key === '0:1:2' || key === '6:7:8')
        ? EXPOSED_TEAR_FACE
        : EXTERIOR_FACE,
    ]),
  )
  return { positions, tetrahedra, surface }
}

describe('exact incident tetrahedron surface owners', () => {
  it('preserves the previous owner map for an intact three-cell boundary', () => {
    const mesh = fixture(false)
    const result = prepareRuntimeGummyMetadata(
      mesh.positions,
      mesh.tetrahedra,
      mesh.surface,
    )
    expect(Array.from(result.metadata)).toEqual([
      1, 1, 1, 0, 1, 2, 1, 0, 1, 3, 1, 0, 1, 1, 1, 0, 1, 2, 1, 0, 1, 1, 1, 0, 1,
      2, 1, 0, 1, 5, 1, 0,
    ])
  })

  it('preserves separate coincident lips on a single chip and a joined two-cell fragment', () => {
    const mesh = fixture(true)
    const result = prepareRuntimeGummyMetadata(
      mesh.positions,
      mesh.tetrahedra,
      mesh.surface,
    )
    expect(Array.from(result.metadata)).toEqual([
      1, 7, 2, 0xffffff, 1, 8, 2, 0xffffff, 1, 9, 2, 0xffffff, 1, 4, 2,
      0xffffff, 2, 1, 1, 0xffffff, 2, 2, 1, 0xffffff, 2, 5, 1, 0xffffff, 2, 1,
      1, 0xffffff, 2, 2, 1, 0xffffff, 2, 5, 1, 0xffffff,
    ])
  })

  it('selects the inward owner rather than the first incident cell at a shared face', () => {
    const mesh = fixture(false)
    const surface = new Uint32Array([
      0,
      2,
      1,
      EXPOSED_TEAR_FACE,
      0,
      1,
      2,
      EXPOSED_TEAR_FACE,
    ])
    const result = prepareRuntimeGummyMetadata(
      mesh.positions,
      mesh.tetrahedra,
      surface,
    )
    expect(Array.from(result.metadata)).toEqual([
      1, 4, 1, 0xffffff, 1, 5, 1, 0xffffff,
    ])
  })

  it.each([
    [0, 0, 1],
    [1, 2, 5],
    [1, 3, 2],
  ])('rejects an invalid or inward boundary face %j', (...face) => {
    const mesh = fixture(false)
    expect(() =>
      prepareRuntimeGummyMetadata(
        mesh.positions,
        mesh.tetrahedra,
        new Uint32Array([...face, EXTERIOR_FACE]),
      ),
    ).toThrow('no inward tetrahedron')
  })
})
