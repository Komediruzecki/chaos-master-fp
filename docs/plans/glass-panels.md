# Glass panels across the app

Status: decided 2026-09-23 (section 2). Phases 0 to 2 are built on `feat/glass-panels`;
phases 3 and 4 come later. Drafted from a survey of every panel, menu, dialog and overlay in
`packages/app/src`. Its line references are pinned to `9fc08078`, the fork main that phase 0
started from, where every cited file is as the survey read it; the phases have moved them
since. Paths below are relative to `packages/app/src`.

<!-- cite-check: pinned 9fc08078 -->

Goal: give the other panels, tablet and phone first, the semi-transparent glossy look of the
explorer's side panel, without losing legibility over bright flames or frame rate on phones.

## The short version

- The look is already a token set, `--la-glass` and its variants in
  `styles/designSystem/lumen.css:63-72`. Only
  5 files use it. 35 other files hand-roll 59 blur rules of their own (7 copied recipe families,
  44 of them missing the `-webkit-` twin), so step one is one shared primitive, not new CSS.
- The design rule written next to those tokens says the opposite of this request: "ONE glass
  layer, and only where chrome overlaps the artwork ... never glass on glass, never glass on a
  card", and `docs/plans/mobile-native/DESIGN.md:120-121` makes the tablet deck opaque on purpose.
  Decision (a) below changes that rule.
- On a phone most chrome is glass already: the HUD pill, the shell bar, the More menu, the
  rail sheet at peek. On a tablet the two big panels, the inspector deck and the nav rail, are
  grid columns beside the canvas, so there is no art behind them to show through. To look like
  the explorer's panel, the deck has to float over the canvas.
- The explorer's own panel fails contrast over bright art: on its 72% fill over white, ink-2
  text is 3.99:1 and ink-3 is 2.70:1 (the floor is 4.5:1). Decision (c).
- Glass has been cut back five times for cost (`f2eb5426`, `360f044f`, `1f1c9783`, `51367f0d`,
  `790ab47f`). Every rule in section 5 comes from one of those.

## 1. The reference: the explorer's glass

`pages/FractalExplorer/FractalExplorerPage.module.css:102-108`, used by the pane labels, icon
buttons, title block, readouts and the panel:

```css
.glass {
  background: var(--la-glass); /* --la-ground #0d1117 at 72% */
  backdrop-filter: var(--la-glass-blur); /* blur(20px) saturate(1.4) */
  -webkit-backdrop-filter: var(--la-glass-blur);
  border: var(--la-glass-edge); /* 1px, white at 10% */
  box-shadow: var(--la-glass-shadow); /* 0 10px 30px black at 45% */
}
```

There is no inner highlight or sheen: the gloss is the blur, the saturation boost, the thin
light edge and the drop shadow. Controls inside the panel are opaque token surfaces
(`--la-surface-2` inputs and segments, hairline separators), which is why it stays readable.
Reduce Transparency and More Contrast swap the tokens to solid (`lumen.css:301-336`), and that
only reaches surfaces that use the tokens.

## 2. Decisions (taken 2026-09-23)

The recommended option of each was chosen.

**(a) Where real glass goes.**

1. Chrome only, today's rule: real blur on small floating chrome; panels beside the canvas stay
   opaque. Least risk, but the tablet deck will never look like the explorer's panel.
2. **Chosen, staged.** Also float the large touch panels over the canvas as real glass,
   with a text-safe fill and a "solid while busy" switch (section 5). Phone surfaces first
   (phase 1). The tablet deck ships behind a setting until device numbers say it holds its
   frame rate (phase 2). The same setting gates the other change that adds blur area over
   a repainting canvas, the rail sheet past peek, since that reverses a deliberate cut
   (`360f044f`). Everything else ships on: it either removes blur or keeps the cost it has.
3. Glass everywhere, dialogs and the desktop sidebar included. Not recommended: light-theme
   contrast, blur cost over live canvases, and it undoes the five earlier cuts.

**(b) Light theme.** The glass tokens are dark-only. Chosen: glass stays dark in both web
themes, as the touch chrome, Home and the explorer already are. Light glass tokens only if
desktop panels are ever in scope. A surface that also shows on the desktop, such as the toast,
keeps its light-theme look there.

**(c) Text on glass.** WCAG contrast of each text token on a glass fill over a white-hot
backdrop:

| Fill over white                        | ink   | ink-2 | ink-3 | accent |
| -------------------------------------- | ----- | ----- | ----- | ------ |
| 72% (`--la-glass`, the explorer today) | 6.89  | 3.99  | 2.70  | 2.86   |
| 76%                                    | 8.00  | 4.64  | 3.13  | 3.32   |
| 80%                                    | 9.30  | 5.39  | 3.64  | 3.85   |
| 86% (`--la-glass-strong`)              | 11.55 | 6.69  | 4.52  | 4.79   |

