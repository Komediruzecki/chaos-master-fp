// Golden .flame corpus: every fixture must survive parse -> export -> parse.
// Fixtures are written from the format, never taken from a real gallery export,
// which would carry whatever metadata the author's file had in it.
//
// The known losses below predate v0.9.11 and are recorded in docs/agent/BUGS.md.
// They are it.fails on purpose: fixing one turns its test red, which is the
// prompt to move it into the passing corpus.
import { describe, expect, it } from 'vitest'
import { exportFlameXml, parseFlameXml } from './flameXml'
import type { FlameDescriptor } from './schema/flameSchema'

const FIXTURES = import.meta.glob('./__fixtures__/*.flame', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Numbers to 1e-9: the OkLab colour bake leaves -7e-17 where 0 was meant. */
function rounded(value: unknown): unknown {
  if (typeof value === 'number') {
    const r = Math.round(value * 1e9) / 1e9
    return r === 0 ? 0 : r
  }
  if (Array.isArray(value)) return value.map(rounded)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rounded(v)]),
    )
  }
  return value
}

/** Ids are generated per parse, so transforms and variations compare in order. */
function structure(flame: FlameDescriptor, { colours = true } = {}) {
  return rounded({
    ...flame,
    transforms: Object.values(flame.transforms).map(({ color, ...t }) => ({
      ...t,
      ...(colours ? { color } : {}),
      variations: Object.values(t.variations),
    })),
  })
}

function roundTrip(flame: FlameDescriptor) {
  return parseFlameXml(exportFlameXml(flame, flame.metadata?.name))
}

describe('golden .flame round trip', () => {
  it('has a corpus to test', () => {
    expect(Object.keys(FIXTURES).length).toBeGreaterThanOrEqual(7)
  })

  it.each(Object.entries(FIXTURES))(
    '%s survives export and re-import',
    (_name, xml) => {
      const first = parseFlameXml(xml)
      // An embedded palette's colour chroma is a known loss, tested below.
      const colours = !xml.includes('<palette')
      expect(structure(roundTrip(first), { colours })).toEqual(
        structure(first, { colours }),
      )
    },
  )
})

describe('known losses in .flame export', () => {
  const base = () => parseFlameXml(FIXTURES['./__fixtures__/plain-2d.flame']!)

  it.fails('keeps transform colour taken from an embedded palette', () => {
    // Export writes only an angle-derived colour index and no palette, so the
    // re-import rebuilds each colour at a fixed 0.3 chroma.
    const first = parseFlameXml(FIXTURES['./__fixtures__/palette.flame']!)
    expect(structure(roundTrip(first))).toEqual(structure(first))
  })

  it.fails('keeps a background colour that is not a multiple of 1/255', () => {
    const flame = base()
    flame.renderSettings.backgroundColor = [0.1, 0.1, 0.2]
    expect(roundTrip(flame).renderSettings.backgroundColor).toEqual([
      0.1, 0.1, 0.2,
    ])
  })

  it.fails('keeps a very dark background channel dark', () => {
    // Export rounds 0.004 * 255 to 1; import reads a channel of 1 as the 0-1
    // scale, so a near-black channel comes back at full intensity.
    const flame = base()
    flame.renderSettings.backgroundColor = [0.004, 0, 0]
    expect(roundTrip(flame).renderSettings.backgroundColor?.[0]).toBeLessThan(
      0.01,
    )
  })

  it.fails('keeps an exposure that is not a whole brightness step', () => {
    const flame = base()
    flame.renderSettings.exposure = 1
    expect(roundTrip(flame).renderSettings.exposure).toBeCloseTo(1, 6)
  })
})
