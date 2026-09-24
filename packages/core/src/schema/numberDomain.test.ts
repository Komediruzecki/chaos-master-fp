import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { pureClone } from '../utils/clone'
import { renderSettingsDefault, validateFlame } from './flameSchema'
import { flameDomainPlans, numberDomainOf, projectFlameToSchema, projectNumber, } from './numberDomain'
import type { DomainPlan, NumberDomain } from './numberDomain'

const whole = (min: number, max: number): NumberDomain => ({
  min,
  max,
  integer: true,
  cyclic: false,
})
const cyclic = (min: number, max: number): NumberDomain => ({
  min,
  max,
  integer: false,
  cyclic: true,
})

describe('numberDomainOf', () => {
  it('reads bounds, integer and the cyclic tag through optional wrappers', () => {
    expect(
      numberDomainOf(
        v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(30)),
        ),
      ),
    ).toEqual(whole(0, 30))
    expect(
      numberDomainOf(
        v.pipe(
          v.number(),
          v.minValue(0),
          v.maxValue(1),
          v.metadata({ cyclic: true }),
        ),
      ),
    ).toEqual(cyclic(0, 1))
  })

  it('declares no domain for a number that is only asked to be finite', () => {
    expect(numberDomainOf(v.number())).toBeUndefined()
    expect(numberDomainOf(v.pipe(v.number(), v.finite()))).toBeUndefined()
    expect(numberDomainOf(v.string())).toBeUndefined()
  })

  it('refuses a cyclic tag without both bounds, since nothing can wrap', () => {
    expect(() =>
      numberDomainOf(
        v.pipe(v.number(), v.minValue(0), v.metadata({ cyclic: true })),
      ),
    ).toThrow(/finite minimum and maximum/)
  })
})

describe('projectNumber', () => {
  it('floors a fraction, as the renderer consumed it, then clamps', () => {
    expect(projectNumber(17.666, whole(0, 30))).toBe(17)
    expect(projectNumber(12.5, whole(0, 30))).toBe(12)
    expect(projectNumber(29.9, whole(0, 30))).toBe(29)
    expect(projectNumber(45, whole(0, 30))).toBe(30)
    expect(projectNumber(-0.5, whole(0, 30))).toBe(0)
  })

  it('wraps a cyclic value instead of stopping it at the end', () => {
    expect(projectNumber(1.25, cyclic(0, 1))).toBeCloseTo(0.25, 12)
    expect(projectNumber(2, cyclic(0, 1))).toBe(0)
    expect(projectNumber(-0.25, cyclic(0, 1))).toBeCloseTo(0.75, 12)
    // In range, both ends included, is left exactly as it is.
    expect(projectNumber(1, cyclic(0, 1))).toBe(1)
    expect(projectNumber(0.5, cyclic(0, 1))).toBe(0.5)
  })

  it('leaves what it cannot place alone', () => {
    expect(projectNumber(Number.NaN, whole(0, 30))).toBeNaN()
    expect(projectNumber(Infinity, cyclic(0, 1))).toBe(Infinity)
  })
})

/** Every bounded number actually present in `value`, with its path. */
function leaves(
  plan: DomainPlan,
  value: unknown,
  path: (string | number)[] = [],
  out: { path: (string | number)[]; domain: NumberDomain }[] = [],
) {
  if (plan.kind === 'number') {
    if (typeof value === 'number') out.push({ path, domain: plan.domain })
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  const target = value as Record<string | number, unknown>
  const children: [string | number, DomainPlan][] =
    plan.kind === 'fields'
      ? plan.fields
      : Object.keys(target).map((key) => [key, plan.plan])
  for (const [key, child] of children) {
    leaves(child, target[key], [...path, key], out)
  }
  return out
}

function planLeafCount(plan: DomainPlan): number {
  if (plan.kind === 'number') return 1
  if (plan.kind === 'each') return planLeafCount(plan.plan)
  return plan.fields.reduce((sum, [, child]) => sum + planLeafCount(child), 0)
}

function setAt(root: unknown, path: (string | number)[], value: number) {
  let node = root as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) {
    node = node[key] as Record<string | number, unknown>
  }
  node[path.at(-1)!] = value
}

function getAt(root: unknown, path: (string | number)[]): unknown {
  let node = root
  for (const key of path) node = (node as Record<string | number, unknown>)[key]
  return node
}

/** Values just outside `domain`, and a fraction inside it when whole. */
function outOfDomain(domain: NumberDomain): number[] {
  const values: number[] = []
  if (Number.isFinite(domain.min)) values.push(domain.min - 0.5)
  if (Number.isFinite(domain.max)) values.push(domain.max + 0.5)
  if (domain.integer) values.push(Math.max(domain.min, 0) + 0.5)
  if (domain.cyclic) values.push(domain.max + 1.25, domain.min - 3.25)
  return values
}

/** A flame that carries every optional bounded field at least once. */
function fixture(dimensions: 2 | 3) {
  const affine =
    dimensions === 3
      ? {
          a: 1,
          b: 0,
          c: 0,
          d: 0,
          e: 1,
          f: 0,
          g: 0,
          h: 0,
          i: 0,
          j: 0,
          k: 1,
          l: 0,
        }
      : { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }
  const transforms = {
    t1: {
      probability: 1,
      preAffine: affine,
      postAffine: affine,
      color: { x: 0.5, y: 0.5 },
      variations: { v1: { type: 'linearVar', weight: 1 } },
    },
  }
  return validateFlame({
    version: '1.0',
    renderSettings: {
      ...pureClone(renderSettingsDefault),
      dimensions,
      blendWeight: 0.5,
      edgeFadeColor: [0, 0, 0, 0.8],
    },
    transforms,
    layers: [{ id: 'l1', opacity: 0.5, transforms }],
  })
}

describe('projectFlameToSchema', () => {
  it('reads the two fields playback breaks off the schema itself', () => {
    const { flat } = flameDomainPlans()
    const byPath = new Map(
      leaves(flat, fixture(2)).map((l) => [l.path.join('.'), l.domain]),
    )
    expect(byPath.get('renderSettings.skipIters')).toEqual(whole(0, 30))
    expect(byPath.get('renderSettings.palettePhase')).toEqual(cyclic(0, 1))
  })

  it.each([2, 3] as const)(
    'every bounded number of a %dD flame lands in a flame that validates',
    (dimensions) => {
      const { flat, spatial } = flameDomainPlans()
      const plan = dimensions === 3 ? spatial : flat
      const base = fixture(dimensions)
      const found = leaves(plan, base)
      // The fixture must reach every bounded field the schema has, or a new
      // one would pass here untested.
      expect(found.length).toBeGreaterThanOrEqual(planLeafCount(plan))
      for (const { path, domain } of found) {
        const key = path.join('.')
        for (const bad of outOfDomain(domain)) {
          // `dimensions` picks the schema the rest is read with, and nothing
          // animates it: a value past 3 has no frame to come from.
          if (key === 'renderSettings.dimensions' && bad > domain.max) continue
          const flame = pureClone(base)
          setAt(flame, path, bad)
          projectFlameToSchema(flame)
          const label = `${key} = ${bad}`
          expect(() => validateFlame(pureClone(flame)), label).not.toThrow()
          const landed = getAt(flame, path) as number
          expect(landed, label).toBe(projectNumber(bad, domain))
        }
      }
    },
  )

  it('leaves a flame that already validates exactly as it was', () => {
    const flame = fixture(2)
    const before = pureClone(flame)
    expect(projectFlameToSchema(flame)).toBe(flame)
    expect(flame).toEqual(before)
  })
})
