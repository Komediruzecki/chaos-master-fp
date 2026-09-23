/**
 * Text on glass, measured (docs/plans/glass-panels.md, decision c). A glass
 * fill lets the artwork through, and the artwork can be white-hot, so each
 * text token is allowed only on the fills that keep it at 4.5:1, WCAG AA
 * for body text, with white behind the glass, and with black too.
 *
 * This reads the tokens from lumen.css, whose section 5 states the tiers,
 * and holds them to the table below in both directions: every token a fill
 * allows reaches 4.5:1 on it, and every ink it does not allow falls short.
 * A change to a fill or an ink that moves a tier boundary fails here, and
 * the table and the comment in lumen.css move with it.
 *
 * The composite is the one a browser draws: the fill's colour at its
 * color-mix() percentage over the backdrop, mixed in sRGB. The blur is left
 * out, since blurring a white-hot backdrop leaves it white.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Rgb = readonly [number, number, number]

const AA = 4.5
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

const TEXT = ['--la-ink', '--la-ink-2', '--la-ink-3', '--la-accent'] as const
type Text = (typeof TEXT)[number]
const INKS: readonly Text[] = ['--la-ink', '--la-ink-2', '--la-ink-3']

/**
 * What each fill allows as text. Accent is kept out of text on glass by the
 * plan, not only by the measure: it reaches 4.79:1 on --la-glass-strong and
 * is still left off it. Only the inks are therefore held to falling short
 * where they are not allowed; accent has its own test below.
 */
const TIERS: ReadonlyArray<{
  fill: string
  percent: number
  allows: readonly Text[]
}> = [
  { fill: '--la-glass', percent: 72, allows: ['--la-ink'] },
  { fill: '--la-glass-panel', percent: 80, allows: ['--la-ink', '--la-ink-2'] },
  {
    fill: '--la-glass-strong',
    percent: 86,
    allows: ['--la-ink', '--la-ink-2', '--la-ink-3'],
  },
  { fill: '--la-glass-solid', percent: 96, allows: TEXT },
]

/** The plan's table, over white, to two places. */
const PLAN_OVER_WHITE: Record<number, Record<Text, number>> = {
  72: {
    '--la-ink': 6.89,
    '--la-ink-2': 3.99,
    '--la-ink-3': 2.7,
    '--la-accent': 2.86,
  },
  80: {
    '--la-ink': 9.3,
    '--la-ink-2': 5.39,
    '--la-ink-3': 3.64,
    '--la-accent': 3.85,
  },
  86: {
    '--la-ink': 11.55,
    '--la-ink-2': 6.69,
    '--la-ink-3': 4.52,
    '--la-accent': 4.79,
  },
}

/**
 * The custom properties of lumen.css's first `:root` block, the defaults;
 * the media blocks after it only ever raise contrast (More Contrast, Reduce
 * Transparency) or change sizes.
 */
function rootTokens(css: string): Map<string, string> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const open = src.indexOf(':root {')
  const close = src.indexOf('\n}', open)
  expect(open, 'lumen.css has a :root block').toBeGreaterThanOrEqual(0)
  const tokens = new Map<string, string>()
  for (const [, name, value] of src
    .slice(open, close)
    .matchAll(/(--la-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name!, value!.trim())
  }
  return tokens
}

const tokens = rootTokens(
  readFileSync(join(import.meta.dirname, 'lumen.css'), 'utf8'),
)

function token(name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`lumen.css defines no ${name}`)
  return value
}

/** A #rrggbb token. Anything else is a format this test must learn first. */
function colour(name: string): Rgb {
  const value = token(name)
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!hex) throw new Error(`${name} is ${value}, not a #rrggbb colour`)
  return [hex[1]!, hex[2]!, hex[3]!].map((h) =>
    parseInt(h, 16),
  ) as unknown as Rgb
}

/** The percentage of a `color-mix(in srgb, var(--la-ground) N%, transparent)` fill. */
function fillPercent(name: string): number {
  const value = token(name)
  const mix =
    /^color-mix\(in srgb, var\(--la-ground\) ([\d.]+)%, transparent\)$/.exec(
      value,
    )
  if (!mix)
    throw new Error(`${name} is ${value}, not ground mixed with transparent`)
  return Number(mix[1])
}

const linear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

const ground = colour('--la-ground')

/** The glass at `percent` over `backdrop`, as it reaches the eye. */
function glassOver(percent: number, backdrop: Rgb): Rgb {
  const alpha = percent / 100
  return ground.map(
    (c, i) => alpha * c + (1 - alpha) * backdrop[i]!,
  ) as unknown as Rgb
}

const onGlass = (text: Text, percent: number, backdrop: Rgb) =>
  contrast(colour(text), glassOver(percent, backdrop))

const twoPlaces = (n: number) => Math.round(n * 100) / 100

describe('text on glass', () => {
  it('reads the fills the tiers are written for', () => {
    expect(
      Object.fromEntries(TIERS.map(({ fill }) => [fill, fillPercent(fill)])),
    ).toEqual(
      Object.fromEntries(TIERS.map(({ fill, percent }) => [fill, percent])),
    )
  })

  it.each(TIERS)('keeps to its tier on $fill', ({ fill, allows }) => {
    const percent = fillPercent(fill)
    const wrong: string[] = []
    for (const text of TEXT) {
      const overWhite = onGlass(text, percent, WHITE)
      const overBlack = onGlass(text, percent, BLACK)
      const worst = Math.min(overWhite, overBlack)
      if (allows.includes(text) && worst < AA) {
        wrong.push(
          `${text} is allowed on ${fill} but reaches ${worst.toFixed(2)}:1`,
        )
      }
      if (!allows.includes(text) && INKS.includes(text) && overWhite >= AA) {
        wrong.push(
          `${text} reaches ${overWhite.toFixed(2)}:1 on ${fill}, which does not ` +
            'allow it: move the tier in this table and in lumen.css section 5',
        )
      }
    }
    expect(wrong).toEqual([])
  })

  it('measures the fills as the plan does', () => {
    const measured = Object.fromEntries(
      Object.keys(PLAN_OVER_WHITE).map((percent) => [
        percent,
        Object.fromEntries(
          TEXT.map((text) => [
            text,
            twoPlaces(onGlass(text, Number(percent), WHITE)),
          ]),
        ),
      ]),
    )
    expect(measured).toEqual(PLAN_OVER_WHITE)
  })

  it('keeps accent short of 4.5:1 on every fill under 84%', () => {
    const passing: string[] = []
    for (let tenths = 0; tenths < 840; tenths++) {
      const ratio = onGlass('--la-accent', tenths / 10, WHITE)
      if (ratio >= AA) passing.push(`${tenths / 10}%: ${ratio.toFixed(2)}:1`)
    }
    expect(passing).toEqual([])
  })
})
