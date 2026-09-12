import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The restore notice ("Restored your last flame") is a toast, and the moment
 * it is needed is the moment it is written: the launch has just put somebody's
 * unsaved work behind the welcome screen, and a starter flame on that grid is
 * one tap away. Stacking lives in the stylesheet and the test DOM applies no
 * CSS, so this reads the rules themselves.
 */
const zIndexOf = (css: string, selector: string): number | undefined => {
  const rules = css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .split('}')
    .map((chunk) => chunk.split('{'))
    .filter((parts) => parts.length === 2)
  const rule = rules.find((parts) => parts[0]!.trim() === selector)
  const z = /z-index:\s*(\d+)/.exec(rule?.[1] ?? '')
  return z ? Number(z[1]) : undefined
}

const appCss = readFileSync(
  join(__dirname, '..', '..', 'App.module.css'),
  'utf8',
)
const welcomeCss = readFileSync(
  join(__dirname, '..', 'WelcomeScreen', 'WelcomeScreen.module.css'),
  'utf8',
)

describe('the toast column', () => {
  it('is seen over the welcome screen', () => {
    const toast = zIndexOf(appCss, '.toast-region')
    const welcome = zIndexOf(welcomeCss, '.backdrop')
    expect(toast, 'the toast column needs a stacking order').toBeTypeOf(
      'number',
    )
    expect(welcome, 'the welcome screen needs one too').toBeTypeOf('number')
    expect(toast!).toBeGreaterThan(welcome!)
  })
})
