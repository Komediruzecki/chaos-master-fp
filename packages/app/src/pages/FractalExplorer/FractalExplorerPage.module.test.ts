/**
 * The shared controls on the explorer's glass (docs/plans/glass-panels.md,
 * decision c).
 *
 * The Slider and the PaletteSelector are written for the editor's opaque
 * sidebar, where their quieter text is fine. On the explorer's panel, 80%
 * glass over art that can be white-hot, that text measured 2.39 to 3.98:1.
 * Their stylesheets therefore read custom-property hooks, --slider-* and
 * --palette-*, which the explorer's `.panel` sets to the panel's own tiers.
 *
 * The test DOM applies no CSS, so this reads the three stylesheets and
 * holds the arrangement in place:
 *
 *   - every hook a control reads has a fallback, the value it had before
 *     the hook, so the opaque sidebar, which sets none, looks as it did;
 *   - the panel sets exactly the hooks the controls read, so no text is
 *     left at its sidebar colour on the glass;
 *   - each hook is set to a --la-* token, and the ink hooks, which colour
 *     text, to ink or ink-2: the tiers an 80% fill allows.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...path: string[]) =>
  readFileSync(join(import.meta.dirname, ...path), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  )

const CONTROLS = {
  'Slider.module.css': read(
    '..',
    '..',
    'components',
    'Sliders',
    'Slider.module.css',
  ),
  'PaletteSelector.module.css': read(
    '..',
    '..',
    'components',
    'PaletteSelector',
    'PaletteSelector.module.css',
  ),
}

const HOOK = /var\(\s*(--(?:slider|palette)-[\w-]+)\s*([,)])/g

/** Every hook read, with whether that read carries a fallback. */
const reads = Object.entries(CONTROLS).flatMap(([file, css]) =>
  [...css.matchAll(HOOK)].map(([, hook, next]) => ({
    file,
    hook: hook!,
    fallback: next === ',',
  })),
)

/**
 * The declarations of the explorer's top-level `.panel` rule. Its media
 * variant holds a nested rule, which the split below leaves out.
 */
const panel =
  read('FractalExplorerPage.module.css')
    .replace(/\s+/g, ' ')
    .split('}')
    .map((chunk) => chunk.split('{'))
    .filter((parts) => parts.length === 2)
    .find(([selector]) => selector!.trim() === '.panel')?.[1] ?? ''

const set = new Map(
  [...panel.matchAll(/(--(?:slider|palette)-[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, hook, value]) => [hook!, value!.trim()],
  ),
)

describe('the shared controls on the explorer glass', () => {
  it('finds the hooks in both controls and on the panel', () => {
    expect(new Set(reads.map(({ file }) => file))).toEqual(
      new Set(Object.keys(CONTROLS)),
    )
    expect(set.size).toBeGreaterThan(0)
  })

  it('falls back to the sidebar look wherever a hook is read', () => {
    const bare = reads
      .filter(({ fallback }) => !fallback)
      .map(({ file, hook }) => `${file} reads ${hook} with no fallback`)
    expect(bare).toEqual([])
  })

  it('sets on the panel exactly the hooks the controls read', () => {
    expect([...set.keys()].sort()).toEqual(
      [...new Set(reads.map(({ hook }) => hook))].sort(),
    )
  })

  it('sets each hook to a token, and text only to ink or ink-2', () => {
    const wrong: string[] = []
    for (const [hook, value] of set) {
      if (!/^var\(--la-[\w-]+\)$/.test(value)) {
        wrong.push(`${hook} is ${value}, not one --la-* token`)
      } else if (
        /-ink(?:-|$)/.test(hook) &&
        !['var(--la-ink)', 'var(--la-ink-2)'].includes(value)
      ) {
        wrong.push(`${hook} colours text on 80% glass and is ${value}`)
      }
    }
    expect(wrong).toEqual([])
  })
})
