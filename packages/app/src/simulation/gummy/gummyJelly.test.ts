/** Continuum patch tests and actual shader resolution for the independent Neo-Hookean jelly mode. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyJellyMaterial, prepareGummyJellyTets } from './gummyJelly'
import { gummyJellyStrain, gummySolveJellyTets, solveGummyJellyTet, } from './gummyJellyShaders'

const gradients = [
  d.vec3f(1, 0, 0),
  d.vec3f(0, 1, 0),
  d.vec3f(0, 0, 1),
] as const
const rest = [
  d.vec4f(0, 0, 0, 1),
  d.vec4f(1, 0, 0, 1),
  d.vec4f(0, 1, 0, 1),
  d.vec4f(0, 0, 1, 1),
]
const strain = (p: readonly d.v4f[]) =>
  gummyJellyStrain(p[0]!.xyz, p[1]!.xyz, p[2]!.xyz, p[3]!.xyz, ...gradients)
const project = (
  p: readonly d.v4f[],
  lambda = d.vec2f(),
  shear = 0.2,
  bulk = shear / 800,
) =>
  solveGummyJellyTet(
    p[0]!,
    p[1]!,
    p[2]!,
    p[3]!,
    ...gradients,
    lambda,
    shear,
    bulk,
  )
const points = (result: ReturnType<typeof project>) => [
  result.p0,
  result.p1,
  result.p2,
  result.p3,
]
const energy = (p: readonly d.v4f[]) => {
  const state = strain(p)
  return (state.shear ** 2 - 3) / 2 + 400 * (state.volume - 1 - 1 / 800) ** 2
}

describe('continuous Neo-Hookean jelly', () => {
  it('prepares shape gradients from a rotated, translated, non-unit rest tetrahedron', () => {
    const transformed = rest.map((p) =>
      d.vec4f(4 - p.y * 3, 7 + p.x * 2, -2 + p.z * 4, p.w),
    )
    const data = prepareGummyJellyTets({
      positions: new Float32Array(transformed.flatMap((p) => [...p])),
      tetrahedra: new Uint32Array([0, 1, 2, 3]),
      interfaces: new Uint32Array(),
    })
    expect([...new Uint32Array(data.buffer).slice(0, 4)]).toEqual([0, 1, 2, 3])
    for (let axis = 0; axis < 3; axis++)
      expect(data[4 + axis]).toBeCloseTo([0, 0.5, 0][axis]!, 6)
    expect(data[8]).toBeCloseTo(-1 / 3, 6)
    expect(data[14]).toBe(0.25)
    expect(data[7]).toBe(4)
    const s = gummyJellyStrain(
      transformed[0]!.xyz,
      transformed[1]!.xyz,
      transformed[2]!.xyz,
      transformed[3]!.xyz,
      d.vec3f(data[4]!, data[5]!, data[6]!),
      d.vec3f(data[8]!, data[9]!, data[10]!),
      d.vec3f(data[12]!, data[13]!, data[14]!),
    )
    expect(s.shear).toBeCloseTo(Math.sqrt(3), 6)
    expect(s.volume).toBeCloseTo(1, 6)
  })

  it('preserves rotated rest poses by balancing shear prestress with pressure in the same projection', () => {
    const transformed = rest.map((p) =>
      d.vec4f(4 - p.y, 7 + p.x, -2 + p.z, p.w),
    )
    let p = transformed
    let lambda = d.vec2f()
    for (let i = 0; i < 30; i++) {
      const result = project(p, lambda)
      p = points(result)
      lambda = result.lambda
    }
    for (let i = 0; i < 4; i++)
      for (let axis = 0; axis < 3; axis++)
        expect(p[i]![axis]).toBeCloseTo(transformed[i]![axis]!, 5)
  })

  it('has signed determinant and Frobenius gradients matching finite differences under shear', () => {
    const p = rest.map((v) =>
      d.vec4f(1.3 * v.x + 0.4 * v.y, 0.8 * v.y + 0.2 * v.z, 1.1 * v.z, v.w),
    )
    const analytic = strain(p)
    const gs = [analytic.s0, analytic.s1, analytic.s2, analytic.s3]
    const gh = [analytic.h0, analytic.h1, analytic.h2, analytic.h3]
    const epsilon = 0.0005
    for (let node = 0; node < 4; node++)
      for (let axis = 0; axis < 3; axis++) {
        const before = p.map((v) => d.vec4f(v)),
          after = p.map((v) => d.vec4f(v))
        before[node]![axis]! -= epsilon
        after[node]![axis]! += epsilon
        const a = strain(before),
          b = strain(after)
        expect((b.shear - a.shear) / (2 * epsilon)).toBeCloseTo(
          gs[node]![axis]!,
          3,
        )
        expect((b.volume - a.volume) / (2 * epsilon)).toBeCloseTo(
          gh[node]![axis]!,
          3,
        )
      }
  })

  it('reduces large strain energy, preserves centre of mass and honours fixed nodes', () => {
    const input = rest.map((p) =>
      d.vec4f(p.x * 1.8 + p.y * 0.3, p.y * 0.6, p.z * 0.8, p.w),
    )
    let p = input,
      lambda = d.vec2f()
    for (let i = 0; i < 30; i++) {
      const result = project(p, lambda)
      p = points(result)
      lambda = result.lambda
    }
    expect(energy(p)).toBeLessThan(energy(input) * 0.2)
    expect(strain(p).volume).toBeCloseTo(1, 2)
    for (let axis = 0; axis < 3; axis++)
      expect(p.reduce((sum, v) => sum + v[axis]!, 0)).toBeCloseTo(
        input.reduce((sum, v) => sum + v[axis]!, 0),
        5,
      )
    const pinned = input.map((v, i) => d.vec4f(v.xyz, i === 0 ? 0 : 1))
    expect([...project(pinned).p0]).toEqual([...pinned[0]!])
  })

  it('remains finite and recovers positive orientation from a moderately inverted state', () => {
    let p = rest.map((v) => d.vec4f(v.x, v.y, -v.z * 0.25, v.w))
    let lambda = d.vec2f()
    for (let i = 0; i < 40; i++) {
      const result = project(p, lambda)
      p = points(result)
      lambda = result.lambda
      expect(p.flatMap((v) => [...v]).every(Number.isFinite)).toBe(true)
    }
    expect(strain(p).volume).toBeCloseTo(1, 2)
  })

  it('bounds softness without changing the bulk-to-shear stiffness ratio', () => {
    expect(gummyJellyMaterial(NaN)).toEqual(gummyJellyMaterial(0.5))
    expect(gummyJellyMaterial(-1)).toEqual(gummyJellyMaterial(0))
    expect(gummyJellyMaterial(2)).toEqual(gummyJellyMaterial(1))
    expect(gummyJellyMaterial(0).shearModulus).toBe(780000)
    expect(gummyJellyMaterial(1).shearModulus).toBe(93600)
    expect(
      gummyJellyMaterial(0.55).bulkModulus /
        gummyJellyMaterial(0.55).shearModulus,
    ).toBe(800)
  })

  it('resolves the actual continuum kernel without floating point atomics', () => {
    const code = tgpu.resolve([gummySolveJellyTets], { names: 'strict' })
    expect(code).toContain('@compute @workgroup_size(64)')
    expect(code).not.toContain('atomicAdd')
  })
})
