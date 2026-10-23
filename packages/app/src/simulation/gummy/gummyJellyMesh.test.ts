/** Resolution changes preserve the continuous jelly density, material geometry, and fixed fixture. */
import { describe, expect, it } from 'vitest'
import { createGummyJellyFracture } from './gummyJellyFracture'
import { buildGummyJellyMesh } from './gummyJellyMesh'
import { buildGummyBearMesh } from './gummyMesh'
import type { GummyMesh } from './gummyMesh'

const density = (mesh: GummyMesh) => {
  let mass = 0
  for (let i = 3; i < mesh.positions.length; i += 4)
    mass += 1 / mesh.positions[i]!
  return mass / mesh.restVolume
}

describe('jelly resolution mass consistency', () => {
  it('preserves every Standard buffer exactly, including pinned inverse masses', () => {
    const original = buildGummyBearMesh({ fracture: 'none', pinHeight: 0.3 })
    const standard = buildGummyJellyMesh({ pinHeight: 0.3 })
    expect(standard.positions).toEqual(original.positions)
    expect(standard.tetrahedra).toEqual(original.tetrahedra)
    expect(standard.surface).toEqual(original.surface)
    expect(standard.restNormals).toEqual(original.restNormals)
    expect(standard.massReferenceVolume).toBe(
      original.restVolume / (original.positions.length / 4),
    )
  })

  it('corrects Fine density without changing positions, topology, pins, or relative sliver masses', () => {
    const options = { spacing: 0.1, pinHeight: 0.3 }
    const original = buildGummyBearMesh({ ...options, fracture: 'none' })
    const fine = buildGummyJellyMesh(options)
    const ratio =
      fine.massReferenceVolume /
      (original.restVolume / (original.positions.length / 4))
    expect(ratio).toBeCloseTo(2.11689035, 6)
    for (let i = 0; i < original.positions.length; i += 4) {
      expect(fine.positions.subarray(i, i + 3)).toEqual(
        original.positions.subarray(i, i + 3),
      )
      expect(fine.positions[i + 3]).toBe(
        Math.fround(original.positions[i + 3]! * ratio),
      )
    }
    expect(fine.tetrahedra).toEqual(original.tetrahedra)
    expect(fine.surface).toEqual(original.surface)
    expect(fine.restNormals).toEqual(original.restNormals)
    expect(fine.restVolume).toBe(original.restVolume)
    expect(fine.interfaces).toHaveLength(0)
  })

  it('keeps integrated study density within the small clipped-sliver floor difference', () => {
    const standard = buildGummyJellyMesh({ pinnedFeet: false })
    const fine = buildGummyJellyMesh({ spacing: 0.1, pinnedFeet: false })
    // The mesh-dependent sliver floor adds a little nonphysical mass, but a
    // resolution change must not double density with the number of vertices.
    expect(Math.abs(density(fine) / density(standard) - 1)).toBeLessThan(0.003)
    const second = buildGummyJellyMesh({ spacing: 0.1, pinnedFeet: false })
    expect(second.positions).toEqual(fine.positions)
    expect(second.massReferenceVolume).toBe(standard.massReferenceVolume)
  })

  it('accounts for Fine fixed mass with the same density and conserves every nodal mass through a split', () => {
    const fixed = buildGummyJellyMesh({ spacing: 0.1, pinHeight: 0.3 })
    const free = buildGummyJellyMesh({ spacing: 0.1, pinnedFeet: false })
    const fracture = createGummyJellyFracture(fixed)
    const originalMasses = fracture.nodeMasses.slice()
    for (let node = 0; node < originalMasses.length; node++)
      expect(originalMasses[node]! * free.positions[node * 4 + 3]!).toBeCloseTo(
        1,
        5,
      )
    const pulled = fixed.positions.slice()
    for (let i = 2; i < pulled.length; i += 4) pulled[i]! *= 3
    const split = fracture.assess(pulled, 10, {
      tearing: true,
      softness: 0.55,
      fragility: 1,
      response: 'crumble',
    })!
    expect(split).toBeDefined()
    expect(split.mesh.massReferenceVolume).toBe(fixed.massReferenceVolume)
    const partitioned = new Float64Array(originalMasses.length)
    for (let node = 0; node < split.nodeMasses.length; node++) {
      const source = split.sourceNodes[node]!
      partitioned[source]! += split.nodeMasses[node]!
      expect(split.mesh.positions[node * 4 + 3] === 0).toBe(
        fixed.positions[source * 4 + 3] === 0,
      )
    }
    for (let node = 0; node < originalMasses.length; node++)
      expect(partitioned[node]).toBeCloseTo(originalMasses[node]!, 12)
    fracture.reset()
    expect(fracture.nodeMasses).toEqual(originalMasses)
  })

  it('rejects invalid optional mass references before creating fracture state', () => {
    const mesh = buildGummyJellyMesh()
    for (const massReferenceVolume of [0, -1, NaN, Infinity])
      expect(() =>
        createGummyJellyFracture({ ...mesh, massReferenceVolume }),
      ).toThrow('Invalid runtime jelly rest data')
  })
})
