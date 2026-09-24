/**
 * The touch inspector's controls as its stylesheet writes them, which the
 * test DOM does not apply (TouchSurface.module.css).
 *
 * Every control fills with a control token (lumen.css): the hairline wash it
 * always had on an opaque surface, and an opaque fill of its own where the
 * floating tablet deck sets one (TabletDeck.module.css). Its edge keeps the
 * hairline, so on the deck the edge and the fill are two colours.
 *
 * Read from disk rather than imported: the test runtime turns a CSS module
 * import into class names. So it is registered in scripts/always-on-tests.mjs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...path: string[]) =>
  readFileSync(join(import.meta.dirname, ...path), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  )
const css = read('TouchSurface.module.css')

/** Every rule of a stylesheet as [selector, declarations], spaces folded. */
function rules(sheet: string): [string, string][] {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [
    sel!.replace(/\s+/g, ' ').trim(),
    body!.replace(/\s+/g, ' ').trim(),
  ])
}

/** The declarations of the rule written exactly as `selector`. */
function rule(sheet: string, selector: string): string {
  return rules(sheet).find(([sel]) => sel === selector)?.[1] ?? ''
}

/** The value `property` takes in a block of declarations. */
function value(block: string, property: string): string | undefined {
  const escaped = property.replace(/[-]/g, '\\-')
  return new RegExp(`(?:^|;)\\s*${escaped}:\\s*([^;]+)`)
    .exec(block)?.[1]
    ?.trim()
}

/** The controls the inspector draws, each with its fill. */
const CONTROLS = {
  '.transformPill': 'var(--la-control)',
  '.iconBtnSmall': 'var(--la-control)',
  '.iconBtnSmall:hover:not(:disabled)': 'var(--la-control-strong)',
  '.tabChip': 'var(--la-control)',
  '.tabChipActive': 'var(--la-control-accent)',
  '.activeVarRow': 'var(--la-control)',
  '.quickPickCard': 'var(--la-control)',
  '.quickPickCard:hover': 'var(--la-control)',
  '.resetShapeBtn': 'var(--la-control)',
  '.resetShapeBtn:hover': 'var(--la-control-strong)',
  '.actionPillBtn': 'var(--la-control)',
  '.actionPillBtn:hover': 'var(--la-control-strong)',
  '.actionPillBtnPrimary': 'var(--la-control-accent)',
  '.actionPillBtnPrimary:hover': 'var(--la-control-accent)',
  '.searchToggleBtn:hover, .searchToggleBtn:active': 'var(--la-control-accent)',
}

/**
 * Fills that stay washes: the tools drawer's cards, on a glass panel of
 * their own outside the deck (MainWorkspace mounts the drawer), and the
 * WebKit scrollbar's thumb, which is not a control's fill.
 */
const WASH_FILLS_ALLOWED = [
  '.drawerCard',
  '.drawerCardHighlight',
  '.drawerCardHighlight:hover',
  '.variationsCarousel::-webkit-scrollbar-thumb',
]

describe('the touch inspector stylesheet', () => {
  it('fills every control with a control token', () => {
    const wrong = Object.entries(CONTROLS).flatMap(([selector, fill]) => {
      const found = value(rule(css, selector), 'background')
      return found === fill ? [] : [`${selector} fills with ${found}`]
    })
    expect(wrong).toEqual([])
  })

  it('edges the controls with a hairline, apart from their fill', () => {
    for (const selector of [
      '.transformPill',
      '.iconBtnSmall',
      '.tabChip',
      '.activeVarRow',
      '.quickPickCard',
      '.resetShapeBtn',
      '.actionPillBtn',
    ]) {
      expect(value(rule(css, selector), 'border'), selector).toMatch(
        /^1px solid var\(--la-hairline(-strong)?\)$/,
      )
    }
  })

  it('fills nothing else with a hairline or the accent wash', () => {
    // A new control filled with the hairline would be the colour of its own
    // edge on the floating deck, where the control tokens are opaque.
    const strays = rules(css)
      .filter(([selector]) => !WASH_FILLS_ALLOWED.includes(selector))
      .filter(([, body]) =>
        /--la-(hairline|accent-wash)/.test(value(body, 'background') ?? ''),
      )
      .map(([selector]) => selector)
    expect(strays).toEqual([])
  })
})
