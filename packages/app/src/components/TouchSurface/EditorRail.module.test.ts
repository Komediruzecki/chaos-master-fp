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

  it('gives the shutter a fill its accent icon holds 3:1 on by itself', () => {
    // Ember over --la-glass (72%) is 2.86:1 with white-hot art behind it,
    // under the 3:1 an icon needs (glassContrast.test.ts has the table). The
    // sheet behind the shutter lifted that in place; the shutter's own fill,
    // --la-glass-strong (86%), now holds 4.79:1 without it.
    const shutter = declarations('.shutter')
    expect(shutter).toMatch(/background:\s*var\(--la-glass-strong\);/)
    expect(shutter).toMatch(/color:\s*var\(--la-accent\);/)
  })
})
