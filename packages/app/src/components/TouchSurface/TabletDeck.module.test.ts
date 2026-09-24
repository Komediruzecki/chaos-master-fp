/**
 * The tablet deck's two modes as the stylesheets write them, which the test
 * DOM does not apply: the opaque page by default, and with the Glass panels
 * setting on the glass over a canvas that runs under it, whose controls keep
 * the colours they have on the page (TabletDeck.module.css).
 *
 * Read from disk rather than imported: the test runtime turns a CSS module
 * import, `?raw` included, into class names. So it is registered in
 * scripts/always-on-tests.mjs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...path: string[]) =>
  readFileSync(join(import.meta.dirname, ...path), 'utf8')
const deck = read('TabletDeck.module.css')
const app = read('..', '..', 'App.module.css')
const lumen = read('..', '..', 'styles', 'designSystem', 'lumen.css')

/** The declarations of the first rule written exactly as `selector`. */
function declarations(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
  )
}

/** The value of a custom property in a block of declarations, spaces folded. */
function token(block: string, name: string): string | undefined {
  const escaped = name.replace(/[-]/g, '\\-')
  return new RegExp(`${escaped}:\\s*([^;]+);`)
    .exec(block)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim()
}

const lumenRoot = declarations(lumen, ':root')
const lumenMoreContrast =
  /@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
    lumen,
  )?.[1] ?? ''
const floatingMoreContrast =
  /@media \(prefers-contrast: more\)\s*\{\s*\.floating\s*\{([^}]*)\}/.exec(
    deck,
  )?.[1] ?? ''

/** The ink share of an `rgba(242, 243, 245, a)` hairline, as a percentage. */
function inkShare(value: string | undefined): number {
  const alpha = /rgba\(242, 243, 245, ([0-9.]+)\)/.exec(value ?? '')?.[1]
  return Math.round(Number(alpha) * 100)
}

describe('the tablet deck stylesheet', () => {
  it('fills only the page, so the glass panel shows when it floats', () => {
    // The deck's own rule sets no fill: the page adds the opaque one, and
    // floating, the primitive's panel class supplies the glass.
    expect(declarations(deck, '.deck')).not.toMatch(/background/)
    const page = declarations(deck, '.page')
    expect(page).toMatch(/background:\s*var\(--la-surface\);/)
    expect(page).toMatch(/border-left:\s*1px solid var\(--la-hairline\);/)
    expect(declarations(deck, '.floating')).not.toMatch(/background/)
  })

  it('keeps the controls the colour they are on the page when floating', () => {
    // The page's hairline fills are translucent ink over --la-surface. The
    // floating deck mixes the same share of ink onto --la-surface, so a
    // chip is opaque and the art does not show through it. Follows lumen.
    const floating = declarations(deck, '.floating')
    const mix = (share: number, of: string) =>
      `color-mix(in srgb, var(${of}) ${share}%, var(--la-surface))`
    // However the formatter wraps it.
    const flat = (value: string | undefined) =>
      value?.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')

    expect(flat(token(floating, '--la-hairline'))).toBe(
      flat(mix(inkShare(token(lumenRoot, '--la-hairline')), '--la-ink')),
    )
    expect(flat(token(floating, '--la-hairline-strong'))).toBe(
      flat(mix(inkShare(token(lumenRoot, '--la-hairline-strong')), '--la-ink')),
    )
    const wash = /var\(--la-accent\) ([0-9.]+)%, transparent/.exec(
      token(lumenRoot, '--la-accent-wash') ?? '',
    )?.[1]
    expect(flat(token(floating, '--la-accent-wash'))).toBe(
      flat(mix(Number(wash), '--la-accent')),
    )

    // And at the strengths More Contrast gives the hairlines.
    expect(flat(token(floatingMoreContrast, '--la-hairline'))).toBe(
      flat(
        mix(inkShare(token(lumenMoreContrast, '--la-hairline')), '--la-ink'),
      ),
    )
    expect(flat(token(floatingMoreContrast, '--la-hairline-strong'))).toBe(
      flat(
        mix(
          inkShare(token(lumenMoreContrast, '--la-hairline-strong')),
          '--la-ink',
        ),
      ),
    )
  })

  it('keeps text on the glass at ink-2 or brighter when floating', () => {
    // Decision c: on the panel's 80% fill, ink and ink-2 only.
    expect(token(declarations(deck, '.floating'), '--la-ink-3')).toBe(
      'var(--la-ink-2)',
    )
  })
})

describe('the tablet layout grid', () => {
  it('runs the canvas under the deck only with the Glass panels setting on', () => {
    const spans = [
      ...app.matchAll(/([^{}]*)\{[^}]*grid-column-end:\s*inspector/g),
    ]
    expect(
      spans.map((m) => m[1]?.replace(/\/\*[\s\S]*?\*\//g, '').trim()),
    ).toEqual([
      ":global(:root[data-glass-panels='on']) .tabletLayout .canvas-container",
    ])
  })
})