Minimum fill for 4.5:1: ink 61%, ink-2 76%, accent 85%, ink-3 86% (exactly 60.3, 75.3, 84.3
and 85.9). Options for panels that carry text:

1. Keep 72%. It fails over bright art.
2. **Chosen.** A new `--la-glass-panel` at 80%, and inside glass the lowest text tier is
   ink-2 (captions move up from ink-3). This stays closest to today's look. Accent stays
   out of text on glass, since it needs 85%; use it for fills and edges there.
3. 86% everywhere. Every tier passes, but the panel is visibly less see-through.

This also applies to the explorer (single mode, and the phone bottom sheet; in the split view
the panel sits over the void, which is fine): its panel moves to `--la-glass-panel`, and its
pills, whose text is ink-2 on the 72% fill, move their text to ink.

## 3. The shared primitive (phase 0 builds it)

`styles/designSystem/glass.module.css`, composed by every glass surface
(`composes: panel from '@/styles/designSystem/glass.module.css'`):

| Class    | Fill                             | Blur | For                                                                                                |
| -------- | -------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `chrome` | `--la-glass` 72%                 | yes  | small floating chrome whose text is ink: pills, buttons, toasts                                    |
| `panel`  | `--la-glass-panel` 80% (per (c)) | yes  | panels and sheets that carry text                                                                  |
| `flat`   | `--la-glass`                     | no   | the "cheap glass" already used by the rail shutter and the deck's edge tab; nested or not over art |
| `solid`  | `--la-glass-solid` 96%           | no   | the busy and fallback state                                                                        |

Built into the primitive, so no surface can get them wrong:

- **Nested glass flattens itself.** `.chrome .chrome, .panel .chrome, ...` drop the blur. A
  nested blur samples only its parent's fill (the parent is a backdrop root), so this is pure
  saving with no visual change. It removes today's explorer stepper buttons, the HUD tooltip and
  the SoftwareVersion menu items as costs.
- **Both properties are always written, `-webkit-` first.** The build's minifier keeps only the
  later of the two spellings in a rule (`build.target: 'esnext'` gives LightningCSS no browser
  targets). Phase 0 found 26 rules written standard first, the primitive's own among them, so
  production shipped them as `-webkit-backdrop-filter` alone: Chrome, Firefox and Android drew
  every glass surface without its blur, while dev showed it. With `-webkit-` first the build
  ships the standard spelling (85 declarations, none prefixed); only iOS below 18 goes without,
  and it has no WebGPU. The guard test requires the order. Keeping both spellings would take
  browser targets for the CSS build, which changes far more of the output than this.
- **`@supports not (...)`** falls back to `solid`.
- **The busy switch.** `:root[data-glass='busy'] .panel` goes `solid`. Sharp moving art behind
  text is worse than an opaque panel. This is the rail sheet's "solid past peek" rule
  (`TouchSurface/EditorRail.module.css:54-62`) generalised. The attribute is written in one place
  (`writeGlassBusy` in `lib/glass.ts`), from one signal (`hooks/useWorkspaceGlassBusy.ts`):
  playback, an export, audio modulation, or a gesture holding a history preview open (a slider,
  the camera, a colour or affine drag), meaning any state where the canvas presents every frame.
  The canvas converging after an edit is not busy. The attribute follows the state only once it
  has held for 150 ms (`GLASS_BUSY_SETTLE_MS`), in both directions, so a tap does not flash the
  panels solid.
- **The setting.** "Glass panels (experimental)", off by default, stored as `chaos-glass-panels`
  (`glassPanels()` in `lib/glass.ts`). It writes `data-glass-panels='on'` on `<html>` before the
  first render, and CSS reads it as `:global(:root[data-glass-panels='on'])`. The toggle is in
  More, then "Settings and more", on touch layouts only.
- **Reduce Transparency and More Contrast** come free through the tokens.
- **New tokens:** `--la-glass-panel`, and a smaller `--la-glass-blur-sm` for chips if device
  numbers ask for it. No new literal radii or blur values anywhere else.

## 4. Surfaces, by phase

**Phase 0: groundwork, no visible change** (M)

- The primitive, the busy switch and the two CI guards (section 7).
- Move the 5 token users onto it: explorer, `Shell/MoreMenu`, `Shell/ShellBar`,
  `TouchSurface/TouchSurface`, `TouchSurface/EditorRail`. Also move the unused global `.la-glass`
  class (`lumen.css:269-275`), then delete it.
