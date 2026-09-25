/**
 * The stylesheet side of the glass desktop sidebar (useSidebarGlass.ts),
 * held to what the code assumes. The test DOM applies no CSS, so this reads
 * the stylesheets:
 *
 *   - the setting-off canvas runs CANVAS_TUCK_REM under the sidebar, which
 *     the cover the sidebar writes leaves out;
 *   - while the sidebar floats (.underSidebar on the canvas box), the box
 *     spans the sidebar's column without the tuck, at the desktop widths
 *     only, and the bottom bar starts where the cover ends;
 *   - the surface is glass by one composes line, the gate's optionalPanel,
 *     and App.module.css writes no copy of the gate;
 *   - the cards, the shared controls and the sidebar's captions read hooks
 *     with their opaque looks as fallbacks, and the glass sidebar sets
 *     exactly the hooks they read, to --la-* tokens, the text ones to ink or
 *     ink-2 (decision c);
 *   - the hover badge centres between both covers, and nothing inside the
 *     sidebar blurs again.
 *
 * Read from disk rather than imported: the test runtime turns a CSS module
 * import into class names. So it is registered in scripts/always-on-tests.mjs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANVAS_TUCK_REM } from './useSidebarGlass'

const SRC = join(import.meta.dirname, '..', '..')

const read = (...path: string[]) =>
  readFileSync(join(SRC, ...path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')

const app = read('App.module.css')

/**
 * The text between the braces of the first block whose header matches: the
 * block the first brace at or after the match opens.
 */
function blockOf(css: string, header: RegExp): string {
  const match = header.exec(css)
  expect(match, String(header)).not.toBeNull()
  const open = css.indexOf('{', match!.index)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') depth--
    if (depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unclosed block after ${String(header)}`)
}

/** The declarations written directly in a block, nested blocks left out. */
function ownDeclarations(block: string): Map<string, string> {
  let flat = ''
  let depth = 0
  for (const ch of block) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      flat += ';'
    } else if (depth === 0) flat += ch
  }
  const out = new Map<string, string>()
  for (const statement of flat.split(';')) {
    const colon = statement.indexOf(':')
    if (colon < 0) continue
    const property = statement.slice(0, colon).trim()
    // A nested rule's selector ends up here without its block.
    if (!/^(--)?[\w-]+$/.test(property)) continue
    out.set(
      property,
      statement
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' '),
    )
  }
  return out
}

const sidebarGlass = ownDeclarations(blockOf(app, /^\.sidebarGlass\s*\{/m))

/** Every read of a hook named `--<prefix>-*`, with whether it has a fallback. */
function hookReads(css: string, prefixes: string[]) {
  const hook = new RegExp(
    String.raw`var\(\s*(--(?:${prefixes.join('|')})-[\w-]+)\s*([,)])`,
    'g',
  )
  return [...css.matchAll(hook)].map(([, name, next]) => ({
    name: name!,
    fallback: next === ',',
  }))
}

describe('the canvas box beside the glass sidebar', () => {
  it('drops the same tuck the cover leaves out', () => {
    const box = blockOf(app, /^\.canvas-container\s*\{/m)
    const tucked = ownDeclarations(blockOf(box, /&:not\(\.fullscreen\)\s*\{/))
    expect(tucked.get('margin-left')).toBe(`-${CANVAS_TUCK_REM}rem`)
  })

  it('spans the sidebar column while the sidebar floats, at desktop widths', () => {
    const desktop = blockOf(
      app,
      /@media \(min-width: 769px\)\s*\{\s*\.canvas-container\.underSidebar/,
    )
    const spans = ownDeclarations(
      blockOf(
        desktop,
        /\.canvas-container\.underSidebar:not\(\.fullscreen\)\s*\{/,
      ),
    )
    expect(spans.get('grid-column-start')).toBe('sidebar')
    expect(spans.get('margin-left')).toBe('0')
    const bar = ownDeclarations(
      blockOf(desktop, /\.underSidebar > \.bottom-bar\s*\{/),
    )
    expect(bar.get('left')).toBe('var(--leading-cover, 0px)')
    // Nowhere else: a span outside the media query would reach the mobile
    // grid, which has no sidebar column.
    expect(app.match(/\.underSidebar/g)).toHaveLength(2)
  })

  it('centres the hover badge on the part both covers leave', () => {
    const badge = ownDeclarations(blockOf(app, /^\.hover-preview-badge\s*\{/m))
    expect(badge.get('left')).toBe('calc((1 - var(--covered-right, 0)) * 50%)')
    expect(badge.get('margin-left')).toBe('calc(var(--covered-left, 0) * 50%)')
    expect(badge.get('transform')).toBe('translateX(-50%)')
  })
})

describe('the glass sidebar surface', () => {
  it('is glass by one composes line, the gate its own', () => {
    expect(sidebarGlass.get('composes')).toBe(
      "optionalPanel from '@/styles/designSystem/glass.module.css'",
    )
    // The tablet layout's span is the only rule here that reads the setting;
    // the sidebar leaves the gate to glass.module.css.
    expect(app.match(/data-glass-panels/g)).toHaveLength(1)
    expect(sidebarGlass.get('background')).toBeUndefined()
    expect(sidebarGlass.get('backdrop-filter')).toBeUndefined()
  })

  it('keeps one blurred layer', () => {
    const inside = ownDeclarations(
      blockOf(app, /^\.sidebar\.sidebarGlass \*\s*\{/m),
    )
    expect(inside.get('-webkit-backdrop-filter')).toBe('none')
    expect(inside.get('backdrop-filter')).toBe('none')
  })

  it.each([
    {
      what: 'the cards',
      files: [
        ['components', 'ControlCard', 'ControlCard.module.css'],
        ['components', 'CollapsibleCard', 'CollapsibleCard.module.css'],
      ],
      prefixes: ['card'],
    },
    {
      what: 'the shared controls',
      files: [
        ['components', 'Sliders', 'Slider.module.css'],
        ['components', 'PaletteSelector', 'PaletteSelector.module.css'],
      ],
      prefixes: ['slider', 'palette'],
    },
    {
      what: "the sidebar's own captions",
      files: [['App.module.css']],
      prefixes: ['caption'],
    },
  ])('sets exactly the hooks $what read', ({ files, prefixes }) => {
    const reads = files.flatMap((path) => hookReads(read(...path), prefixes))
    expect(reads.length).toBeGreaterThan(0)
    // Every read falls back to the look it had, for everywhere but here.
    expect(reads.filter((r) => !r.fallback)).toEqual([])
    const set = [...sidebarGlass.keys()].filter((name) =>
      prefixes.some((prefix) => name.startsWith(`--${prefix}-`)),
    )
    expect(new Set(set)).toEqual(new Set(reads.map((r) => r.name)))
    for (const name of set) {
      const value = sidebarGlass.get(name)!
      expect(value, name).toMatch(/^(var\(--la-[\w-]+\)|transparent)$/)
      if (name.includes('-ink')) {
        expect(value, name).toMatch(/^var\(--la-ink(-2)?\)$/)
      }
    }
  })
})
