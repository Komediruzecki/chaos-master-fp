/**
 * Where the app's glass is written (docs/plans/glass-panels.md, section 3).
 * glass.module.css and lumen.css are the one place a surface's glass is
 * decided, so that changing a fill, a blur or the setting's gate changes
 * every surface at once. These guards keep it that way:
 *
 *   - The literal blurs left are App.module.css's and the arena's and the
 *     duel's, which keep their own look on purpose and say so on the line
 *     above each. glassBlurs.test.ts counts them; this says where they may
 *     be, so that one cannot be swapped for a new one elsewhere.
 *   - The large desktop surfaces over the canvas compose optionalPanel, so
 *     the Glass panels setting, busy and the text tiers reach each of them;
 *     the labels over previews compose frost or frostFade, the screens that
 *     block the app compose scrim.
 *   - No stylesheet but lumen.css defines a glass, frost or scrim token, and
 *     the ink remap a panel carries is written outside glass.module.css only
 *     where the glass sits on another element than the text.
 *
 * Read from disk rather than imported: the test runtime turns a CSS module
 * import into class names. So it is registered in scripts/always-on-tests.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..')
const GLASS = "'@/styles/designSystem/glass.module.css'"

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return filesUnder(full)
    return name.endsWith('.css') ? [full] : []
  })
}

/** Every stylesheet, comments blanked with their line breaks kept. */
const stylesheets = filesUnder(SRC).map((full) => ({
  file: relative(SRC, full).split('\\').join('/'),
  raw: readFileSync(full, 'utf8'),
  css: readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  ),
}))

const DEFINED_HERE = new Set([
  'styles/designSystem/glass.module.css',
  'styles/designSystem/lumen.css',
])

/** The line numbers of the blurs a stylesheet writes with its own value. */
function literalBlurLines(css: string): number[] {
  return css.split('\n').flatMap((line, i) =>
    // The spaces sit inside the lookaheads, or they would give back the
    // one before `none` and pass it.
    /^\s*backdrop-filter:(?!\s*none\s*;)(?!\s*var\(--la-glass-[\w-]+\)\s*;)/.test(
      line,
    )
      ? [i + 1]
      : [],
  )
}

