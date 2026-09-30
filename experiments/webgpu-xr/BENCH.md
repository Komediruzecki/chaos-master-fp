# Orb specimen bench

The `/bench` route is a desktop study of three reproducible fractal forms. It
implements the first orb study and part of the presentation study from the
[visual feasibility plan](/home/maff/.dotfiles/personal/lumen-meta/22-visual-feasibility-and-desktop-benches.md).
Use it to choose a core worth developing into an Almanac collectible.

This work lives on `feat/orb-specimen-bench`, based on
`feat/webgpu-xr-music-orb` at `e2e7c32849af75a1a5fa8d7419cf03c257eb9515`.
The original music/XR lab remains at `/`. The bench has no XR entry or audio;
its still view separates form and rendering from musical motion.

## Open the study

From any working directory:

```sh
rtk proxy pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr install --frozen-lockfile
rtk proxy timeout 14400 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec vite --host 0.0.0.0 --port 5192 --strictPort
```

Open [the specimen bench](https://localhost:5192/bench) in a WebGPU-capable
browser. The local development certificate may need trust. The server expires
after four hours; Ctrl+C stops an interactive restart. The strict port fails
if another server already occupies 5192. No environment values are required.

## A five-minute inspection

1. Turn off **Orbital rings**, leave **Star field** off, and select **Ivory**.
   Compare Aureole, Thicket and Vesper using **Front**, **Side** and **Above**.
   Look for a recognizable silhouette and interesting gaps at each angle.
2. Drag with the mouse or one finger to orbit. Scroll or use **View distance**
   to get closer. Focus the canvas to use arrow keys for orbit and `+`/`-` for
   distance. **Reset view** restores the front camera and stops rotation;
   it does not reset the recipe or presentation settings.
3. Keep the same seed and view. Compare 32,768 and 131,072 points, then try
   524,288 as an experimental desktop count. Change **Point radius** separately
   in **Sampling and depth**. Notice detail and dark spaces, not just brightness.
4. Switch between **GPU generated** and **CPU cached**. The CPU reference is
   built in a worker on demand; the GPU specimen stays visible while it builds.
   **Rebuild same specimen** should preserve the form. Rotation starts off and
   does not resample the cloud.
5. Try a color palette, then enable the rings. From **Front**, compare the
   opaque depth probe in front of, through and behind the core. Save the most
   useful view with **Save study settings** and note what you would change.

The depth probe positions are in world coordinates. After orbiting, “front”
does not mean in front of every possible camera. Return to **Front** for a
matched comparison.

## What is being rendered

| Layer              | Implementation                                                        | What it establishes                                             |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Aureole            | Six contracting branches with the app's `swirl3D` variation           | A repeated radial form with curled inner structure              |
| Thicket            | Four affine branches adapted from the Barnsley fern, extended into 3D | A branching alternative with a distinct side view               |
| Vesper             | Octant folds, `swirl3D`, `sphere3D` and an inner contraction          | Folded outer lobes and a repeated inner shell                   |
| Orbital rings      | Two procedurally authored solid tori                                  | Optional framing, separate from the mathematical core           |
| Opaque depth probe | A plain solid bar/plane sharing scene depth                           | A minimal test of solid-object occlusion through the flame      |
| Background         | Neutral background or screen-space stars                              | A presentation comparison, without a 360-degree sky or parallax |

The small recipe set is not arbitrary editor-flame import. All three generate
retained world-space points through repeated transforms. CPU and GPU share the
recipe and seed schedule; floating-point differences can remain between them.
Each chain discards 64 burn-in steps and retains 32 samples. A recipe, seed or
count change builds a new cloud. Camera, palette, exposure, point radius and
ring changes reuse it.

One TypeGPU renderer owns compute, camera, opaque depth, luminous points and
the final image. The opaque rings/probe write depth; the additive point
billboards test against it without writing their own opaque surface. The
scene accumulates into an `rgba16float` target and resolves to the canvas.
This is an experimental display treatment, without glass refraction, a
physically based material system or full volume self-occlusion.

Point energy compensates for sample count and footprint area. This reduces
the chance of choosing a denser cloud merely because it is brighter; it is
not an exact perceptual brightness match. Exposure remains independent.
The two point buffers are allocated for the maximum count, totaling 16 MiB
before render targets and other resources. Choosing a lower draw count does
not reduce that fixed allocation. Canvas resolution is capped at 1.5 times
its CSS size per axis.

## Saved study and evidence

The JSON download includes a schema/version, recipe identity/version, seed,
count, palette, exposure, point radius, camera, framing settings and a runtime
snapshot. It is a record for reproducible review, with no import UI yet.
It does not contain a model, rendered portrait or GPU resource. Names remain
specimen names; no assignment to the seven musical regions is implied.

The footer reports recent desktop frame intervals. These include browser
scheduling and are **not GPU timings**. The export also records adapter
information and generation statistics. `generationSubmitMs` measures CPU-side
compute-command preparation, not completed GPU generation. Compare repeated
views under the same viewport and settings; do not infer a Quest budget.

The 30 September 2026 desktop hardware verification passed in headed Chrome
using Vulkan on AMD RDNA4. The [local report](/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/bench/verification.json)
records no unexpected browser/GPU errors. It compared 32,768 CPU/GPU points
per recipe, with these maximum component errors:

| Recipe  | Maximum error | Repeated GPU build               |
| ------- | ------------- | -------------------------------- |
| Aureole | `2.83122e-7`  | Exact match on the tested device |
| Thicket | `4.17233e-7`  | Exact match on the tested device |
| Vesper  | `2.98023e-7`  | Exact match on the tested device |

Camera, palette and ring changes preserved generation. The 512 × 512 hardware
depth probe revealed 134 measured cloud pixels with the bar behind and 102
with it through the core; 52 remained occluded in the through case. Moving
to a side view changed 27,366 framebuffer pixels. These are bounded probe
results, not validation of arbitrary transparent scenes.

The verifier also passed keyboard orbit, CDP-emulated touch drag, JSON export,
524,288-point rendering, and the visible error/disabled controls after an
intentional GPU device destruction. Layouts at 1440 × 950, 820 × 1180 and
390 × 844 had no overflowing controls or horizontal page overflow. The
production build's cached-worker and control smoke checks passed, as did
the original `/` XR lab's desktop GPU mode. No physical touch device was used.

Recorded code checks: 32 unit tests, lab typecheck/build, focused lint, root
typecheck, formatting, WGSL validation and generated-index checks passed.
The first aggregate preparation run found lint errors in the new code;
those were repaired and the focused lint rerun passed. This record describes
the completed constituent checks rather than claiming that first run passed.

To repeat the browser verification with the development server running:

```sh
rtk proxy env VERIFY_BASE_URL=https://127.0.0.1:5192/bench VERIFY_OUT_DIR=/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/bench timeout 300 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec tsx scripts/verifyBench.ts
```

This standalone verifier uses the hardware browser path, not the repository
Playwright configuration. The recorded hidden-workspace frame intervals were
approximately 1,000 ms because the desktop browser was throttled. They are
not a performance benchmark and must not be interpreted as normal drawing
speed or a Quest result.

Local verification captures belong in the ignored `webgpu-verify-out` output,
separate from generated concept art. Neither screenshots nor desktop frame
intervals establish headset support, stereo quality, hand input or comfort.

## The next decision

Choose the most convincing form **without rings**, then decide whether its
ringed version adds enough to keep. Save a preferred close view and a smaller
book-sized view. If none works, revise that recipe before building scenery.

The next bounded scene is one fixed-open Almanac spread with two entries:
select a world, inspect its orb, play/stop its motif, return it to its dock.
That will test solid book integration and listening together. Book modeling,
page materials, shape editing, seven finished identities and game encounters
remain later work. No Meshy credits or new generated media are required for
this bench, and it makes no final scene-engine commitment.
