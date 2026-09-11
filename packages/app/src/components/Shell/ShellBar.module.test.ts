import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stacking and hit testing live in the stylesheet, and the test DOM applies
 * no CSS, so these read the rules themselves. The bugs they cover were
 * invisible to every rendering test: the element was in the tree, correct,
 * and untappable.
 */
const css = readFileSync(join(__dirname, 'ShellBar.module.css'), 'utf8')

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
}

describe('the shell bar stylesheet', () => {
  it('lifts the expanded capsule bar over the row beside it', () => {
    // The bar opens absolutely inside EditorRail's `.leading`, which precedes
    // `.chips` in the DOM. With no stacking order of its own the chips paint,
    // and hit-test, on top of it: Library was unreachable from Create.
    const z = /z-index:\s*(\d+)/.exec(declarations('.capsuleDock.expanded'))
    expect(z, 'the expanded dock needs a stacking order').not.toBeNull()
    expect(Number(z?.[1])).toBeGreaterThan(0)
  })

  it('lets the More backdrop take the tap that closes the menu', () => {
    // The backdrop sits inside `.dock`, which is `pointer-events: none` so
    // the canvas stays reachable beside the bar. `.row`, `.more` and `.menu`
    // each take it back; the backdrop did not, so on a phone with no system
    // back a tap outside the menu fell through to the gallery plate
    // underneath and the menu stayed up.
    expect(declarations('.backdrop')).toMatch(/pointer-events:\s*auto/)
  })
})
