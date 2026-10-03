# Gummy bear study

Open `/gummy` for four interactive gummy experiments. **Continuous jelly** remains the default. **Particle jelly** adds a separate material-point study. **Fine crush** and **Limb pull** preserve the earlier regional fracture models. The existing glass pawn, fractal figurines and chess board remain available through their original routes.

Select **Particle jelly** and **Demo tear** for the new local-pull study. Continuous jelly has separate squeeze and stretch tests. In Fine crush, a visible plate descends, holds, retracts and leaves fragments to settle. Limb pull preserves the original right-arm demonstration with anchored feet. **Reset bear** restores the solid. **Grab & pull** supports a mouse or touch; **Orbit** turns the view and supports pinch zoom. Blue, Amber and Berry use one volume dye. Candy uses amber feet, a green body and pink/cherry head; Lagoon uses amber, turquoise and cobalt layers. **Marble**, the default, follows the selected chess reference with amber and berry jelly crossed by a flowing turquoise ribbon. The colours are attached to undeformed material coordinates, so they move with the body. Softness changes the material's shear response. Turn off **Allow tearing** and reset to compare the same loading with an undamaged control.

Keyboard, with the canvas focused: D starts the demonstration, Space pauses, R resets, arrow keys orbit, and + / - zoom.

## Worktree separation

The frozen chess/material baseline is `/home/maff/.codex/worktrees/984d/chaos-master-fp` on `feat/chess-material-studies`. Its existing preview remains on port 5198: `/chess` is the board, `/chess?view=study` the glass pawn, `/pawn` the forge and `/figurines` the gallery.

Continue gummy fracture development in `/home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp` on `feat/gummy-fracture`, with its own preview on port 5199. Both worktrees were copied from the same complete working state and retain the chess routes. All development is still uncommitted; the branch names do not yet represent committed feature checkpoints. A verified archive of all 229 changed/untracked files and the tracked diff is stored in `/home/maff/.codex/worktree-snapshots/chess-gummy-2026-10-03-ql4yfr52`.

Keep new fracture work in `simulation/gummy`, `components/GummyBear` and `pages/GummyBear`. The only direct chess rendering dependency is `displayColour` from `components/PawnBoard/pawnGlassMaterial.ts`; leave that helper unchanged during gummy development. Later, connect the gummy renderer/solver to the chess capture action through an explicit material mode, preserving the existing glass/fractal mode. Shared routing changes need the existing route tests.

Gummy continuation preview:

```sh
rtk proxy timeout 10800 env VITE_GA_ID= pnpm --dir /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp --filter chaos-master start --host 0.0.0.0 --port 5199 --strictPort
```

Open `https://192.168.178.33:5199/gummy` on the LAN or `https://localhost:5199/gummy` locally. This separate server stops three hours after launch or with Ctrl-C.

## Run the original baseline locally

```sh
rtk proxy timeout 10800 env VITE_GA_ID= pnpm --dir /home/maff/.codex/worktrees/984d/chaos-master-fp --filter chaos-master start --host 0.0.0.0 --port 5198 --strictPort
```

Local URL: `https://localhost:5198/gummy`. On the current LAN: `https://192.168.178.33:5198/gummy`. The command stops after three hours; Ctrl-C stops it earlier. The strict port prevents quietly starting a different server.

## Continuous jelly comparison

Continuous jelly uses one conforming tetrahedral body with shared nodes across
all internal faces. Its stable Neo-Hookean XPBD material separates shear and
volume response. The squeeze test lays the bear down without anchors; the
stretch test stands it upright with fixed feet. Neither test enables tearing.
The current solve uses 24 iterations per 1/120-second tick. The native stretch
capture recovered to roughly 98% of rest height and 99.97% of rest volume after
release. Small boundary tetrahedron inversions remain a limitation; the solver
does not provide an inversion barrier or a calibrated viscoelastic material.

