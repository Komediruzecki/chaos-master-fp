/** Physical occupancy, persistence and recipe-driven geometry for the first authored pawn. */
import { describe, expect, it } from 'vitest'
import { samplePawnCloud } from '@/flame/chess/pawnCloud'
import { authoredPawnField, buildGummyAuthoredPawnFlame, createAuthoredPawnField, createGummyAuthoredPawn, gummyAuthoredPawnKey, sampleAuthoredPawn, validateGummyAuthoredPawn, } from './gummyAuthoredPawn'

function cells(points: readonly number[], spacing: number) {
  const result = new Set<string>()
  for (let i = 0; i < points.length; i += 4)
    result.add(
      [0, 1, 2]
        .map((axis) => Math.round(points[i + axis]! / spacing - 0.5))
        .join(','),
    )
  return result
}

function connectedCellCount(occupied: Set<string>) {
  const pending = [occupied.values().next().value!]
  const visited = new Set(pending)
  for (let index = 0; index < pending.length; index++) {
    const cell = pending[index]!.split(',').map(Number)
    for (let axis = 0; axis < 3; axis++)
      for (const direction of [-1, 1]) {
        const neighbour = [...cell]
        neighbour[axis]! += direction
        const key = neighbour.join(',')
        if (!occupied.has(key) || visited.has(key)) continue
        visited.add(key)
        pending.push(key)
      }
  }
  return visited.size
}

