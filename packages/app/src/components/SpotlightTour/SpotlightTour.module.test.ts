/**
 * The tour card's glass, in its stylesheet: the test DOM applies no CSS.
 *
 * The panel sits on two children of the card, the layer behind its text and
 * the arrow, and not on the card. A blur on the card made it a backdrop root,
 * so the arrow, its child, could frost only the card's fill: its tip stood
 * darker than the frosted card over the art. The card fades by its children
 * for the same reason, as below full opacity it is a backdrop root too.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  join(__dirname, 'SpotlightTour.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
}

function keyframes(name: string): string {
  return (
    new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ??
    ''
  )
}

const PANEL =
  /composes:\s*panel\s+from\s+'@\/styles\/designSystem\/glass\.module\.css'/

describe('the tour card stylesheet', () => {
  it('puts the panel on the layer and the arrow, not on the card', () => {
    expect(declarations('.glassLayer')).toMatch(PANEL)
    expect(declarations('.glassArrow')).toMatch(PANEL)
    expect(declarations('.glassCard')).not.toMatch(/composes|backdrop-filter/)
  })

  it('lets the glass card rise while its children fade in', () => {
    expect(declarations('.glassCard')).toMatch(/animation-name:\s*cardRise;/)
    expect(keyframes('cardRise')).toMatch(/transform/)
    expect(keyframes('cardRise')).not.toMatch(/opacity/)
    expect(declarations('.glassCard > *')).toMatch(/animation:\s*cardFade\s/)
    expect(keyframes('cardFade')).toMatch(/opacity/)
  })

  it("gives the arrow the light card's fill only", () => {
    // Inherited on glass, it would take the card's fill, which is none.
    expect(declarations('.arrow')).not.toMatch(/background/)
    expect(declarations('.card:not(.glassCard) .arrow')).toMatch(
      /background:\s*inherit/,
    )
  })
})
