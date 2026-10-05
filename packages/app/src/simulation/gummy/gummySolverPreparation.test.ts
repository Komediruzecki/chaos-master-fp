/** Cached topology rebuilds preserve rest bytes and the original greedy projection order. */
import { expect, it } from 'vitest'
import { colorGummyConstraints, createGummySolverPreparationCache, prepareGummySolverGeometry, } from './gummySolverPreparation'
import type { GummySolverMesh } from './gummySolver'

function referenceColors(indices: Uint32Array, stride: number, active: number) {
  const batches: number[][] = []
  const nodes: Set<number>[] = []
  for (let id = 0; id < indices.length / stride; id++) {
    const written = Array.from(
      indices.subarray(id * stride, id * stride + active),
    )
    let color = 0
    while (nodes[color] && written.some((node) => nodes[color]!.has(node)))
      color++
    ;(batches[color] ??= []).push(id)
    const occupied = (nodes[color] ??= new Set())
    for (const node of written) occupied.add(node)
  }
  let offset = 0
  return {
    order: Uint32Array.from(batches.flat()),
    ranges: batches.map((batch) => {
      const result = { offset, count: batch.length }
      offset += batch.length
      return result
    }),
  }
}

it('preserves exact greedy ordering through both bitmask words and overflow beyond64 colors', () => {
  const tets: number[] = []
  for (let tet = 0; tet < 96; tet++)
    tets.push(0, tet * 3 + 1, tet * 3 + 2, tet * 3 + 3)
  for (let tet = 0; tet < 300; tet++)
    tets.push(
      (tet * 17) % 287,
      (tet * 31 + 1) % 287,
      (tet * 23 + 2) % 287,
      (tet * 41 + 3) % 287,
    )
  const indices = Uint32Array.from(tets)
  const colored = colorGummyConstraints(indices, 4, 4)
  expect(colored).toEqual(referenceColors(indices, 4, 4))
  expect(colored.ranges.length).toBeGreaterThanOrEqual(96)
  for (const { offset, count } of colored.ranges) {
    const occupied = new Set<number>()
    for (const id of colored.order.subarray(offset, offset + count)) {
      const written = new Set(indices.subarray(id * 4, id * 4 + 4))
      for (const node of written) {
        expect(occupied.has(node)).toBe(false)
        occupied.add(node)
      }
    }
  }
})

it('ignores padded interface IDs when coloring legacy constraints', () => {
  const indices = Uint32Array.from([
    0, 1, 2, 3, 4, 5, 0xffffffff, 0xffffffff, 6, 7, 8, 9, 10, 11, 0xffffffff,
    0xffffffff, 1, 12, 13, 14, 15, 16, 0xffffffff, 0xffffffff,
  ])
  expect(colorGummyConstraints(indices, 8, 6)).toEqual({
    order: Uint32Array.from([0, 1, 2]),
    ranges: [
      { offset: 0, count: 2 },
      { offset: 2, count: 1 },
    ],
  })
})

function joinedMesh(): GummySolverMesh {
  return {
    positions: Float32Array.from([
      0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1,
    ]),
    tetrahedra: Uint32Array.from([0, 1, 2, 3, 0, 2, 1, 4]),
    interfaces: new Uint32Array(),
  }
}

function splitMesh(mesh: GummySolverMesh) {
  const positions = new Float32Array(32)
  positions.set(mesh.positions)
  positions.set(mesh.positions.subarray(0, 12), 20)
  // New inverse masses may differ after fracture; xyz/rest gradients do not.
  positions[7] = 2
  positions[27] = 2
  return {
    mesh: {
      ...mesh,
      positions,
      tetrahedra: Uint32Array.from([0, 1, 2, 3, 5, 7, 6, 4]),
    },
    sourceNodes: Uint32Array.from([0, 1, 2, 3, 4, 0, 1, 2]),
  }
}

it('produces byte-identical rest records after a valid topology-only node split', () => {
  const cache = createGummySolverPreparationCache()
  const joined = joinedMesh()
  cache.prepare(joined, true)
  const split = splitMesh(joined)
  const cached = cache.prepare(split.mesh, true, split.sourceNodes)
  const fresh = prepareGummySolverGeometry(split.mesh, true)
  expect(new Uint8Array(cached.restTets.buffer)).toEqual(
    new Uint8Array(fresh.restTets.buffer),
  )
  expect(new Uint8Array(cached.jellyTets!.buffer)).toEqual(
    new Uint8Array(fresh.jellyTets!.buffer),
  )
  expect(
    Array.from(new Uint32Array(cached.jellyTets!.buffer).subarray(16, 20)),
  ).toEqual([5, 7, 6, 4])
})

it('owns cache snapshots so modified input and returned arrays cannot corrupt later rest data', () => {
  const cache = createGummySolverPreparationCache()
  const joined = joinedMesh()
  const split = splitMesh(joined)
  const first = cache.prepare(joined, true)
  first.restTets.fill(0)
  first.jellyTets!.fill(0)
  joined.positions.fill(0)
  joined.tetrahedra.fill(0)
  expect(cache.prepare(split.mesh, true, split.sourceNodes)).toEqual(
    prepareGummySolverGeometry(split.mesh, true),
  )
})

it.each(['coordinates', 'ancestry', 'connectivity'] as const)(
  'falls back to exact fresh preparation if %s changed',
  (change) => {
    const joined = joinedMesh()
    const cache = createGummySolverPreparationCache()
    cache.prepare(joined, true)
    const split = splitMesh(joined)
    if (change === 'coordinates') split.mesh.positions[18] = -2
    if (change === 'ancestry') split.sourceNodes[4] = 3
    if (change === 'connectivity') split.mesh.tetrahedra.set([1, 2, 0, 3], 0)
    expect(cache.prepare(split.mesh, true, split.sourceNodes)).toEqual(
      prepareGummySolverGeometry(split.mesh, true),
    )
  },
)

it('does not reuse edge-only preparation as continuum gradients', () => {
  const cache = createGummySolverPreparationCache()
  const mesh = joinedMesh()
  cache.prepare(mesh, false)
  expect(cache.prepare(mesh, true, Uint32Array.from([0, 1, 2, 3, 4]))).toEqual(
    prepareGummySolverGeometry(mesh, true),
  )
  expect(() =>
    cache.prepare(
      { ...mesh, positions: Float32Array.from([NaN, 0, 0, 1]) },
      true,
    ),
  ).toThrow('Invalid gummy position')
})