`gummy-jelly-verification.json` contains the native GPU measurements, preserved
regional-mode controls, and input checks. `gummy-jelly-squeeze.mp4` and
`gummy-jelly-stretch.mp4` are fixed-step captures, not playback-speed benchmarks.

## Particle jelly comparison

Particle jelly samples the bear's volume and transports the material with a
three-dimensional MLS/APIC material point method. Quadratic particle/grid
transfers update a temporary velocity grid. Nodes gather mass and momentum in
floating point from spatially binned particles; integer atomics only link the
bins, avoiding quantization of small contributions. Each particle retains its
deformation gradient and material-space dye. It has no predefined tear faces.

The material uses compressible Neo-Hookean stress. Excessive isochoric principal
stretch irreversibly reduces shear stiffness while retaining mass and bulk
resistance. This is an experimental strain-softening law in study units,
without fracture-energy calibration, a phase field, or a viscoelastic internal
variable. Disabling **Allow tearing** disables new softening; reset before
comparing to remove any damage already accumulated.

**Demo tear** applies a local side pull, holds it, releases the handle and lets
the body recover. The feet are anchored. Material motion comes from the solver;
the handle trajectory is the only prescribed motion. Numerical guards and
domain contacts are exposed in development readback and must be assessed along
with the visible result.

The new renderer reconstructs a compact density surface from volume-normalized
particle kernels. A bounded depth search finds the material surface within the
projected support, then coverage and depth-discontinuity checks constrain its
smoothing. The kernel and its first derivative vanish at the support boundary.
Its analytic ray integral estimates optical thickness, so a gap between separated
blobs is not counted as absorbing jelly. Integrated material-space dyes,
Beer-Lambert attenuation, studio reflections, approximate refraction and floor
shadows provide the material appearance. This renderer does not yet add physical
caustics or multiple scattering. The original tetrahedral renderer remains in
use for the other three models.

This method still has a finite sampling scale. Sphere supports can overlap
across small gaps, and the single velocity grid can couple nearby fragments.
Rounded rendered surfaces do not imply surface tension, crack-aware contact or
resolution-independent fracture. The benchmark reports geometric connectivity
at a stated neighborhood radius rather than claiming exact fragment topology.

### Particle verification, 3 October 2026

The current study uses 2,445 material points, 0.08 sample spacing, a 0.16 grid
spacing and 29 CFL-derived microsteps per 1/120-second tick. Native AMD WebGPU
checks include a ten-second idle test, a twelve-second tear and the same pull
with damage disabled. All 26 solver-only samples have finite state, fixed
anchors and zero speed clipping, affine caps, deformation rejection or domain
corrections. Independent translation and affine-transfer probes have errors
below 4.2e-8. Sampled elastic, kinetic and gravitational energy decreases after
the undamaged control is released; the rebound uses stored elastic energy.

The undamaged control stays connected and recovers 99.9% of its rest height,
with mean volume ratio 0.99763. The tear releases a group of 159 particles from
the 2,286-particle main body, with mean volume ratio 0.99751. All particles retain
their mass. These are geometric groups measured at a 1.9-spacing neighborhood,
not exact crack topology or a guarantee for arbitrary user loading.

`gummy-particle-solver-verification.json` records the independent solver checks.
`gummy-particle-verification.json` records the full native renderer, enabled and
disabled damage controls, mouse and CDP touch pulling, keyboard, orbit, pinch,
pointer cancellation, all four model switches and phone/tablet layouts.
`gummy-particle-demo.mp4` contains 360 actual renderer frames at 30 fps. It is a
fixed-step twelve-second capture, not a real-time performance measurement.
The separate production run completes twelve simulated seconds in 12.01 wall
seconds on this desktop's native AMD RDNA 4 GPU, with no browser errors or
warnings and without development hooks. Its report is
`gummy-particle-production-verification.json`. Phone/tablet viewport checks do
not establish performance on physical mobile hardware.

