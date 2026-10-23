/** Geometric validity of the solid and every independently exposed tear region. */
import { describe, expect, it } from 'vitest'
import { buildGummyBearMesh, EXTERIOR_FACE, tetrahedronVolume, } from './gummyMesh'
import { analyzeGummyFragments, isManifoldGummyBoundary, } from './gummyPartition'
import type { GummyVec3 } from './gummyMesh'

const mesh = buildGummyBearMesh()
const point = (id: number): GummyVec3 => [
  mesh.positions[id * 4]!,
  mesh.positions[id * 4 + 1]!,
  mesh.positions[id * 4 + 2]!,
]

describe('gummy solid', () => {
  it('fills a bear with positively oriented tetrahedra and finite lumped masses', () => {
    let volume = 0
    for (let i = 0; i < mesh.tetrahedra.length; i += 4) {
      const v = tetrahedronVolume(
        point(mesh.tetrahedra[i]!),
        point(mesh.tetrahedra[i + 1]!),
        point(mesh.tetrahedra[i + 2]!),
        point(mesh.tetrahedra[i + 3]!),
      )
      expect(v).toBeGreaterThan(0)
      volume += v
    }
    expect(volume).toBeCloseTo(mesh.restVolume, 6)
    expect(volume).toBeGreaterThan(1)
    expect(volume).toBeLessThan(1.4)
    expect([...mesh.positions].every(Number.isFinite)).toBe(true)
    expect(mesh.bounds.min[1]).toBe(0)
    expect(mesh.bounds.max[1]).toBeGreaterThan(2.5)
    const anchored = [...mesh.nodeRegions].filter(
      (_, i) => mesh.positions[i * 4 + 3]! === 0,
    )
    expect(anchored.length).toBeGreaterThan(0)
    expect(anchored.length).toBeLessThan(mesh.positions.length / 40)
  })

  it('keeps every separated component closed, with opposite edge winding', () => {
    const edges = new Map<string, { count: number; winding: number }>()
    for (let i = 0; i < mesh.surface.length; i += 4) {
      const face = [...mesh.surface.subarray(i, i + 3)]
      for (let k = 0; k < 3; k++) {
        const a = face[k]!,
          b = face[(k + 1) % 3]!
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        const edge = edges.get(key) ?? { count: 0, winding: 0 }
        edge.count++
        edge.winding += a < b ? 1 : -1
        edges.set(key, edge)
      }
    }
    expect(
      [...edges.values()].filter(
        (edge) => edge.count !== 2 || edge.winding !== 0,
      ),
    ).toEqual([])
  })

  it('exposes exactly two opposing faces per cohesive interface', () => {
    const usage = new Map<number, number>()
    for (let i = 3; i < mesh.surface.length; i += 4) {
      const faceId = mesh.surface[i]!
      if (faceId !== EXTERIOR_FACE)
        usage.set(faceId, (usage.get(faceId) ?? 0) + 1)
    }
    expect(usage.size).toBe(mesh.interfaces.length / 8)
    expect([...usage.values()].every((count) => count === 2)).toBe(true)
    for (let i = 0; i < mesh.interfaces.length; i += 8)
      for (let pair = 0; pair < 3; pair++) {
        const a = mesh.interfaces[i + pair * 2]!,
          b = mesh.interfaces[i + pair * 2 + 1]!
        expect(a).not.toBe(b)
        expect(point(a)).toEqual(point(b))
        expect(mesh.nodeRegions[a]).not.toBe(mesh.nodeRegions[b])
      }
  })

  it('has a boundary enclosing the same volume as the tetrahedra', () => {
    let volume = 0
    for (let i = 0; i < mesh.surface.length; i += 4)
      volume += tetrahedronVolume(
        [0, 0, 0],
        point(mesh.surface[i]!),
        point(mesh.surface[i + 1]!),
        point(mesh.surface[i + 2]!),
      )
    expect(volume).toBeCloseTo(mesh.restVolume, 6)
  })

  it('rejects unbounded or invalid meshing resolutions', () => {
    for (const spacing of [0, NaN, Infinity, 0.069, 0.31])
      expect(() => buildGummyBearMesh({ spacing })).toThrow(RangeError)
    for (const pinHeight of [-0.01, NaN, Infinity, 0.51])
      expect(() => buildGummyBearMesh({ pinHeight })).toThrow(RangeError)
  })

  it('fixes only the explicitly selected lower fixture and leaves old defaults intact', () => {
    const original = buildGummyBearMesh({ pinHeight: 0.065 })
    expect(original.positions).toEqual(mesh.positions)
    const fixture = buildGummyBearMesh({ fracture: 'none', pinHeight: 0.3 })
    const free = buildGummyBearMesh({
      fracture: 'none',
      pinHeight: 0.3,
      pinnedFeet: false,
    })
    let fixed = 0
    for (let i = 0; i < fixture.positions.length; i += 4) {
      expect(fixture.positions[i + 3] === 0).toBe(
        fixture.positions[i + 1]! < 0.3,
      )
      expect(free.positions[i + 3]).toBeGreaterThan(0)
      if (fixture.positions[i + 3] === 0) fixed++
    }
    expect(fixed).toBeGreaterThan(0)
    expect(fixture.tetrahedra).toEqual(free.tetrahedra)
  })

  it('preserves legacy limb geometry, including the numeric spacing shorthand', () => {
    const explicit = buildGummyBearMesh({ fracture: 'limbs' })
    const numeric = buildGummyBearMesh(0.14)
    expect(explicit.positions).toEqual(mesh.positions)
    expect(explicit.tetrahedra).toEqual(mesh.tetrahedra)
    expect(explicit.interfaces).toEqual(mesh.interfaces)
    expect(explicit.surface).toEqual(mesh.surface)
    expect(numeric.positions).toEqual(mesh.positions)
    expect(numeric.interfaces).toEqual(mesh.interfaces)
  })

  it('welds the continuous comparison into one closed solid with the exact original exterior', () => {
    const continuous = buildGummyBearMesh({
      fracture: 'none',
      pinnedFeet: false,
    })
    expect(continuous.interfaces.length).toBe(0)
    expect(new Set(continuous.nodeRegions)).toEqual(new Set([0]))
    expect(continuous.restVolume).toBe(mesh.restVolume)
    expect(continuous.tetrahedra.length).toBe(mesh.tetrahedra.length)
    const triangles = (solid: typeof mesh) => {
      const output: number[][] = []
      for (let i = 0; i < solid.surface.length; i += 4) {
        if (solid.surface[i + 3] !== EXTERIOR_FACE) continue
        output.push(
          [0, 1, 2].flatMap((corner) => {
            const node = solid.surface[i + corner]!
            return [...solid.positions.subarray(node * 4, node * 4 + 3)]
          }),
        )
      }
      return output
    }
    expect(triangles(continuous)).toEqual(triangles(mesh))
    const unique = new Set<string>()
    for (let i = 0; i < continuous.positions.length; i += 4) {
      unique.add([...continuous.positions.subarray(i, i + 3)].join(':'))
      expect(continuous.positions[i + 3]).toBeGreaterThan(0)
    }
    expect(unique.size).toBe(continuous.positions.length / 4)
    expect(
      analyzeGummyFragments(continuous, new Float32Array(0)).connectedParts,
    ).toBe(1)
    const faces: [number, number, number][] = []
    for (let i = 0; i < continuous.surface.length; i += 4)
      faces.push([
        continuous.surface[i]!,
        continuous.surface[i + 1]!,
        continuous.surface[i + 2]!,
      ])
    expect(isManifoldGummyBoundary(faces)).toBe(true)
  })
})

