/** Contact respects geometric separation, swept motion, momentum balance and bounded friction. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyPairContactImpulse, gummyPairSweptContact, } from './gummyParticlePairMath'
import { gummyParticlePairContact, gummyParticlePairProximity, } from './gummyParticlePairShaders'

describe('two-body gummy contact', () => {
  it('does not couple overlapping grid supports while actual material remains separated', () => {
    const contact = gummyPairSweptContact(
      d.vec3f(0.25, 0, 0),
      d.vec3f(-2, 0, 0),
      0.08,
      0.0003,
    )
    expect(contact.w).toBeGreaterThan(0.16)
    expect([
      ...gummyPairContactImpulse(
        d.vec3f(0),
        d.vec3f(-2, 0, 0),
        1,
        1,
        contact.xyz,
        contact.w,
        0.45,
      ),
    ]).toEqual([0, 0, 0])
  })

  it('detects contact reached within the step and leaves a separating touch unconstrained', () => {
    const contact = gummyPairSweptContact(
      d.vec3f(0.081, 0, 0),
      d.vec3f(-4, 0, 0),
      0.08,
      0.0003,
    )
    expect(contact.w).toBeLessThan(0)
    expect([...contact.xyz]).toEqual([1, 0, 0])
    expect(
      gummyPairContactImpulse(
        d.vec3f(0),
        d.vec3f(-4, 0, 0),
        1,
        1,
        contact.xyz,
        contact.w,
        0,
      ).x,
    ).toBe(2)
    expect([
      ...gummyPairContactImpulse(
        d.vec3f(-1, 0, 0),
        d.vec3f(1, 0, 0),
        1,
        1,
        contact.xyz,
        -0.01,
        1,
      ),
    ]).toEqual([0, 0, 0])
  })

  it.each([0, 0.2, 0.45, 1])(
    'conserves linear momentum and dissipates energy with friction %s',
    (friction) => {
      const massA = 0.37,
        massB = 0.91
      const a = d.vec3f(2, 0.6, -0.3),
        b = d.vec3f(-1, -0.4, 0.2)
      const impulse = gummyPairContactImpulse(
        a,
        b,
        1 / massA,
        1 / massB,
        d.vec3f(1, 0, 0),
        0,
        friction,
      )
      const nextA = std.sub(a, std.div(impulse, massA)),
        nextB = std.add(b, std.div(impulse, massB))
      const before = std.add(std.mul(a, massA), std.mul(b, massB))
      const after = std.add(std.mul(nextA, massA), std.mul(nextB, massB))
      expect(std.length(std.sub(after, before))).toBeLessThan(1e-6)
      expect(nextB.x - nextA.x).toBeCloseTo(0, 6)
      const kinetic = (vA: d.v3f, vB: d.v3f) =>
        massA * std.dot(vA, vA) + massB * std.dot(vB, vB)
      expect(kinetic(nextA, nextB)).toBeLessThan(kinetic(a, b))
      expect(Math.hypot(impulse.y, impulse.z)).toBeLessThanOrEqual(
        friction * impulse.x + 1e-6,
      )
    },
  )

  it('supports fixed base nodes and fully coincident particles without non-finite values', () => {
    const contact = gummyPairSweptContact(d.vec3f(0), d.vec3f(0), 0.08, 0.0003)
    expect([...contact].every(Number.isFinite)).toBe(true)
    const impulse = gummyPairContactImpulse(
      d.vec3f(0),
      d.vec3f(0, -2, 0),
      0,
      2,
      contact.xyz,
      contact.w,
      0.45,
    )
    expect([...impulse]).toEqual([0, 1, 0])
    expect([
      ...gummyPairContactImpulse(
        d.vec3f(0),
        d.vec3f(0, -2, 0),
        0,
        0,
        contact.xyz,
        contact.w,
        1,
      ),
    ]).toEqual([0, 0, 0])
  })

  it('emits both production kernels within the baseline eight-storage-binding limit', () => {
    for (const shader of [
      gummyParticlePairProximity,
      gummyParticlePairContact,
    ]) {
      const wgsl = tgpu.resolve([shader], { names: 'strict' })
      expect(wgsl).toContain('@compute')
      expect([...wgsl.matchAll(/var<storage,/g)].length).toBeLessThanOrEqual(8)
      expect(wgsl).not.toContain('atomic<f32>')
    }
  })
})
