/** Material-memory regressions: yielding is objective, dissipative and isochoric, and survives node cloning. */
import { describe, expect, it } from 'vitest'
import { prepareGummyJellyTets } from './gummyJelly'
import { createGummyJellyPlasticity, gummyJellyPlasticMaterial, } from './gummyJellyPlasticity'

const mesh = () => ({
  positions: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
  tetrahedra: new Uint32Array([0, 1, 2, 3]),
  interfaces: new Uint32Array(),
  spacing: 1,
})
const transform = (fn: (x: number, y: number, z: number) => number[]) => {
  const p = mesh().positions
  for (let i = 0; i < p.length; i += 4)
    p.set(fn(p[i]!, p[i + 1]!, p[i + 2]!), i)
  return p
}
const det = (m: Float32Array) =>
  m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
  m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
  m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
const options = { softness: 0.55, fragility: 0.88 }

describe('finite-strain gummy plasticity', () => {
  it('does not let a highly sheared small neighbour turn an otherwise elastic patch plastic', () => {
    const solid = {
      positions: new Float32Array([
        0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1, 0.1, 0, 1,
        1, 0, 0.1, 1, 1, 0, 0, 1.01, 1,
      ]),
      tetrahedra: new Uint32Array([0, 1, 2, 3, 0, 2, 1, 4, 3, 5, 6, 7]),
      interfaces: new Uint32Array(),
      spacing: 1,
    }
    // Two equal large cells share a face. The upper cell stretches by 1.37;
    // the lower one stays at rest. Its Hencky patch norm is analytically
    // sqrt(5/8) * sqrt(2/3) * log(1.37) = .20321, below the .216 yield.
    const disturbed = solid.positions.slice()
    for (const node of [3, 5, 6, 7]) disturbed[node * 4 + 2]! += 0.37
    // This cell is 1/10000 of a large cell's volume and touches its tip.
    // Severe isochoric shear raises the old Frobenius-based patch above
    // yield, but the consistent logarithmic patch remains below .204.
    disturbed[7 * 4] = 4
    const flow = createGummyJellyPlasticity(solid)
    const result = flow.update(disturbed, 0.05, options)
    expect(result.equivalentPlasticStrain[0]).toBe(0)
    expect(result.equivalentPlasticStrain[1]).toBe(0)

    // The same honest affine strain across the whole patch must still yield
    // both large cells; this correction must not raise the material threshold.
    const affine = solid.positions.slice()
    for (let i = 2; i < affine.length; i += 4) affine[i]! *= 1.37
    const coherent = createGummyJellyPlasticity(solid).update(
      affine,
      0.05,
      options,
    )
    expect(coherent.equivalentPlasticStrain[0]).toBeGreaterThan(0.01)
    expect(coherent.equivalentPlasticStrain[1]).toBeGreaterThan(0.01)
  })

  it('keeps rest, rigid motion, uniform dilation and sub-yield deformation elastic', () => {
    for (const p of [
      mesh().positions,
      transform((x, y, z) => [4 - y, 7 + x, z - 2]),
      transform((x, y, z) => [1.1 * x, 1.1 * y, 1.1 * z]),
      transform((x, y, z) => [1.1 * x, y / Math.sqrt(1.1), z / Math.sqrt(1.1)]),
    ]) {
      const flow = createGummyJellyPlasticity(mesh()),
        before = flow.snapshot()
      for (let i = 0; i < 100; i++)
        expect(flow.update(p, 0.05, options).changedTets).toBe(0)
      expect(flow.snapshot()).toEqual(before)
    }
  })
  it('relaxes deviatoric strain with persistent isochoric memory instead of changing particle positions or mass', () => {
    const flow = createGummyJellyPlasticity(mesh())
    const positions = transform((x, y, z) => [
        1.8 * x,
        y / Math.sqrt(1.8),
        z / Math.sqrt(1.8),
      ]),
      original = positions.slice()
    const material = gummyJellyPlasticMaterial(options.softness)
    const first = flow.update(positions, 0.05, options)
    expect(first.changedTets).toBe(1)
    expect(first.maxPlasticStrain).toBeCloseTo(0.06, 6)
    expect(first.plasticIncrement[0]).toBe(
      first.state.equivalentPlasticStrain[0],
    )
    expect(first.state.gradients[0]).toBeLessThan(1)
    expect(first.state.gradients[4]).toBeGreaterThan(1)
    for (let i = 0; i < 200; i++) flow.update(positions, 0.05, options)
    const saved = flow.snapshot(),
      b = saved.gradients
    expect(det(b)).toBeCloseTo(1, 6)
    expect(flow.update(positions, 0, options).plasticIncrement[0]).toBe(0)
    expect(positions).toEqual(original)
    const elasticLogs = [
      Math.log(1.8 * b[0]!),
      Math.log(b[4]! / Math.sqrt(1.8)),
      Math.log(b[8]! / Math.sqrt(1.8)),
    ]
    expect(Math.hypot(...elasticLogs)).toBeCloseTo(
      material.yieldStrain +
        material.hardening * saved.equivalentPlasticStrain[0]!,
      5,
    )
    // A fresh controller can restore material history without resetting its stress-free frame.
    const copy = createGummyJellyPlasticity(mesh())
    copy.restore(saved)
    expect(copy.snapshot()).toEqual(saved)
    copy.restore()
    expect(copy.snapshot()).toEqual(
      createGummyJellyPlasticity(mesh()).snapshot(),
    )
  })
  it('is invariant under a superposed rotation and dissipates energy for non-diagonal shear', () => {
    const first = createGummyJellyPlasticity(mesh()),
      rotated = createGummyJellyPlasticity(mesh())
    const p = transform((x, y, z) => [x + 0.9 * y, y, z]),
      r = transform((x, y, z) => [-y, x + 0.9 * y, z])
    for (let i = 0; i < 10; i++) {
      first.update(p, 0.05, options)
      rotated.update(r, 0.05, options)
    }
    const a = first.snapshot(),
      b = rotated.snapshot()
    for (let i = 0; i < 9; i++)
      expect(a.gradients[i]).toBeCloseTo(b.gradients[i]!, 6)
    expect(a.equivalentPlasticStrain[0]).toBeCloseTo(
      b.equivalentPlasticStrain[0]!,
      6,
    )
    expect(det(a.gradients)).toBeCloseTo(1, 6)
    const g = a.gradients
    let frobenius = 0
    for (let col = 0; col < 3; col++)
      frobenius +=
        (g[col]! + 0.9 * g[3 + col]!) ** 2 + g[3 + col]! ** 2 + g[6 + col]! ** 2
    expect(frobenius).toBeLessThan(3.81)
  })
  it('rejects collapsed/inverted deformation and malformed memory without changing the old state', () => {
    const flow = createGummyJellyPlasticity(mesh()),
      before = flow.snapshot()
    for (const p of [
      transform((x, y, z) => [-x, y, z]),
      transform((x, y, z) => [x * 0.1, y, z]),
    ])
      expect(flow.update(p, 0.05, options).changedTets).toBe(0)
    expect(() => {
      flow.restore({ ...before, gradients: new Float32Array(9) })
    }).toThrow(/volume/)
    expect(() => {
      flow.restore({
        ...before,
        equivalentPlasticStrain: new Float32Array([NaN]),
      })
    }).toThrow(/snapshot/)
    expect(flow.snapshot()).toEqual(before)
    expect(() => flow.update(mesh().positions, -1, options)).toThrow(/update/)
  })
  it('writes only inverse frames and preserves tet IDs and original volume in GPU records', () => {
    const m = mesh(),
      flow = createGummyJellyPlasticity(m),
      packed = prepareGummyJellyTets(m),
      before = packed.slice()
    flow.update(
      transform((x, y, z) => [1.8 * x, y / Math.sqrt(1.8), z / Math.sqrt(1.8)]),
      0.05,
      options,
    )
    flow.writeTets(packed)
    expect(new Uint32Array(packed.buffer).slice(0, 4)).toEqual(
      new Uint32Array(before.buffer).slice(0, 4),
    )
    expect(packed[7]).toBe(before[7])
    expect(packed[11]).toBe(before[11])
    expect(packed[15]).toBe(before[15])
  })
})