- Explorer follow-ups: its 640/641px breakpoint to the app's `PHONE_MAX_WIDTH` 680 (it
  contradicts `lumen.css:338-343`), and the fill and text tier per (c). Done; its HUD still
  overflows sideways at 390px, which phase 1 takes.

**Phase 1: phone and narrow tablet, the rail layout** (M)

| Surface                                                      | Today                                                                                     | Target                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AdvancedToolsDrawer (`TouchSurface.module.css:613-643`)      | 96% fill under a 24px blur: looks solid and still costs                                   | `panel` plus the busy switch. The backdrop becomes `--la-scrim-dim` with no blur of its own. The most visible change on a phone. |
| MoreMenu under TouchHUD (`TouchHUD.tsx`, `.moreMenuWrapper`) | glass inside the blurred, transformed pill                                                | hosted outside the pill, as ShellBar and NavRail already do                                                                      |
| HUD title tooltip (`TouchSurface.module.css:103-122`)        | glass on glass                                                                            | flattened by the nested rule                                                                                                     |
| Rail sheet past peek (`EditorRail.module.css:54-62`)         | solid for cost                                                                            | `panel` while the canvas idles, `solid` while busy. Keep solid if phones cannot hold it.                                         |
| Toast, hover badge, ProgressBar, ExportJobTracker            | two copied families: "oklch 240" and `rgba(15,15,17,.92)`                                 | `chrome` (a small tint shift, from hue 240 to the ground)                                                                        |
| SpotlightTour (`SpotlightTour.tsx:411-479`)                  | card blurred over blurred scrims that animate their size, so the blur re-runs every frame | scrims without blur, the card as `panel`                                                                                         |

**Phase 2: tablet deck, an experiment behind a setting** (L)

- **Today.** `TouchSurface/TabletInspectorDeck.tsx` (`TabletDeck.module.css:5-23`) is opaque
  `--la-surface` in its own grid column. Its header calls it "a page beside the canvas, not
  chrome over it".
- **Floating the deck.**
  - The canvas goes full-bleed under the deck (the `.tabletLayout` grid in `App.module.css:1-35`).
  - The deck becomes absolute on the right as `panel`, with the busy switch.
  - The flame is framed in the visible area: the camera centre is offset by half the deck width,
    so the subject is not hidden under it.
  - The art still glows through the deck, which is the whole look.
- **Cost.**
  - The canvas renders the deck's width in extra pixels.
  - The blur covers about 360x820 CSS px (4x that in device pixels on an iPad) every composited
    frame while the flame converges.
  - Busy states go solid.
- **Default.** Off, behind a "Glass panels" setting, until the phase 2 device numbers are in.
- **NavRail.** It stays opaque: it is narrow and it is navigation, with nothing worth showing
  through it.

**Phase 3: dialogs and sheets on touch layouts** (M-L)

- **What changes.** The Modal primitive (`Modal/Modal.module.css:1-48`: one class, 32 call sites)
  gets a glass variant, touch layouts only:
  - `.modal` becomes `panel`.
  - `::backdrop` drops from an 80% dim to `--la-scrim-dim`. A glass dialog blurs its own
    backdrop, so a heavy dim would make it read flat.
- **First: move fixed-position children out of the dialog.** `backdrop-filter` makes the dialog
  the containing block for fixed children, so they must move to a Portal first:
  - FramePreviewGallery `.hoverOverlay`, which is placed from clientX/Y.
  - FramePreviewGallery `.hiddenRenderer`.
  - Also check CodeMirror tooltips in the custom-variation and migration dialogs.
- **Open and close.** `startViewTransition` freezes the blur into a snapshot for about 200 ms on
  open and close. Accept it, or skip the transition for glass dialogs.
- **Candidates.** WelcomeScreen and the crash overlay follow the same pattern: an opaque card over
  a blurred backdrop.

**Phase 4: desktop and the rest, optional** (M)

- **Fold the remaining copied families onto the primitive.** These are the session recorder
  pills, pilot, arena, duel, SoftwareVersion, FloatingActions and PullUpMenu. The visible change
  is small; it is mostly unification.
- **Remove blur that shows nothing.** This covers the Home section rail (it blurs a static
  gradient), the WorkspaceSkeleton sidebar, and FloatingActions in the light theme.
- **Leave these opaque.** The desktop sidebar and timeline stay opaque: they are text-dense,
  have light-theme looks, and sit in columns beside the canvas.
- **Leave these alone on purpose.** DuelChips' panel and the duel result card are opaque by
  design: "contrast there is not negotiable".

## 5. Performance rules

Each rule comes from one of the earlier cuts.

1. One glass layer. The nested rule enforces it.
2. Real blur only on chrome up to about the size of the rail sheet at peek. Larger panels take
   the busy switch.
