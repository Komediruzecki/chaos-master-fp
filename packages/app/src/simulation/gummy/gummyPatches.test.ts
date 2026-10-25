/** Seam patch topology, area weighting, and actual GPU failure completion invariants. */
import { tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { buildGummyBearMesh } from './gummyMesh'
import { gummyCompletePatches, gummyPatchShouldRelease, prepareGummyPatches, } from './gummyPatches'

describe('predefined cohesive patch failure', () => {
  it('joins shared edges on either side while keeping remote patches of the same region pair separate', () => {
    const points = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [10, 0, 0],
      [11, 0, 0],
      [10, 1, 0],
    ]
    const positions = new Float32Array(
      [...points, ...points].flatMap((p) => [...p, 1]),
    )
    const nodeRegions = new Uint32Array([
      ...points.map(() => 5),
      ...points.map(() => 9),
    ])
    const interfaces = new Uint32Array([
      0, 7, 1, 8, 2, 9, 0, 0, 8, 1, 10, 3, 9, 2, 0, 0, 4, 11, 5, 12, 6, 13, 0,
      0,
    ])
    const result = prepareGummyPatches({ positions, interfaces, nodeRegions })
    const headers = new Uint32Array(result.patches),
      area = new Float32Array(result.patches)
    expect(result.count).toBe(2)
    expect([headers[1], headers[5]]).toEqual([2, 1])
    expect([area[2], area[6]]).toEqual([1, 0.5])
    expect(
      Array.from(new Uint32Array(result.faces)).filter(
        (_, index) => index % 2 === 0,
      ),
    ).toEqual([0, 1, 2])
    expect(Array.from(interfaces.slice(6, 8))).toEqual([0, 0])
  })

  it('a tiny residual face is weighted by area, not triangle count, and intact patches never release', () => {
    expect(gummyPatchShouldRelease(0, 1)).toBe(false)
    expect(gummyPatchShouldRelease(0.69, 1)).toBe(false)
    expect(gummyPatchShouldRelease(0.71, 1)).toBe(true)
    expect(gummyPatchShouldRelease(1, 1.001)).toBe(true)
    expect(gummyPatchShouldRelease(0.001, 1.001)).toBe(false)
    expect(gummyPatchShouldRelease(0, 0)).toBe(false)
  })

  it('covers every fine interface exactly once and retains disconnected region-pair surfaces', () => {
    const mesh = buildGummyBearMesh({ fracture: 'fine', pinnedFeet: false })
    const result = prepareGummyPatches(mesh)
    const ids = Array.from(new Uint32Array(result.faces)).filter(
      (_, index) => index % 2 === 0,
    )
    expect(ids.length).toBe(mesh.interfaces.length / 8)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.max(...ids)).toBe(ids.length - 1)
    const pairs = new Set<string>()
    for (let face = 0; face < mesh.interfaces.length; face += 8) {
      const a = mesh.nodeRegions[mesh.interfaces[face]!]!,
        b = mesh.nodeRegions[mesh.interfaces[face + 1]!]!
      pairs.add(`${Math.min(a, b)}:${Math.max(a, b)}`)
    }
    expect(result.count).toBeGreaterThan(pairs.size)
    const patchAreas = Array.from(new Float32Array(result.patches)).filter(
      (_, index) => index % 4 === 2,
    )
    expect(patchAreas.every((area) => area > 0 && Number.isFinite(area))).toBe(
      true,
    )
    const rotated = new Float32Array(mesh.positions)
    for (let offset = 0; offset < rotated.length; offset += 4) {
      rotated[offset + 1] = mesh.positions[offset + 2]! + 0.36
      rotated[offset + 2] = 1.265 - mesh.positions[offset + 1]!
    }
    const rotatedAreas = new Float32Array(
      prepareGummyPatches({ ...mesh, positions: rotated }).patches,
    )
    for (let patch = 0; patch < result.count; patch++)
      expect(rotatedAreas[patch * 4 + 2]).toBeCloseTo(patchAreas[patch]!, 6)
  })

  it('does not fabricate patch metadata for legacy meshes', () => {
    expect(
      prepareGummyPatches({
        positions: new Float32Array(),
        interfaces: new Uint32Array(),
      }).count,
    ).toBe(0)
  })

  it('resolves the actual race-free patch kernel without float atomics', () => {
    const code = tgpu.resolve([gummyCompletePatches], { names: 'strict' })
    // Integer inference would cast every subunit face area to zero and disable completion.
    expect(code).toContain('var failed = 0f;')
    expect(code).toContain('@compute @workgroup_size(64)')
    expect(code).not.toContain('atomic')
  })
})