describe('fine volume fracture', () => {
  const fine = buildGummyBearMesh({ fracture: 'fine', pinnedFeet: false })
  const broken = new Float32Array(fine.interfaces.length / 8).fill(1)
  const analysis = analyzeGummyFragments(fine, broken)
  const exterior = (solid: typeof mesh) => {
    const triangles: number[][] = []
    for (let i = 0; i < solid.surface.length; i += 4) {
      if (solid.surface[i + 3] !== EXTERIOR_FACE) continue
      const triangle: number[] = []
      for (let corner = 0; corner < 3; corner++) {
        const id = solid.surface[i + corner]!
        triangle.push(...solid.positions.subarray(id * 4, id * 4 + 3))
      }
      triangles.push(triangle)
    }
    return triangles
  }

  it('retains the complete mould and all solid tetrahedra within a bounded fracture budget', () => {
    expect(fine.restVolume).toBe(mesh.restVolume)
    expect(fine.bounds).toEqual(mesh.bounds)
    expect(fine.tetrahedra.length).toBe(mesh.tetrahedra.length)
    expect(exterior(fine)).toEqual(exterior(mesh))
    expect(analysis.regionCount).toBe(116)
    expect(fine.positions.length / 4).toBe(4602)
    expect(fine.interfaces.length / 8).toBe(2568)
    expect([...fine.positions].every(Number.isFinite)).toBe(true)
    for (let i = 3; i < fine.positions.length; i += 4)
      expect(fine.positions[i]).toBeGreaterThan(0)
    const copy = buildGummyBearMesh({ fracture: 'fine', pinnedFeet: false })
    expect(copy.nodeRegions).toEqual(fine.nodeRegions)
    expect(copy.interfaces).toEqual(fine.interfaces)
  })

  it('creates connected small fragments with positive, conserved rest volumes and no clipped grains', () => {
    expect(analyzeGummyFragments(fine).connectedParts).toBe(1)
    expect(analysis.connectedParts).toBe(analysis.regionCount)
    expect(analysis.largestComponentVolumeFraction).toBeCloseTo(0.034395599, 8)
    expect(
      analysis.components.reduce((sum, part) => sum + part.restVolume, 0),
    ).toBeCloseTo(fine.restVolume, 6)
    expect(
      analysis.components.reduce((sum, part) => sum + part.tetrahedronCount, 0),
    ).toBe(fine.tetrahedra.length / 4)
    for (const component of analysis.components) {
      expect(component.regions).toHaveLength(1)
      expect(component.restVolume).toBeGreaterThan(0.0008)
    }
  })

  it('keeps every fully exposed fragment manifold at edges and vertices, with opposing edge winding', () => {
    const faces: [number, number, number][] = []
    const edges = new Map<string, number>()
    const usage = new Uint32Array(fine.interfaces.length / 8)
    for (let i = 0; i < fine.surface.length; i += 4) {
      const face: [number, number, number] = [
        fine.surface[i]!,
        fine.surface[i + 1]!,
        fine.surface[i + 2]!,
      ]
      faces.push(face)
      const interfaceId = fine.surface[i + 3]!
      if (interfaceId !== EXTERIOR_FACE) usage[interfaceId]!++
      for (let corner = 0; corner < 3; corner++) {
        const a = face[corner]!,
          b = face[(corner + 1) % 3]!
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1))
      }
    }
    expect(isManifoldGummyBoundary(faces)).toBe(true)
    expect([...edges.values()].every((winding) => winding === 0)).toBe(true)
    expect([...usage].every((count) => count === 2)).toBe(true)
    for (let i = 0; i < fine.interfaces.length; i += 8)
      for (let pair = 0; pair < 3; pair++) {
        const a = fine.interfaces[i + pair * 2]!,
          b = fine.interfaces[i + pair * 2 + 1]!
        expect([...fine.positions.subarray(a * 4, a * 4 + 3)]).toEqual([
          ...fine.positions.subarray(b * 4, b * 4 + 3),
        ])
        expect(fine.nodeRegions[a]).not.toBe(fine.nodeRegions[b])
      }
  })

  it('counts partial damage as connected and one surviving interface joins exactly its two regions', () => {
    expect(
      analyzeGummyFragments(fine, new Float32Array(broken.length).fill(0.999))
        .connectedParts,
    ).toBe(1)
    const damage = broken.slice()
    damage[0] = 0.5
    const connected = analyzeGummyFragments(fine, damage)
    expect(connected.connectedParts).toBe(115)
    const a = fine.nodeRegions[fine.interfaces[0]!]!,
      b = fine.nodeRegions[fine.interfaces[1]!]!
    const joined = connected.components.find(
      (part) => part.regions.length === 2,
    )!
    expect(joined.regions).toEqual([a, b].sort((left, right) => left - right))
    const expectedVolume = analysis.components
      .filter((part) => part.regions[0] === a || part.regions[0] === b)
      .reduce((sum, part) => sum + part.restVolume, 0)
    expect(joined.restVolume).toBeCloseTo(expectedVolume, 10)
  })

  it.each([0.11, 0.18])(
    'keeps the partition closed and face-connected at spacing %s',
    (spacing) => {
      const solid = buildGummyBearMesh({ fracture: 'fine', spacing })
      const triangles: [number, number, number][] = []
      for (let i = 0; i < solid.surface.length; i += 4)
        triangles.push([
          solid.surface[i]!,
          solid.surface[i + 1]!,
          solid.surface[i + 2]!,
        ])
      const split = analyzeGummyFragments(
        solid,
        new Float32Array(solid.interfaces.length / 8).fill(1),
      )
      expect(isManifoldGummyBoundary(triangles)).toBe(true)
      expect(analyzeGummyFragments(solid).connectedParts).toBe(1)
      expect(split.connectedParts).toBe(split.regionCount)
      expect(split.regionCount).toBeGreaterThanOrEqual(50)
      expect(split.regionCount).toBeLessThanOrEqual(150)
    },
  )
})
