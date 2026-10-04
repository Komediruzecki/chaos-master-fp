/** Frame invariance, compressive exclusion, mixed-mode tension and clipped-cell conditioning. */
import { describe, expect, it } from 'vitest'
import { createGummyTensileWorkspace, evaluateGummyTensileStrain, gummyMixedTensileOpening, gummyNormalTensileOpening, gummyPositiveTensileStrain, prepareGummyFractureStrain, } from './gummyJellyFractureStrain'
import { buildGummyBearMesh } from './gummyMesh'

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]

it('normal tensile opening favors separating planes and does not count transverse traction as opening', () => {
  const tensor = [3, 0, 0, 0, 0, 0]
  expect(gummyNormalTensileOpening(tensor, [1, 0, 0])).toBe(2)
  expect(gummyNormalTensileOpening(tensor, [0, 1, 0])).toBe(1)
  expect(gummyNormalTensileOpening(tensor, [1, 1, 0])).toBeCloseTo(
    Math.sqrt(2.5),
    12,
  )
  expect(gummyNormalTensileOpening(tensor, [4, 4, 0])).toBeCloseTo(
    Math.sqrt(2.5),
    12,
  )
  expect(gummyMixedTensileOpening(tensor, [1, 1, 0])).toBeGreaterThan(
    gummyNormalTensileOpening(tensor, [1, 1, 0]),
  )
})
const multiply = (a: number[], b: number[]) =>
  Array.from({ length: 9 }, (_, i) =>
    [0, 1, 2].reduce(
      (s, k) => s + a[Math.floor(i / 3) * 3 + k]! * b[k * 3 + (i % 3)]!,
      0,
    ),
  )
const rotate = (a: number[], v: number[]) =>
  [0, 1, 2].map((i) => v.reduce((s, x, j) => s + a[i * 3 + j]! * x, 0))
const rotation = multiply(
  [
    Math.cos(0.63),
    0,
    Math.sin(0.63),
    0,
    1,
    0,
    -Math.sin(0.63),
    0,
    Math.cos(0.63),
  ],
  [
    Math.cos(0.37),
    -Math.sin(0.37),
    0,
    Math.sin(0.37),
    Math.cos(0.37),
    0,
    0,
    0,
    1,
  ],
)

describe('mixed tensile fracture strain', () => {
  it('gives zero drive for rest, arbitrary rigid rotation and all-compressive stretches', () => {
    for (const f of [
      identity,
      rotation,
      [0.5, 0, 0, 0, 0.8, 0, 0, 0, 1],
      multiply(rotation, [0.5, 0, 0, 0, 0.7, 0, 0, 0, 0.9]),
    ]) {
      for (const value of gummyPositiveTensileStrain(f))
        expect(value).toBeCloseTo(0, 12)
    }
  })
  it('reconstructs principal tensile stretch while discarding compressed eigendirections', () => {
    const tensor = gummyPositiveTensileStrain([2, 0, 0, 0, 0.7, 0, 0, 0, 0.8])
    expect(Array.from(tensor)).toEqual([3, 0, 0, 0, 0, 0])
    expect(gummyMixedTensileOpening(tensor, [1, 0, 0])).toBe(2)
    expect(gummyMixedTensileOpening(tensor, [0, 1, 0])).toBe(1)
  })
  it('includes shear on an oblique facet under incompressible tension despite contracted normal thickness', () => {
    const stretch = 1.7,
      f = [
        stretch,
        0,
        0,
        0,
        1 / Math.sqrt(stretch),
        0,
        0,
        0,
        1 / Math.sqrt(stretch),
      ]
    const currentNormal = [1 / stretch, 0, Math.sqrt(stretch)]
    const normalThickness = Math.sqrt(2) / Math.hypot(...currentNormal)
    expect(normalThickness).toBeLessThan(1)
    expect(
      gummyMixedTensileOpening(gummyPositiveTensileStrain(f), currentNormal),
    ).toBeGreaterThan(1.3)
  })
  it('is objective under world rotation of a sheared body and its fracture normal', () => {
    const f = [1.8, 0.4, 0.2, 0, 0.8, 0.3, 0, 0, 0.7],
      n = [0.7, 0.2, -0.4]
    const initial = gummyMixedTensileOpening(gummyPositiveTensileStrain(f), n)
    const rotated = gummyMixedTensileOpening(
      gummyPositiveTensileStrain(multiply(rotation, f)),
      rotate(rotation, n),
    )
    expect(rotated).toBeCloseTo(initial, 11)
  })
  it('regularizes tensile extension before squaring, limiting sliver amplification', () => {
    const f = [1, 0, 0, 0, 1, 0, 0, 0, 1001]
    expect(
      gummyMixedTensileOpening(
        gummyPositiveTensileStrain(f, 0.0001),
        [0, 0, 1],
      ),
    ).toBeCloseTo(1.1, 12)
    expect(
      gummyMixedTensileOpening(gummyPositiveTensileStrain(f, 0), [0, 0, 1]),
    ).toBe(1)
  })
  it('reconstructs a real clipped bear rest pose without strain, including its tiny boundary tets', () => {
    const mesh = buildGummyBearMesh({ fracture: 'none', spacing: 0.14 })
    const geometry = prepareGummyFractureStrain(mesh, 0.25)
    expect(Math.min(...geometry.regularization)).toBeLessThan(0.01)
    const strain = evaluateGummyTensileStrain(
      mesh.positions,
      mesh.tetrahedra,
      geometry,
    )
    expect(Math.max(...strain.map(Math.abs))).toBeLessThan(1e-9)
    const rotated = new Float32Array(mesh.positions)
    for (let i = 0; i < rotated.length; i += 4)
      rotated.set(
        rotate(rotation, Array.from(mesh.positions.slice(i, i + 3))).map(
          (x, j) => x + [3, -2, 1][j]!,
        ),
        i,
      )
    const transformed = evaluateGummyTensileStrain(
      rotated,
      mesh.tetrahedra,
      geometry,
    )
    expect(Math.max(...transformed.map(Math.abs))).toBeLessThan(0.0002)
  })
  it('reuses scratch without stale values and matches independent outputs exactly across poses', () => {
    const mesh = buildGummyBearMesh({ fracture: 'none' })
    const geometry = prepareGummyFractureStrain(mesh, 0.25)
    const scratch = createGummyTensileWorkspace(mesh.tetrahedra.length / 4)
    const stretched = new Float32Array(mesh.positions)
    for (let i = 0; i < stretched.length; i += 4) {
      stretched[i]! *= 1.7
      stretched[i + 1]! *= 0.8
      stretched[i + 2]! += 0.2 * stretched[i]!
    }
    for (const positions of [stretched, mesh.positions, stretched]) {
      const independent = evaluateGummyTensileStrain(
        positions,
        mesh.tetrahedra,
        geometry,
      )
      const reused = evaluateGummyTensileStrain(
        positions,
        mesh.tetrahedra,
        geometry,
        scratch,
      )
      expect(reused).toBe(scratch.output)
      expect(reused).not.toBe(independent)
      expect(reused).toEqual(independent)
    }
    expect(() =>
      evaluateGummyTensileStrain(
        mesh.positions,
        mesh.tetrahedra,
        geometry,
        createGummyTensileWorkspace(1),
      ),
    ).toThrow(/workspace/)
  })
})