```sh
rtk proxy timeout 600 env GUMMY_BASE=https://localhost:5199 GUMMY_REQUIRE_ZERO_GUARDS=1 node /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp/packages/app/scripts/verify-gummy-particle-solver.mjs
rtk proxy timeout 900 env GUMMY_BASE=https://localhost:5199 GUMMY_VIDEO=1 node /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp/packages/app/scripts/capture-gummy-particles.mjs
```

The focused suite passes 188 tests in 21 files. The first `pnpm check` passes
typechecking, lint (zero errors, 85 warnings), formatting and WGSL-property
validation. Production capture then caught a missing implicit arithmetic helper
in a function shared by CPU and GPU; explicit `std` operations preserve the
formula and fix the production runtime. Its nine focused tests pass again.
The full 188-test suite also passes after that fix. The repeat aggregate check
passes typechecking but exhausts its hardcoded 4 GB lint heap. The same full
ESLint pass succeeds with `NODE_OPTIONS=--max-old-space-size=8192` (zero errors,
85 warnings), followed by successful formatting and WGSL validation. The
production build and generated agent-index check pass.

This pass establishes a particle material comparison. Fine strands still reveal
the finite particle supports, and surface depth smoothing is a screen-space
approximation. Before the chess shot, compare finer sampling under the same
loads, improve fragment contact and material relaxation, then test compression
and shear. The selected classic amber/berry/turquoise chess shapes remain the
target. A pawn/rook contact scene needs two-body collision and reaction forces;
the current scripted pulling handle is only a material test fixture.

## Original regional models

- Both modes use the same procedural, watertight exterior and 7,299 tetrahedra. The original limb mode has 2,410 nodes and 212 cohesive triangles. Fine mode has 4,602 nodes, 2,568 cohesive triangles and 116 regions distributed throughout the volume.
- WebGPU XPBD at a fixed 1/120-second step, with conflict-free constraint batches. Each tetrahedron has six edge-length constraints and a signed-volume constraint. This is an approximate elastic solid, not a full Neo-Hookean constitutive model.
- Duplicate nodes at region interfaces initially move together. Irreversible damage softens their coupling under load; released interfaces expose paired interior faces. Fragments remain deformable tetrahedral solids under gravity.
- Fine mode drives damage from tensile opening and tangential shear; pure compression does not directly count as opening damage. Its sixteen constraint iterations and separate shear/bulk compliance balance let the gel spread under the press. The original limb mode retains its five iterations and original material settings.
- Each connected seam patch completes its failure after 70% of its rest area has fully failed. There are 444 patches, including separate surfaces between the same pair of regions. This is an explicit approximation for the remaining small ligaments, not a measured fracture-energy model. The hardware capture checks that no above-threshold patch remains partially connected.
- Detached components use a GPU spatial hash and node-sphere contact proxies. Connectivity comes from the currently surviving cohesive faces and is checked against CPU tetrahedral connectivity. These contacts reduce interpenetration; they are not triangle collision detection or continuous collision detection, and tightly packed fragments can still overlap.
- Fine regions follow a deterministic warped Voronoi assignment of clipped grid cells. Merges must preserve a closed manifold boundary; tiny surface cells are absorbed where topology permits. This is predefined volumetric fracture, not runtime remeshing. A region can remain joined to others through surviving interfaces, so 116 regions does not imply 116 released fragments.
- The force proxy is the XPBD multiplier divided by the squared time step. Its threshold is calibrated for this mesh in study units. Normalized, regularized lumped masses and redundant interface constraints mean these values must not be presented as measured material strength in pascals or newtons.
- The press is a prescribed collider with the same lower-face height and footprint in simulation and rendering. Fine mode places the bear on its back with all nodes free, avoiding an upright soft body's accidental toppling before compression. The solver receives a rigidly rotated rest mesh; the renderer keeps the original material coordinates for its dyes and transports normals through the deformation. The prescribed plate does not respond to reaction forces; it is a repeatable material test fixture before two-body chess contact.

## What is rendered