3. Fade the glass element itself, never an ancestor. An ancestor below opacity 1 is a backdrop
   root and flattens the blur (`51367f0d`, `EditorRail.module.css:38-46`).
   - Known offenders: the recorder `.dock` opacity; the inline opacity on the view-controls strip
     and the timeline (`WorkspaceBottomBar.tsx:179-180`, `253-259`); `CollapsibleCard .dimmed`;
     Arena `.isClashing`.
4. No fixed-position children inside a glass element. Portal them, as TouchHUD and ShellBar
   already do (`App.module.css:181-197` explains why the canvas pan avoids its container).
5. Blur only what shows art. No blur over flat backgrounds, and none at 96% fill.
6. Watch the clips. `overflow: hidden` and `contain: paint` clip glass edges and shadows (the
   EditorRail sheet, TabletDeck, CollapsibleCard, `.canvas-container`).

## 6. Platforms

- **iOS, Reduce Transparency.** `lumen.css:294-298` says WebKit exposes
  `prefers-reduced-transparency`. That is unverified, and may be wrong. Check it on an iPhone.
  If WebKit does not expose it, the native shell reads `UIAccessibility.isReduceTransparencyEnabled`
  and sets an attribute on `<html>` that the tokens honour.
- **iOS, stale swapchain.** WebKit shows stale WebGPU buffers when a canvas is not presented
  every frame (PR #63 fixed the editor with a present pump; the explorer has none). A
  CoreAnimation blur over an idle WebGPU canvas is untested. Check on a device before phase 2.
- **iOS, web below 18.** It reads only `-webkit-backdrop-filter`, which the build drops (section
  3), so it shows no blur. It has no WebGPU either. The native build targets iOS 26.
- **Android.** Mid-range GPUs are the worst case for blur. The shell bar is already an opaque
  Material bar there (`ShellBar.module.css:221-285`). Default the large panels on Android to
  `flat` or `solid` until measured.

## 7. Verification

**In CI**

- **Glass guard test** (`styles/designSystem/glassBlurs.test.ts`). It enforces three things:
  - Literal `backdrop-filter` declarations outside the primitive can only go down (a ratchet
    from 59, pinned exactly).
  - Every blur has its `-webkit-` twin with the same value, in a stylesheet rule or an inline
    style object.
  - In a stylesheet, the `-webkit-` spelling comes first (section 3).

  A static "no module nests its own glass" check was not built. The primitive's nested rule
  flattens any glass class inside another at run time, which a static check could not see
  through anyway (nesting happens across components). A literal blur inside glass is not caught;
  the ratchet pushes those toward zero. The test reads the tree, so it is registered in
  `scripts/always-on-tests.mjs`.

- **Contrast test** (`styles/designSystem/glassContrast.test.ts`). The table in (c), computed
  from `lumen.css`. It checks that every text tier
  allowed on each glass tier meets 4.5:1 over white and over black.
- **Busy-switch tests.** Unit tests for which states set the busy attribute.

**Headed browser, each phase** (standalone script, never `playwright test`)

- **Viewports.** Phone 390x844, tablet 820x1180 and 1180x820.
- **Conditions.** Light and dark, and a bright flame and a dark one.
- **Output.** Before and after screenshots.

**On devices (maff)**

- **Hardware.** An iPhone on iOS 26, an iPad and a mid-range Android.
- **Frame time.** Measure it in Safari Web Inspector or Chrome DevTools:
  - with glass off, `flat` and full;
  - over a converging flame and over an animating one.
- **Accessibility settings.** Reduce Transparency and Increase Contrast.
- **The stale-swapchain check** above.
- **Decision.** These numbers decide the phase 2 default and the phone sheet past peek.

## 8. Found on the way, out of scope

- **Unused code.**
  - `components/BenchmarkButton/*` and `components/Timeline/TimelineRuler.*` have no users.
  - These rules in `ArenaOverlay.module.css` have no references: `.header` (241-253),
    `.spectatorTopBar` (1080-1092), `.spectatorHud`, `.spectatorStage`, `.commentaryBox` and
    `.roundsBar`.
- **Undefined class.** `ArcadeModePanel.tsx:411` and `:470` use `ui.soloDuelButton`, which
  `ArcadeHub.module.css` does not define.
- **Unreachable branch.** The SoftwareVersion touch branch (`SoftwareVersion.tsx:193-195`) never
  runs, because `isTouch()` and `hideTrigger` are both `isTouchLayout`.
- **Token name collision.** PopulationSimulator redefines `--la-surface` and `--la-hairline`
  locally. The shared rules would pick those values up inside it.
- **Undefined variables.** Several modules read `--color-*` and `--accent` variables that are
  never defined, so they show their dark fallbacks in the light theme too.
