import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * "Restored your last flame" is the one thing the user is told about a
 * launch that just put their unsaved work back, and the moment it is needed
 * is the moment it is written: the welcome grid is still up, a starter flame
 * is one tap away, and the workspace it would replace is mounted behind it.
 *
 * Two things have to hold for it to be seen, and each has broken once. The
 * notice must be rendered outside the Suspense boundary, because an effect
 * inside a suspended boundary does not run until the boundary resolves - so
 * it waited on the workspace chunk and on the share-link fetch. And the toast
 * column has to paint above the welcome screen's backdrop. Neither is
 * reachable from a rendered test without rebuilding App's whole tree, so both
 * are read out of the source they live in.
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

describe('the restore notice', () => {
  it('is written where an unresolved Suspense cannot hold it back', () => {
    const app = readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
    const notice = app.indexOf('MessageToast message={draftNotice()}')
    const suspense = app.indexOf('<Suspense')
    expect(
      notice,
      'the restore notice is rendered as <MessageToast message={draftNotice()} />',
    ).toBeGreaterThan(-1)
    expect(suspense, 'App still suspends the workspace').toBeGreaterThan(-1)
    expect(
      notice,
      'the notice must sit before the Suspense boundary, not inside it',
    ).toBeLessThan(suspense)
  })

  it('is painted over the welcome screen it appears on top of', () => {
    const toast = zIndexOf(
      readFileSync(join(import.meta.dirname, 'App.module.css'), 'utf8'),
      '.toast-region',
    )
    const welcome = zIndexOf(
      readFileSync(
        join(
          import.meta.dirname,
          'components/WelcomeScreen/WelcomeScreen.module.css',
        ),
        'utf8',
      ),
      '.backdrop',
    )
    expect(toast, 'the toast column needs a stacking order').toBeTypeOf(
      'number',
    )
    expect(welcome, 'the welcome screen needs one too').toBeTypeOf('number')
    expect(toast!).toBeGreaterThan(welcome!)
  })
})