describe('authored fractal pawn', () => {
  it('round trips a detached recipe and separates a label from geometry identity', () => {
    const source = createGummyAuthoredPawn({ openness: 0.7 }, 'Saved crystal')
    const restored = validateGummyAuthoredPawn(
      JSON.parse(JSON.stringify(source)),
    )!
    expect(restored).toEqual(source)
    expect(restored).not.toBe(source)
    expect(restored.recipe).not.toBe(source.recipe)
    expect(
      gummyAuthoredPawnKey({
        ...source,
        name: 'Renamed',
        recipe: { ...source.recipe, side: 'dark' },
      }),
    ).toBe(gummyAuthoredPawnKey(source))
    expect(gummyAuthoredPawnKey({ ...source, seed: source.seed + 1 })).not.toBe(
      gummyAuthoredPawnKey(source),
    )
    expect(gummyAuthoredPawnKey()).toBe('')
  })

  it('keeps only two geometry bakes and shares them across label and palette changes', () => {
    const first = createGummyAuthoredPawn({ twist: 0.31 })
    const original = createAuthoredPawnField(first)
    expect(
      createAuthoredPawnField({
        ...first,
        name: 'Renamed',
        recipe: { ...first.recipe, side: 'dark' },
      }),
    ).toBe(original)
    createAuthoredPawnField(createGummyAuthoredPawn({ twist: 0.32 }))
    createAuthoredPawnField(createGummyAuthoredPawn({ twist: 0.33 }))
    expect(createAuthoredPawnField(first)).not.toBe(original)
  })

  it('exposes the same native recursive source used inside the physical volume', () => {
    const snapshot = createGummyAuthoredPawn({ branchCount: 5, openness: 0.9 })
    const flame = buildGummyAuthoredPawnFlame(snapshot)
    const heads = new Set(
      Object.values(flame.transforms)
        .map((transform) => transform.walkGroup)
        .filter((group) => group?.startsWith('head_')),
    )
    expect(heads.size).toBe(5)
    expect(
      Object.values(flame.transforms)
        .flatMap((transform) => Object.values(transform.variations))
        .every((variation) => variation.type === 'linear3D'),
    ).toBe(true)
    const samples = samplePawnCloud(flame, {
      count: 1200,
      burnIn: 64,
      seed: snapshot.seed,
    })
    const field = createAuthoredPawnField(snapshot)
    for (let i = 0; i < samples.points.length; i += 4) {
      const point = [
        samples.points[i]!,
        samples.points[i + 1]!,
        samples.points[i + 2]!,
      ] as const
      expect(field(point)).toBeLessThan(0)
      expect(Math.abs(point[0]) + snapshot.thickness).toBeLessThan(0.82)
      expect(Math.abs(point[2]) + snapshot.thickness).toBeLessThan(0.82)
      expect(point[1] + snapshot.thickness).toBeLessThan(2.65)
    }
  })

  it.each([
    { version: 2 },
    { format: 'other' },
    { seed: -1 },
    { seed: 0x100000000 },
    { seed: 1.5 },
    { thickness: 0.119 },
    { thickness: 0.181 },
    { thickness: NaN },
    { name: ' ' },
    { name: 'x'.repeat(65) },
    { extra: true },
    { recipe: { branchCount: 3.5, openness: 0.5, twist: 0, side: 'light' } },
    { recipe: { branchCount: 3, openness: 1.01, twist: 0, side: 'light' } },
    {
      recipe: { branchCount: 3, openness: 0.5, twist: Infinity, side: 'light' },
    },
  ])('rejects malformed imported settings %j', (change) => {
    expect(
      validateGummyAuthoredPawn({ ...createGummyAuthoredPawn(), ...change }),
    ).toBeUndefined()
  })

  it.each([0.06, 0.08, 0.1, 0.12])(
    'is one connected equal-volume body at spacing %s',
    (spacing) => {
      const snapshot = createGummyAuthoredPawn()
      const particles = sampleAuthoredPawn(snapshot, spacing, 0.22)
      const occupied = cells(particles, spacing)
      expect(occupied.size).toBe(particles.length / 4)
      expect(occupied.size).toBeGreaterThan(400)
      expect(occupied.size).toBeLessThan(25_000)
      expect(connectedCellCount(occupied)).toBe(occupied.size)
      let pins = 0
      for (let i = 0; i < particles.length; i += 4) {
        expect(Math.abs(particles[i]!)).toBeLessThan(0.82)
        expect(particles[i + 1]!).toBeGreaterThanOrEqual(0)
        expect(particles[i + 1]!).toBeLessThan(2.65)
        expect(Math.abs(particles[i + 2]!)).toBeLessThan(0.82)
        if (particles[i + 3] === 0) {
          pins++
          expect(particles[i + 1]!).toBeLessThan(0.22)
        }
      }
      expect(pins).toBeGreaterThan(0)
    },
  )

  it.each([
    { branchCount: 3, openness: 1, twist: Math.PI },
    { branchCount: 8, openness: 0, twist: -Math.PI },
  ])(
    'keeps coarse material connected at admitted recipe extremes %j',
    (recipe) => {
      const snapshot = { ...createGummyAuthoredPawn(recipe), thickness: 0.12 }
      const occupied = cells(sampleAuthoredPawn(snapshot, 0.12, 0), 0.12)
      expect(connectedCellCount(occupied)).toBe(occupied.size)
    },
  )

  it('rebuilds deterministically after cache eviction and recipe changes alter occupied geometry', () => {
    const snapshot = createGummyAuthoredPawn()
    const original = sampleAuthoredPawn(snapshot, 0.1, 0)
    const changed = sampleAuthoredPawn(
      createGummyAuthoredPawn({ branchCount: 3, openness: 1, twist: 1.2 }),
      0.1,
      0,
    )
    sampleAuthoredPawn(
      createGummyAuthoredPawn({ branchCount: 8, openness: 0, twist: -1.1 }),
      0.1,
      0,
    )
    expect(sampleAuthoredPawn(snapshot, 0.1, 0)).toEqual(original)
    const first = cells(original, 0.1),
      second = cells(changed, 0.1)
    const difference = new Set(
      [...first]
        .filter((key) => !second.has(key))
        .concat([...second].filter((key) => !first.has(key))),
    )
    expect(difference.size / first.size).toBeGreaterThan(0.04)
  })

  it('retains a real central Menger cavity and empty space around its branching waist', () => {
    const snapshot = createGummyAuthoredPawn()
    const field = createAuthoredPawnField(snapshot)
    expect(field([0, 0.11 * 1.26 + snapshot.thickness, 0])).toBeGreaterThan(0)
    expect(field([0.4, 1.1, 0.4])).toBeGreaterThan(0)
    expect(field([0, 1.5, 0])).toBeLessThan(0)
    expect(authoredPawnField([0, -0.02, 0], snapshot)).toBeGreaterThan(0)
    for (const point of [
      [0.82, 0.3, 0],
      [-0.82, 0.3, 0],
      [0, 2.65, 0],
      [0, 0.3, 0.82],
    ] as const)
      expect(field(point)).toBeGreaterThan(0)
  })
})