The renderer reads the evolving solver buffers directly. Smooth cubic PN patches refine the exterior without increasing the physics resolution. Analytic rest normals are transported through the deformed triangles. Edges stay curved while their interfaces are intact, then flatten where a fully failed seam meets a tear cap. Tear shading averages only exposed boundary faces sharing the same regional node, never across separated copies. Freshly exposed faces use broader reflections and extra local dye scattering; this is an appearance approximation for a rough torn surface. The whole-cell partition still creates stepped cut geometry, and partially damaged interfaces do not yet have opening caps.

The body is filled with absorbing material: measured front/back depth drives Beer-Lambert colour attenuation, with screen-space refraction, approximate soft scattering and studio reflection cards. A spherical-chord approximation corrects optical depth on the curved exterior; flat tear caps use a slab approximation. Six samples along the rest-coordinate segment integrate layered or marbled absorption through the body. The screen-space exit buffer cannot distinguish multiple overlapping fragments and intervening air gaps. Floor shadows and a single-interface caustic projection follow the current shape. These are real-time approximations, not a path-traced or multiple-scattering reference render. No image-generation video is used for the motion.

## Verification and captures

`gummy-study-verification.json` records the headed hardware-WebGPU run, deformation samples, tear connectivity, volume, anchor preservation and input checks. `gummy-solver-calibration.json` records the idle and enabled/disabled tearing controls. The capture script uses a separate hidden agent browser and closes it in `finally`:

```sh
rtk proxy timeout 480 node /home/maff/.codex/worktrees/984d/chaos-master-fp/packages/app/scripts/capture-gummy-study.mjs
```

The script advances the actual solver in fixed steps for repeatable screenshots. Hidden-window animation timing is not a frame-rate benchmark. Phone/tablet viewport and CDP touch checks do not replace testing on a physical tablet.

The screenshots named `gummy-study-*.png` include the UI; `gummy-bear-intact.png` and `gummy-bear-tear.png` show the canvas. All are captures of the native renderer.

Focused tests cover solid volume and watertight boundaries, conflict-free batches, elastic recovery, damage irreversibility, GPU shader resolution, curved surface continuity, allocation cleanup, pointer maths, controls and routing. Required repository checks and a production build are also run before handoff.

The previous limb-study baseline passed 149 tests across 11 files. Its repository typechecking passed. Its standard `pnpm check` reached lint but exhausted the hardcoded 4 GB heap; rerunning the same full ESLint pass with `NODE_OPTIONS=--max-old-space-size=8192` passed with zero errors and 79 warnings, followed by successful formatting and WGSL validation. Its production build and agent-index check passed. `gummy-study-production-verification.json` records hardware rendering of that earlier build. The new crush study has separate verification below.

`gummy-fracture-verification.json` records the fine mesh, actual damage-based connected fragment counts, signed-volume changes, floor/plate penetration, tearing-disabled control and original pull regression. Run the current capture from any directory with:

```sh
rtk proxy timeout 600 node /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp/packages/app/scripts/capture-gummy-fracture.mjs
```

The final sixteen-iteration hardware run produced 44 connected fragments after
11.53 simulated seconds. The largest retained 33.08% of the original rest volume;
2,129 of 2,568 cohesive faces had failed. Signed volume recovered to 99.84% after
release, but fell to 82.78% at maximum compression. This remaining loaded-volume
loss is a solver limitation. At rest for ten seconds, no interfaces broke. With
tearing disabled, the full loading cycle left one connected body and no failed
interfaces. The original limb-pull control still separated into two components.
All sampled coordinates and damage values were finite; the GPU component graph
matched the CPU connectivity analysis, and no failed patch retained an
above-threshold ligament. Sampled plate/floor penetration was zero apart from
floating-point error.

[`gummy-fracture-demo.mp4`](gummy-fracture-demo.mp4) is an 11.5-second, 30 fps
capture of the actual solver and renderer, advanced at fixed simulation steps.
It is not evidence of real-time playback speed. To regenerate the video, add
`env GUMMY_VIDEO=1` after `timeout 600` in the command above. The cut surfaces
still look angular and faceted, with bright interior reflections. They need
further geometric and optical refinement before the intended soft, tacky gummy
appearance or a finished chess reply video is achieved.

