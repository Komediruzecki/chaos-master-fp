/**
 * How a fighter takes its 3D form: the stem rule, the flat-card fallback, and
 * the morph that inflates a flat card without changing the compiled shader.
 */
import { describe, expect, it } from 'vitest'
import { examples } from '../examples'
import { shaderShapeOf } from '../shaderShape'
import { fighterForm, stemTwin3D, Z_TRANSPARENT_TWINS } from './convert2Dto3D'
import type { FlameDescriptor, TransformRecord } from '../schema/flameSchema'

const shape = (transforms: Record<string, unknown>) =>
  JSON.stringify(shaderShapeOf(transforms as TransformRecord))

/** A 2D flame with the given variation types, one transform each. */
function flat2D(types: string[]): FlameDescriptor {
  const base = examples.linear1
  const transforms = Object.fromEntries(
    types.map((type, n) => [
      `t${n}`,
      {
        probability: 1,
        visible: true,
        preAffine: { a: 0.5, b: 0.1, c: 0.2, d: -0.1, e: 0.5, f: 0.3 },
        postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        color: { x: 0.1, y: 0.1 },
        colorSpeed: 0.5,
        variations: { v: { type, weight: 0.8, visible: true } },
      },
    ]),
  )
  return { ...base, transforms }
}

describe('stemTwin3D', () => {
  it.each([
    ['sphericalVar', 'spherical3D'],
    ['juliaVar', 'julia3D'],
    ['linearVar', 'linear3D'],
  ])('sends %s to %s', (from, to) => {
    expect(stemTwin3D(from)).toBe(to)
  })

  it.each([
    ['juliaNVar', 'no 3D twin'],
    ['fanVar', 'a twin that takes parameters'],
    ['curlVar', 'a 2D variation that takes parameters'],
    ['spherical3D', 'already 3D'],
    ['noSuchVar', 'not registered'],
  ])('leaves %s alone: %s', (type) => {
    expect(stemTwin3D(type)).toBeUndefined()
  })
})

describe('fighterForm', () => {
  it('takes a 3D flame as it is', () => {
    const form = fighterForm(examples.example37)
    expect(form.kind).toBe('native3D')
    expect(form.transformsAt(0)).toBe(form.transformsAt(1))
    expect(Object.keys(form.transformsAt(0))).toEqual(
      Object.keys(examples.example37.transforms),
    )
  })

  it('inflates a 2D flame whose twins give it depth', () => {
    const form = fighterForm(examples.goldenApollonianGasket)
    expect(form.kind).toBe('inflates')
    expect(form.converted).toEqual(['sphericalVar -> spherical3D'])
  })

  it('lists what it keeps as 2D', () => {
    const form = fighterForm(examples.neonJulianCosmos)
    expect(form.kind).toBe('inflates')
    expect(form.kept).toContain('juliaNVar')
    expect(form.converted).toContain('sphericalVar -> spherical3D')
  })

  it('keeps a flat card when nothing converts', () => {
    const form = fighterForm(examples.example2)
    expect(form.kind).toBe('flatCard')
    expect(form.converted).toEqual([])
    expect(form.kept).toEqual(['juliaScopeVar'])
  })

  it.each([...Z_TRANSPARENT_TWINS])(
    'keeps a flat card when the only twin is %s, which passes z through',
    (twin) => {
      const form = fighterForm(flat2D([twin.replace(/3D$/, 'Var')]))
      expect(form.kind).toBe('flatCard')
    },
  )

  it('does not count a twin that draws nothing', () => {
    const flame = flat2D(['sphericalVar'])
    const t0 = Object.values(flame.transforms)[0]!
    Object.values(t0.variations)[0]!.weight = 0
    expect(fighterForm(flame).kind).toBe('flatCard')
  })

  it('lays a flat card flat at every morph', () => {
    const form = fighterForm(examples.example2)
    for (const morph of [0, 0.5, 1]) {
      for (const t of Object.values(form.transformsAt(morph))) {
        const pre = t.preAffine as Record<string, number>
        expect([pre.i, pre.j, pre.k, pre.l]).toEqual([0, 0, 0, 0])
      }
    }
  })
})

describe('the inflating morph', () => {
  const form = fighterForm(examples.goldenApollonianGasket)
  const source = Object.values(examples.goldenApollonianGasket.transforms)

  it('compiles the same shader at every morph', () => {
    const at0 = shape(form.transformsAt(0))
    for (const morph of [0.25, 0.5, 0.75, 1]) {
      expect(shape(form.transformsAt(morph))).toBe(at0)
    }
  })

  it('is the flat 2D card at 0 and the 3D twin at 1', () => {
    const weights = (morph: number) =>
      Object.values(form.transformsAt(morph)).map((t) =>
        Object.values(t.variations).map((v) => [v.type, v.weight]),
      )
    const original = source.map((t) =>
      Object.values(t.variations).map((v) => v.weight),
    )
    weights(0).forEach((vars, n) => {
      expect(vars).toEqual([
        ['sphericalVar', original[n]![0]],
        ['spherical3D', 0],
      ])
    })
    weights(1).forEach((vars, n) => {
      expect(vars).toEqual([
        ['sphericalVar', 0],
        ['spherical3D', original[n]![0]],
      ])
    })
  })

  it('scales the z row with the morph', () => {
    for (const morph of [0, 0.4, 1]) {
      for (const t of Object.values(form.transformsAt(morph))) {
        const pre = t.preAffine as Record<string, number>
        // A lifted 2D affine passes z through: its z row is (0, 0, 1, 0).
        expect([pre.i, pre.j, pre.k, pre.l]).toEqual([0, 0, morph, 0])
      }
    }
  })

  it('holds the morph to 0..1', () => {
    expect(shape(form.transformsAt(7))).toBe(shape(form.transformsAt(1)))
    const pre = Object.values(form.transformsAt(-3))[0]!.preAffine as Record<
      string,
      number
    >
    expect(pre.k).toBe(0)
  })

  it('names a twin so it never takes an id the transform uses', () => {
    const flame = flat2D(['sphericalVar'])
    const t0 = Object.values(flame.transforms)[0]!
    const variations = t0.variations as Record<string, unknown>
    variations.v_to3d = { type: 'juliaNVar', weight: 0.1, visible: true }
    const ids = Object.keys(
      Object.values(fighterForm(flame).transformsAt(0.5))[0]!.variations,
    )
    expect(ids).toEqual(['v', 'v_to3d2', 'v_to3d'])
  })
})
