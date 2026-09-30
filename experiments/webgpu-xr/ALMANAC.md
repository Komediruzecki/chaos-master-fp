# Almanac selection study

The `/almanac` route develops the accepted Aureole specimen into a small
selection and listening interface. It shares the existing bench renderer,
with one live selected orb, two world studies and five future-region markers.
The fixed-open book is a CSS/DOM composition. This step tests the interaction
sequence before producing a spatial book asset.

Work continues on `feat/orb-specimen-bench`. The specimen comparison stays at
`/bench`; the existing music/XR proof stays at `/`.

## Open the study

```sh
rtk proxy timeout 14400 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec vite --host 0.0.0.0 --port 5192 --strictPort
```

Open [the Almanac](https://localhost:5192/almanac) in a WebGPU-capable browser.
The development certificate may need trust. No environment values are
required. The server expires after four hours; Ctrl+C stops an interactive
restart. The strict port reports an occupied port instead of choosing another.
For a fresh checkout, use the dependency-install command in [BENCH.md](BENCH.md).

## What to try

1. Select **Glasswake**, whose study pairs Aureole with an original Ionian
   motif. Inspect the orb, turn it to see its depth, and reset the view.
2. Start the motif explicitly, stop it, and replay it. Selecting a world
   should never start audio by itself. If the browser is still opening audio,
   **Cancel motif** prevents that pending audition from starting later.
3. Return to the spread. Selection and specimen identity should be retained;
   inspecting an orb does not award a level completion or collectible.
4. While a motif is playing, select **Tideweave**. Its Thicket study and
   original Dorian motif should replace the first selection, and the previous
   audio should stop. Play the new motif separately.
5. Inspect the five future-region markers. They indicate planned atlas
   structure, not five implemented worlds or encounters.

Glasswake and Tideweave are provisional world studies, not playable levels.
Their motif, palette and specimen assignments remain editable. There is no
microphone permission, singing assessment or game scoring in this route.

## Swapping the orb

A world record links its stable identity and text to a specimen recipe,
presentation settings and motif. These records contain ordinary data rather
than GPU resources. The selected specimen is drawn by one `BenchRuntime`;
inspection changes the presentation around the same canvas.

The specimen recipes are **not yet `FlameDescriptor` imports**. Aureole is a
bounded TypeGPU function that uses six contracting branches and the app's
`swirl3D` variation. Thicket and Vesper are two other supported recipes.
Swapping among those recipes, their seed and presentation settings does not
require rebuilding the Almanac interface.

Importing an arbitrary editor flame needs a separate adapter. The app's
`FlameDescriptor3D` describes transforms, affine parameters, variations and
optional layers; the current bench dispatches a small numeric recipe set.
An adapter must establish a supported subset, preserve stable point identity
and explicitly reject unsupported features. Reusing variation math alone
does not make the two formats interchangeable.

## Boundaries to preserve

- Selection and listening are independent. One motif can play at a time;
  changing the world stops the current audition.
- Motifs are short original synthesized sketches. The mode is a composition
  choice, not evidence of procedural sonification or music-to-fractal mapping.
- The selected fractal is live WebGPU. Book surfaces, text and region markers
  belong to the DOM; they do not share its depth buffer.
- Inspect/return keeps one render owner. It does not launch a second GPU
  renderer or represent a physical lift through 3D space.
- This route has no XR session, hand tracking, 3D book mesh, page turning,
  saved collection or level launch.

The separate specimen bench already has solid rings and a depth probe. That
earlier result does not establish depth integration for this CSS book.

## Verification and remaining review

The 30 September hardware run of `scripts/verifyAlmanac.ts` passed in headed
Chrome on **AMD RDNA4**, with no unexpected browser/GPU errors. Its
[local report](/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/almanac/verification.json)
records these results:

- [x] Glasswake starts selected with the Aureole recipe and no autoplay.
- [x] World selection changes the recipe and correct motif identity.
- [x] Inspection retains the same canvas, generation and camera; each world
      restores its own view after switching away and back.
- [x] Both motifs produce nonzero analyser activity. Switching stops playback;
      a canceled pending audio unlock cannot start later.
- [x] Future-region selection hides the canvas and pauses GPU submissions.
- [x] Layouts at widths 1440, 820 and 390 have no horizontal overflow.
- [x] Keyboard orbit, Escape with focus restoration, emulated touch drag and
      phone-sized inspect/return taps work.
- [x] Device loss is visible; the catalog remains usable without WebGPU.
- [x] The existing `/bench` and `/` routes still become ready.

Measured analyser levels were `0.2607` for `glasswake-first-light` and
`0.1447` for `tideweave-rising-sixth`. These prove that the browser generated
audio samples; they do not measure loudspeaker output or listening quality.

The package's initial full test run passed **42 tests**. After the final
audio cancellation/compatibility fix, all **11 focused Almanac tests** passed.
The suite now contains 43 cases; a complete 43-case run was not performed.
The focused tests cover recipe/mode data, silent construction, note scheduling,
superseded unlocks, stop, natural completion, visibility/platform suspension,
volume, retry and disposal during unlock. Root `pnpm check` passed with zero
errors and 80 existing lint warnings. Experiment typecheck/build and the
generated-index check also passed. The final rebuilt production flow passed
public selection, inspect/return, play/stop, cancellation of a delayed audio
unlock and a 390-pixel layout, with no recorded errors and no development
debug hook. See the [production report](/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/almanac/production.json).
Desktop, tablet and phone spread/inspection screenshots were visually reviewed.

Manual review still matters: audition both motifs, try reset/zoom after an
unusual camera angle, and decide whether the book and orb proportions feel
useful. Cleanup calls are present for the shared GPU runtime and audio owner,
and audio disposal races have focused coverage. A live component-unmount
resource audit was not performed; navigation checks do not establish one.

To repeat the development hardware verification with the server running:

```sh
rtk proxy env VERIFY_BASE_URL=https://127.0.0.1:5192/almanac VERIFY_OUT_DIR=/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/almanac timeout 300 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec tsx scripts/verifyAlmanac.ts
```

The standalone verifier uses a hardware browser, not the repository's
SwiftShader Playwright configuration. Browser touch input was emulated.
Desktop correctness establishes neither headset frame time nor stereo/hand
accessibility. No FPS or Quest performance claim follows from this run.

## Next asset study

Once the sequence feels useful, make one fixed-open book mesh with a page
block, binding, gutter and two named orb anchors. Keep labels as runtime
content. Compare dark paper/leather with a dark instrument-panel finish on
the same geometry, starting from a clay view. Then put the book and orb into
one scene/depth pipeline and test their overlap from several angles.

That asset and renderer test remains a distinct step. No Meshy asset, texture
generation or credit spend is required for this interaction study. The
[planning record](/home/maff/.dotfiles/personal/lumen-meta/24-almanac-selection-study.md)
tracks the accepted direction and remaining decisions.