The current repository typechecks, focused gummy/routing tests, formatting,
WGSL validation and production build passed. The initial `pnpm check` stopped
at eight lint errors in the capture scripts; those were fixed and the affected
scripts passed ESLint. The full lint pass reported 82 warnings. One scene test
still expected the earlier press midpoint; its expectation was corrected and
the scene tests passed again. No full test suite or CI run is claimed.

The owned hardware capture browsers use `--disable-frame-rate-limit` and
`--disable-gpu-vsync` alongside the hidden-workspace flags. Without those two
flags, this desktop's hidden Wayland surface delivered roughly one animation
frame per second even while `document.visibilityState` was `visible`, causing
the fixed-step catch-up limit to slow the test. The browser stays on
`special:agents`; this does not change the application clock or solver.

The final full capture passed its physics, legacy comparison, mouse, keyboard,
CDP touch, pinch, cancellation and responsive-layout checks with no reported
errors or failures. Responsive automation waits for both the control owner and
the debounced canvas buffer resize before interacting or capturing a frame.
The final production verification is in
[`gummy-fracture-production-verification.json`](gummy-fracture-production-verification.json):
the 9.6-second demonstration took 9.614 wall seconds on this desktop's AMD
RDNA-4 adapter; the development hook was absent; desktop, tablet and phone
controls were styled with no horizontal overflow. Its browser reported no
errors or warnings. A final explicit float cast removed the surface-mask
conversion warning without changing its zero/one values; all 24 surface-math
and shader tests passed again, followed by a fresh build and this production
run. Physical-tablet performance remains unmeasured. Temporary production
preview servers and owned test browsers were closed after verification.

## References and next scope

Three ChatGPT image-generation concepts are saved in `references/gummy-chess/`:

- [A: Bear court](references/gummy-chess/a-bear-court.png), closest to the supplied bulky rainbow bear.
- [B: Candy Staunton](references/gummy-chess/b-candy-staunton.png), classic chess silhouettes with blue, turquoise and amber layers.
- [C: Marbled jewels](references/gummy-chess/c-marbled-jewels.png), berry/amber forms with a turquoise ribbon.

These are aspirational design references, not renderer screenshots. Their [complete prompt set](references/gummy-chess/prompts.json) records the built-in image-generation workflow. They are saved for the next modelling pass.

**Selected by the user:** [selected-gummy-chess-reference.png](references/gummy-chess/selected-gummy-chess-reference.png), the exact Marbled Jewels image confirmed by reattachment. The target is classic chess forms with rich amber and berry jelly, flowing turquoise bands and a thick glossy feel. The bear remains the material and deformation testbed before that modelling pass.

The visual starting point is [Carolina's gummy demonstration](https://x.com/Cora_Mat/status/2106239215495450993). The research did not establish a public implementation for that exact clip. This study is an independent implementation, informed by [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf), [stable Neo-Hookean simulation with XPBD](https://matthias-research.github.io/pages/publications/neohookean.pdf) for the Continuous jelly material, and [Curved PN Triangles](https://alex.vlachos.com/graphics/CurvedPNTriangles.pdf) for the tetrahedral studies' rendered surfaces.

After judging this single-bear study, the next step is contact between two gummy bodies and one short capture action. Chess-specific silhouettes and a board can then reuse the material and simulation pipeline.

The first chess shot should use the selected classic marbled pawn and rook. Build watertight rest solids and their fracture meshes, retaining material-space colours; use the existing board and camera as the stage. Start with a prescribed rook motion against a deformable pawn, then add two-way body contact before treating it as a playable capture. The shot needs a clear approach, compression, tearing, fragment settling and a short final hold. The original fractal/glass pieces stay selectable for comparison.
