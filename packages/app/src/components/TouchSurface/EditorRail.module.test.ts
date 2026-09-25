import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The row's arithmetic lives in the stylesheet; the test DOM applies no CSS. */
const css = readFileSync(join(__dirname, 'EditorRail.module.css'), 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
}

describe('the editor rail stylesheet', () => {
  it('lets the chips narrow past the tap token, keeping their height', () => {
    // --la-tap becomes 48px under [data-platform='android'], and the peek row
    // also holds the capsule and the shutter. At 360px four 48px chips wanted
    // 198px of a 190px box, so the row scrolled and "Vary" was clipped behind
    // the shutter. Width is the only dimension that may give: the tappable
    // box stays --la-tap tall, which clears the 40px floor on both platforms.
    const chip = declarations('.chip')
    const minWidth = /min-width:\s*([0-9.]+)px/.exec(chip)
    expect(minWidth, 'the chip needs a fixed minimum width').not.toBeNull()
    expect(Number(minWidth?.[1])).toBeLessThan(44)
    expect(Number(minWidth?.[1])).toBeGreaterThanOrEqual(40)
    expect(chip).toMatch(/height:\s*var\(--la-tap\)/)
  })

  it('fills the controls on the glass sheet as the floating deck does', () => {
    // With the Glass panels setting on, the open sheet is glass. The control
    // tokens (lumen.css) default to translucent washes, which darken and
    // lighten row by row with the art behind the sheet; the deck and the
    // explorer fill their controls with opaque surfaces instead, and the
    // sheet takes them from the same place in the primitive.
    expect(declarations('.glassPanel')).toMatch(
      /composes:\s*panel solidControls from '@\/styles\/designSystem\/glass\.module\.css';/,
    )
    const deck = readFileSync(join(__dirname, 'TabletDeck.module.css'), 'utf8')
    expect(deck).toMatch(
      /^\.floating\s*\{[^}]*composes:\s*solidControls from '@\/styles\/designSystem\/glass\.module\.css';/m,
    )
    // The selected chip's own wash is translucent too; on the glass sheet it
    // takes the opaque accent fill, as the deck's selected tab does.
    const selected = declarations(
      ".sheet.glassPanel .chip[aria-selected='true']",
    )
    expect(selected).toMatch(/background:\s*var\(--la-control-accent\);/)
  })

  it('gives the shutter a fill its accent icon holds 3:1 on by itself', () => {
    // Ember over --la-glass (72%) is 2.86:1 with white-hot art behind it,
    // under the 3:1 an icon needs (glassContrast.test.ts has the table). The
    // sheet behind the shutter lifted that in place; the shutter's own fill,
    // --la-glass-strong (86%), now holds 4.79:1 without it.
    const shutter = declarations('.shutter')
    expect(shutter).toMatch(/background:\s*var\(--la-glass-strong\);/)
    expect(shutter).toMatch(/color:\s*var\(--la-accent\);/)
  })

  it("shows the flame's ground, not the page, where the sheet moves the canvas up", () => {
    // The open sheet moves the canvas up by half the height it covers
    // (App.module.css, .canvas), leaving a strip of the canvas box at its
    // foot. Past peek the sheet is glass while the Glass panels setting
    // applies, so the strip is on show through it; with no background of its
    // own the box showed the page there, a pale band across the sheet's lower
    // part in the light theme. CanvasViewport then marks the box .underSheet
    // and writes the flame's ground (CanvasViewport.framing.test.tsx), and
    // only then: at peek and under the opaque sheet the box shows the page,
    // as it did before the setting. So that is the one rule to paint it.
    const app = readFileSync(
      join(__dirname, '..', '..', 'App.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const painted = [
      ...app.matchAll(/([^{}]*)\{[^{}]*var\(--canvas-ground\b/g),
    ].map((m) => m[1]!.trim())
    expect(painted).toEqual(['.canvas-container.underSheet'])
    expect(app).toMatch(
      /\n\.canvas-container\.underSheet\s*\{\s*background:\s*var\(--canvas-ground\);\s*\}/,
    )
    expect(app).toMatch(
      /transform:\s*translateY\(calc\(var\(--rail-inset, 0px\) \/ -2\)\)/,
    )
  })
})
