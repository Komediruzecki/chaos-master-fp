/** Contact preparation and the actual native GPU projection obey mass, connectivity and hash contracts. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyContactComponents, gummyContactGather, gummyContactInsert, gummyContactReset, gummyProxyCorrection, prepareGummyContacts, } from './gummyContacts'

describe('gummy fragment contact', () => {
  it('remaps sparse region IDs and stores exact face connectivity without changing the mesh', () => {
    const source = new Uint32Array([0, 4, 1, 5, 2, 6, 0, 0])
    const positions = new Float32Array([
      0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, -1, 1, 0, 0, 0, 1, 1, 0, 0, 1,
      0, 1, 0, 1, 0, 0, 1, 1,
    ])
    const data = prepareGummyContacts({
      positions,
      interfaces: source,
      nodeRegions: new Uint32Array([100, 100, 100, 100, 900, 900, 900, 900]),
      spacing: 0.14,
    })
    expect(data.regionCount).toBe(2)
    expect(Array.from(data.interfaces)).toEqual([0, 4, 1, 5, 2, 6, 0, 1])
    expect(Array.from(source)).toEqual([0, 4, 1, 5, 2, 6, 0, 0])
    expect(Array.from(data.metadata.subarray(0, 4))).toEqual([
      0.25, 0.25, -0.25, 0,
    ])
    expect(Array.from(data.metadata.subarray(16, 20))).toEqual([
      0.25, 0.25, 0.25, 1,
    ])
    expect(data.separation).toBeCloseTo(0.028, 12)
    expect(() =>
      prepareGummyContacts({
        positions,
        interfaces: source,
        nodeRegions: new Uint32Array(2),
      }),
    ).toThrow('match node')
  })

  it('a separated pair resolves overlap with equal and opposite mass-weighted movement', () => {
    const a = d.vec4f(0, 0, 0, 1),
      b = d.vec4f(0.01, 0, 0, 3)
    const qa = gummyProxyCorrection(
      a,
      b,
      d.vec3f(-1, 0, 0),
      d.vec3f(1, 0, 0),
      0.028,
    )
    const qb = gummyProxyCorrection(
      b,
      a,
      d.vec3f(1, 0, 0),
      d.vec3f(-1, 0, 0),
      0.028,
    )
    expect(qa.x).toBeLessThan(0)
    expect(qb.x).toBeGreaterThan(0)
    expect(qa.x / a.w + qb.x / b.w).toBeCloseTo(0, 8)
    expect(b.x + qb.x - (a.x + qa.x)).toBeCloseTo(0.028, 8)
    expect(
      std.length(
        gummyProxyCorrection(a, d.vec4f(1, 0, 0, 1), a.xyz, b.xyz, 0.028),
      ),
    ).toBe(0)
  })

  it('coincident fracture vertices use opposing region-centre directions and pinned nodes remain fixed', () => {
    const a = d.vec4f(0, 0, 0, 1),
      b = d.vec4f(0, 0, 0, 1)
    const ca = d.vec3f(0, 0, -1),
      cb = d.vec3f(0, 0, 1)
    const qa = gummyProxyCorrection(a, b, ca, cb, 0.028)
    const qb = gummyProxyCorrection(b, a, cb, ca, 0.028)
    expect(qa.z).toBeCloseTo(-0.014, 8)
    expect(qb.z).toBeCloseTo(0.014, 8)
    expect(
      std.length(gummyProxyCorrection(d.vec4f(0, 0, 0, 0), b, ca, cb, 0.028)),
    ).toBe(0)
    expect(std.length(gummyProxyCorrection(a, b, ca, ca, 0.028))).toBe(0)
  })

  it.each([
    gummyContactReset,
    gummyContactComponents,
    gummyContactInsert,
    gummyContactGather,
  ])('resolves race-free contact kernel %s', (kernel) => {
    const code = tgpu.resolve([kernel], { names: 'strict' })
    expect(code).toContain('@compute @workgroup_size(64)')
    expect(code).not.toContain('atomic<f32>')
    expect(code).not.toContain('atomicAdd')
  })
})
