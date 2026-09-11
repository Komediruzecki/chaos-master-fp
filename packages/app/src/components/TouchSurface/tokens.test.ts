import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The touch surfaces read the --la-* tokens; a hex literal here is a colour
// that will not follow the direction switch (docs/plans/mobile-native/DESIGN.md).
// The shell is chrome of the same kind, so it is held to the same rule.
const DIRS = [__dirname, join(__dirname, '..', 'Shell')]

describe('touch surface stylesheets', () => {
  it('carry no hex colour literals', () => {
    const offenders: string[] = []
    for (const dir of DIRS) {
      for (const file of readdirSync(dir).filter((f) =>
        f.endsWith('.module.css'),
      )) {
        const css = readFileSync(join(dir, file), 'utf8')
        for (const match of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
          offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