/** Whether `selector`'s own rule composes `primitive` from glass.module.css. */
function composes(css: string, selector: string, primitive: string): boolean {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(^|\\n)${escaped} \\{\\s*composes: ${primitive} from ${GLASS};`,
  ).test(css)
}

function stylesheet(file: string) {
  const found = stylesheets.find((s) => s.file === file)
  if (!found) throw new Error(`${file} is not a stylesheet under src`)
  return found
}

/** Deliberate exceptions: each blur there says so on the line above it. */
const OWN_GLASS = [
  'components/ArenaOverlay.module.css',
  'components/Duel/DuelChips.module.css',
  'components/Duel/DuelResultCard.module.css',
  'components/Duel/DuelStage.module.css',
  'components/Duel/EclipseHud.module.css',
]

describe('literal blurs', () => {
  it('are only in App.module.css and the arena and duel stylesheets', () => {
    const allowed = new Set(['App.module.css', ...OWN_GLASS])
    const elsewhere = stylesheets
      .filter(({ file }) => !DEFINED_HERE.has(file) && !allowed.has(file))
      .flatMap(({ file, css }) =>
        literalBlurLines(css).map((line) => `${file}:${line}`),
      )
    expect(elsewhere).toEqual([])
  })

  it('in the arena and the duel, each say why they are literal', () => {
    const unmarked = OWN_GLASS.flatMap((file) => {
      const { raw, css } = stylesheet(file)
      const lines = raw.split('\n')
      return literalBlurLines(css).flatMap((line) => {
        // The comment sits above the -webkit- twin, which comes first.
        const above = lines[line - 3] ?? ''
        return above.includes('Literal on purpose') ? [] : [`${file}:${line}`]
      })
    })
    expect(unmarked).toEqual([])
    expect(
      OWN_GLASS.every((file) => literalBlurLines(stylesheet(file).css).length),
    ).toBe(true)
  })
})

/** Each surface that takes its glass from a primitive, by the rule it is in. */
const SURFACES: [primitive: string, file: string, selector: string][] = [
  [
    'optionalPanel',
    'components/FloatingActions/FloatingActions.module.css',
    '.widget',
  ],
  ['optionalPanel', 'components/PullUpMenu/PullUpMenu.module.css', '.panel'],
  [
    'optionalPanel',
    'components/SoftwareVersion/SoftwareVersion.module.css',
    '.menuPopover',
  ],
  [
    'optionalPanel',
    'components/SoftwareVersion/SoftwareVersion.module.css',
    '.menuPopoverUp',
  ],
  [
    'optionalPanel',
    'components/SessionRecorder/SessionRecorderDock.module.css',
    '.bar',
  ],
  [
    'optionalPanel',
    'components/SessionRecorder/SessionLibraryPanel.module.css',
    '.panel',
  ],
  [
    'optionalPanel',
    'components/SessionRecorder/SessionReplayPanel.module.css',
    '.panel',
  ],
  [
    'optionalPanel',
    'components/SessionRecorder/ReplayAgentRail.module.css',
    '.rail',
  ],
  [
    'chrome',
    'components/SoftwareVersion/SoftwareVersion.module.css',
    '.desktopTrigger',
  ],
  ['chrome', 'components/Arcade/PilotOverlay.module.css', '.banner'],
  ['chrome', 'components/Arcade/PilotOverlay.module.css', '.hint'],
  [
    'chrome',
    'components/SessionRecorder/ReplaySpotlight.module.css',
    '.caption',
  ],
  ['chrome', 'pages/Benchmarks/BenchmarksPage.module.css', '.header'],
  [
    'frostFade',
    'components/BlendFlameGallery/BlendFlameGallery.module.css',
    '.thumbnailBar',
  ],
  [
    'frostFade',
    'components/LoadFlameModal/LoadFlameModal.module.css',
    '.item-title',
  ],
  [
    'frostFade',
    'components/WelcomeScreen/WelcomeScreen.module.css',
    '.thumbnailBar',
  ],
  [
    'frost',
    'components/ExportPngDialog/FramePreviewGallery.module.css',
    '.frameNumber',
  ],
  ['frost', 'components/DirectorOverlay.module.css', '.fitnessBadge'],
  ['frost', 'components/Home/HomeTab.module.css', '.plate-link'],
  ['frost', 'components/FlameColorEditor/ColorEditor.module.css', '.tabs'],
  ['scrim', 'components/WelcomeScreen/WelcomeScreen.module.css', '.backdrop'],
  [
    'scrim',
    'components/ErrorHandling/ErrorHandling.module.css',
    '.crash-overlay',
  ],
]

describe('the surfaces that take their glass from a primitive', () => {
  it.each(SURFACES)('%s: %s %s', (primitive, file, selector) => {
    expect(composes(stylesheet(file).css, selector, primitive)).toBe(true)
  })

  it('fade their fill when busy turns a panel solid', () => {
    // glass.module.css sets no transition on optionalPanel: a surface that
    // lists its own and leaves background-color out snaps between the
    // glass and the solid fill mid-playback.
    const snapping = SURFACES.filter(([p]) => p === 'optionalPanel').flatMap(
      ([, file, selector]) => {
        const { css } = stylesheet(file)
        const start = css.search(new RegExp(`(^|\\n)\\${selector} \\{`))
        const body = css.slice(start, css.indexOf('\n}\n', start))
        const own = /\n {2}transition:([^;]*);/.exec(body)?.[1] ?? ''
        return /background-color|\ball\b/.test(own)
          ? []
          : [`${file} ${selector}`]
      },
    )
    expect(snapping).toEqual([])
  })

  it('are found by the matcher, which misses a rule that does not compose', () => {
    const css = `.a {\n  composes: frost from ${GLASS};\n}\n.b {\n  color: red;\n}\n`
    expect(composes(css, '.a', 'frost')).toBe(true)
    expect(composes(css, '.b', 'frost')).toBe(false)
    expect(composes(css, '.a', 'scrim')).toBe(false)
  })
})

describe('the glass tokens', () => {
  it('are defined in lumen.css alone', () => {
    const redefined = stylesheets
      .filter(({ file }) => !DEFINED_HERE.has(file))
      .flatMap(({ file, css }) =>
        [
          ...css.matchAll(
            /(?:^|[;{\s])(--la-(?:glass|frost|scrim)[\w-]*)\s*:/g,
          ),
        ].map((m) => `${file}: ${m[1]}`),
      )
    expect(redefined).toEqual([])
  })

  it('leave the ink remap to the primitive, but where the glass is a layer', () => {
    // The tour's card puts its glass on a layer behind the text, and the
    // tablet deck switches its glass by class; each keeps the text contract
    // on the element that holds the text.
    const remaps = stylesheets
      .filter(({ file }) => !DEFINED_HERE.has(file))
      .flatMap(({ file, css }) =>
        /--la-ink-3\s*:\s*var\(--la-ink-2\)/.test(css) ? [file] : [],
      )
    expect(remaps.sort()).toEqual([
      'components/SpotlightTour/SpotlightTour.module.css',
      'components/TouchSurface/TabletDeck.module.css',
    ])
  })
})
