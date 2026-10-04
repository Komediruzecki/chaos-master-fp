# Gummy bear study

Open `/gummy` for four interactive gummy experiments. **Continuous jelly** remains the default. **Particle jelly** adds a separate material-point study. **Fine crush** and **Limb pull** preserve the earlier regional fracture models. The existing glass pawn, fractal figurines and chess board remain available through their original routes.

**Continuous jelly** now opens in **Pull to tear** with **Grab & pull** selected. Drag the arm a short distance and release to test runtime fracture. This view has no automatic tear animation or Demo button. Its separate squeeze and stretch tests retain their intact material controls. **Particle jelly** provides the alternative material-point pull study. In Fine crush, a visible plate descends, holds, retracts and leaves fragments to settle. Limb pull preserves the original right-arm demonstration with anchored feet. **Reset bear** restores the solid. **Grab & pull** supports a mouse or touch; **Orbit** turns the view and supports pinch zoom. Blue, Amber and Berry use one volume dye. Candy uses amber feet, a green body and pink/cherry head; Lagoon uses amber, turquoise and cobalt layers. **Marble**, the default, follows the selected chess reference with amber and berry jelly crossed by a flowing turquoise ribbon. The colours are attached to undeformed material coordinates, so they move with the body. Softness changes the material's shear response. **Fragility** independently controls how readily local strain creates cracks; the high default is intended to feel like fragile, warm gummy candy. In Crumble, a low setting retains the earlier tough elastic comparison; Soft tear keeps its plastic deformation response at every fragility setting. Reset before comparing settings. Turn off **Allow tearing** and reset to compare the same loading with an undamaged control.

Keyboard, with the canvas focused: Space pauses, R resets, arrow keys orbit, and + / - zoom. D starts a demonstration only in the other comparison views; Continuous tear is manual.

### Fine geometry

The Continuous jelly pull view now opens with **Fine** geometry. **Standard**
retains the previous mesh for comparison. Switching geometry rebuilds the bear
and clears its deformation, while preserving the palette, softness, fragility
and tear-response choices. Other experiments retain their existing meshes.

Fine resamples the same implicit mould with 0.10-unit spacing instead of 0.14.
It has 4,844 initial nodes, 16,913 tetrahedra and 7,204 exterior triangles;
Standard has 2,244 nodes, 7,299 tetrahedra and 3,592 exterior triangles. This adds
real deformation and fracture degrees of freedom. The largest possible
interior facets have about half the area, and the ears and facial features
follow the mould more closely. Both use the existing curved surface patches;
this is conforming volumetric resampling, not adaptive remeshing or merely
extra shading triangles.

Both resolutions share the Standard mesh's study-mass reference. Without that
correction, the original per-mesh normalization made Fine approximately 2.12
times as dense, changing its response to gravity despite identical material
sliders. The clipped-cell mass floor is retained; the resulting integrated
density differs by less than 0.3%. The world-space picking and grip footprints
also stay the same. Fine encloses about 1.97% more volume as its approximation
converges toward the implicit mould, so it is not an identical-mass mesh of
exactly the same boundary. Conservation checks apply within each simulation.

Fine splits each 1/120-second simulation tick into two 1/240-second steps,
with 24 elastic solver iterations per step; Standard retains one step and 24
iterations. This follows the temporal-refinement approach described in
[Small Steps in Physics Simulation](https://mmacklin.com/smallsteps.pdf).
The simulation clock, pointer loading duration and material readback cadence
remain unchanged. Contact damping is normalized by elapsed time.
Both resolutions use the prior Soft tear rupture budget and the same slider
mapping. An independent similar-cell test checks equal local response to the
same strain/plastic history. The graphical damage proxy is not calibrated
physical fracture energy; matching density and time integration does not make
fragment sizes or fracture paths independent of the mesh. Crumble retains its
previous fracture law.

The [Fine idle probe](gummy-soft-fine-idle-verification.json) samples a full
60 seconds of simulated time on the native AMD adapter. All eleven snapshots
have zero accumulated plastic strain and no cracks; maximum signed-volume
error is 0.0034%, with inverted volume below 0.00041%. Smaller internal steps
removed the observed slow plastic drift. Small-amplitude high-frequency motion
remains, so this is not evidence of a fully converged static equilibrium.
The 60 simulated seconds took about 93 seconds in the diagnostic advance loop,
excluding snapshot extraction. This is a heavier comparison preset and does
not establish real-time performance, particularly on a physical tablet.

Fine costs more to simulate and render. Its crack boundaries still follow
tetrahedral faces, and small disconnected chips can remain angular. Smooth
droplet reconstruction, thin adaptive ligaments and fragment contact remain
separate work; increasing surface tessellation alone would keep the original
sharp simulated corners.

### Soft tear and Crumble

The Continuous jelly pull view now defaults to **Soft tear**. The material can
retain part of a stretched shape before separating. **Crumble** keeps the earlier
elastic, rapidly propagating fracture response for comparison. Changing the
response resets the bear while preserving the palette and slider settings.
Turning off Allow tearing in Soft tear still permits permanent deformation;
it disables cuts rather than switching back to an elastic material.

Soft tear evolves a per-tetrahedron effective inverse rest frame `Be`. The
elastic deformation is `Fe = Ds Be`. Above yield, a bounded deviatoric
log-stretch update relaxes the elastic frame while keeping its determinant,
original mass and rest volume fixed. A rest-volume-weighted local yield gate
uses the same deviatoric log-strain measure as this return law. The earlier
Frobenius-energy proxy could exaggerate a tiny, highly distorted neighbour's
influence; an analytic small-cell regression now checks that mismatch.
Rupture requires accumulated yielding, **new plastic flow and current normal
elastic tension**. Its graphical damage budget uses the current plastic
increment, rather than elapsed time acting on deformation stored from a past
pull. A stress-free permanent stretch cannot by itself continue growing a crack.
If the numerical plastic-strain limit is reached, only an increase beyond the
face's previously observed elastic opening can add further work. This opening
work is integrated over the change, so splitting the same motion into more
steps does not create extra damage. Paused or tearing-disabled observations
update the opening history without banking damage for later.
Material-space colour remains attached to the original coordinates. Plastic
memory transfers through vertex cloning and resets with Reset bear.

This is a graphics material inspired by finite-strain plasticity and
[viscoplastic finite elements](https://visualcomputing.ist.ac.at/publications/2007/FEMVisco/),
not a reproduction of that paper's adaptive remeshing or measured gummy
rheology. Updates run at the existing 20 Hz readback cadence. The tetrahedral
resolution, inversion limitations and missing fragment-to-fragment contact
still limit thin ligaments and extreme crushing.

The [Fine native report](gummy-soft-fine-verification.json) and
[Standard comparison](gummy-soft-verification.json) use the same 45-pixel arm
drag on AMD RDNA 4, with 0.6 seconds of simulated loading and two seconds after
release. At the unchanged 88% fragility setting:

| Geometry | Input          | First crack | Free components | Detached rest volume |
| -------- | -------------- | ----------- | --------------- | -------------------- |
| Fine     | Mouse          | 22.5 px     | 36              | 0.569%               |
| Fine     | Emulated touch | 22.5 px     | 28              | 0.444%               |
| Standard | Mouse          | 22.5 px     | 14              | 1.061%               |
| Standard | Emulated touch | 28.125 px   | 12              | 0.126%               |

At minimum fragility neither mesh releases material under that drag. Turning
tearing off retains permanent stretch without cuts. The acceptance floor is
the same total 0.1% detached material at either resolution, rather than a
minimum size for each chip. Connectivity is measured through shared vertices,
so point- or edge-tied material cannot count as detached from the pinned body.
Analytic fixtures check that distinction. These values describe this grip and
camera, not a universal pointer distance or resolution-independent fracture.
The Fine [held](gummy-soft-fine-hot-mouse-held.png) and
[released](gummy-soft-fine-hot-mouse-released.png) views show the actual renderer.

The [Fine Crumble comparison](gummy-hot-fine-verification.json) also passes
the same idle, short-pull, mass, colour, boundary and reset checks. The short
mouse/touch pulls release 117/107 free components, compared with Soft tear's
36/28. Crumble therefore remains the more fragmented elastic comparison;
Soft tear retains deformation before separating.

Ten-second idle controls remain unbroken at default and maximum fragility,
including maximum softness. Fine has zero idle plastic strain in all three
controls; Standard's maximum-softness control retains a small amount in two
boundary cells. Every sampled tetrahedron and its original dye coordinates
survive the tests. Fine's maximum signed-volume error is 0.048%, with inverted
volume below 0.00124%; Standard stays below 0.061% and 0.00370% respectively.
Reset clears plastic memory. Native mouse, emulated touch, cancellation, pinch,
keyboard, comparison models and responsive layouts pass with zero browser
errors or warnings. This does not establish physical-tablet performance.

Current verification: 318 focused tests in 34 files plus six independent
topology tests pass. Full repository typechecking, formatting, WGSL validation,
documentation-index checks and the production build pass. `pnpm check` still
exhausts its hardcoded 4 GiB lint heap; its complete ESLint pass succeeds at
8 GiB with zero errors, and its remaining checks pass separately.
No full test suite or CI result is claimed.

The [production smoke report](gummy-soft-fine-production-verification.json) confirms
the built app works without the development hook: a real 45-pixel pointer drag
causes runtime topology replacement, the phone/tablet controls fit, and the
native adapter reports zero browser errors or warnings. Detailed conservation
and detached-volume evidence comes from the development run above. Owned test
browsers and the temporary production server are closed; the separate LAN
development preview remains running under its launch timeout. No new video
was generated for this pass.

### White-face diagnosis

Same-state diagnostic renders separated flat dye, face provenance, normals,
specular reflection and optical path. Flat dye coloured the offending faces;
removing specular reflection did not. The large pale foot triangles came from
other fragments overwriting the back-surface thickness lookup. The runtime
renderer now first records the nearest visible component, then selects a back
surface from that same component. This adds one raster pass only to a fractured
runtime mesh and preserves the existing screen-space transmission model.

The remaining thin exterior surfaces adjoining a tear had almost no absorption
while their new cut faces used the wet-dye treatment. Both now share that
treatment, weighted by actual opened-face adjacency. Untouched skin retains its
bulk optics and exterior Fresnel reflections. This local pigment/scattering
term is an appearance approximation; it does not invent extra geometric
thickness. A matching component can still fold over itself, so this is not
multi-layer volumetric ray tracing. Strong glints remain possible, but the broad
uncoloured faces should no longer come from another fragment's thickness data.
The [before](gummy-face-diagnostics/before.png) and
[after](gummy-face-diagnostics/normal.png) renders use identical saved geometry
and camera state. [Pixel samples](gummy-face-diagnostics/comparison.json) record
the arm and foot colour changes; the [native report](gummy-face-diagnostics/report.json)
records the GPU, hidden browser placement and zero shader errors/warnings.

## Worktree separation

The frozen chess/material baseline is `/home/maff/.codex/worktrees/984d/chaos-master-fp` on `feat/chess-material-studies`. Its existing preview remains on port 5198: `/chess` is the board, `/chess?view=study` the glass pawn, `/pawn` the forge and `/figurines` the gallery.

Continue gummy fracture development in `/home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp` on `feat/gummy-fracture`, with its own preview on port 5199. Both worktrees were copied from the same complete working state and retain the chess routes. Commit `a4004a3c` preserves the chess assets, regional fracture models, Continuous jelly controls and Particle jelly checkpoint. Runtime continuous tearing is the next working change on that branch. The earlier verified archive of 229 changed/untracked files and tracked diff remains in `/home/maff/.codex/worktree-snapshots/chess-gummy-2026-10-03-ql4yfr52`.

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

### Runtime continuous tearing

**Pull to tear** starts from exactly the same welded mesh. A history of local
tensile and shear deformation across an internal tetrahedron face can fail that face. The
incident tetrahedra then split their shared vertex only when the surviving
face connections no longer join them. The full set of tetrahedra and their
rest coordinates remain; no material is deleted and no regional limbs are
separated in advance.

The tear test holds the feet and a central waist patch (`|x| <= 0.30`,
`0.85 <= y <= 1.20` in rest coordinates). The outer arm stays free. This
counterhold keeps a hand drag from simply rotating the whole bear
around its feet. The same supports and handle motion apply when tearing
is disabled, so the comparison changes only the fracture response.

Split vertices divide their parent's inertial mass by incident rest volume,
copy its velocity and retained grip offsets, and retain its material-space
colour. Paired interior triangles cover the newly exposed boundaries with
opposite outward winding. Surface smoothing follows actual live-node adjacency
so nearby crack lips do not average normals across their gap.

The CPU checks GPU deformation snapshots every six simulation ticks. A topology
change rebuilds the solver and renderer while simulation is paused, restores
the complete dynamic state, then replaces the previous pair. This is a study
implementation with occasional allocation/readback stalls, not a fully
GPU-resident fracture algorithm. Crack directions follow the tetrahedral mesh.
The strain-history rule is tuned in study units; it does not implement
fracture energy or arbitrary remeshing. Crumble remains elastic; Soft tear adds
the plastic response described above. Released chunks do not yet have robust
surface-to-surface contact.
The positive spectral part of each tetrahedron's deformation supplies a
tensor that rotates with the material. Its action along a face normal
includes tensile shear on oblique faces; all-compressive strain supplies no
drive. Adjacent tensors are averaged by rest volume. Principal extensions
are regularized by minimum tetrahedron altitude relative to a quarter of
the mesh spacing, preventing nearly flat clipped elements from amplifying
small errors into unbounded strain. This is a mesh-scale failure indicator,
not measured material toughness or a calibrated Cauchy stress.

The independent capture checks use the current runtime topology, including
mechanical connectivity through any shared vertex. Face connectivity alone can
incorrectly count fragments that remain tied at an edge or point. They also
check mass/rest-volume conservation, cap pairing, winding, material coordinates,
an idle control and the identical pull with tearing disabled.
The report distinguishes exposed crack-front edges from open holes; closed
edge winding alone does not establish a manifold boundary at every vertex.

### Earlier Crumble material pass

This section records the earlier Crumble response and its historical
verification. The newer Soft tear response is described above.

The default is a manual pull with Fragility at 88%. In Crumble, Fragility changes crack
initiation, local propagation strength and damage accumulation speed, while
Softness still controls the intact elastic response. Setting Fragility to zero
retains the earlier tough fracture law in Crumble. The interior-face graph is created
from rest-mesh edges: only a face sharing an edge with an already failed face
uses the weaker propagation threshold. Newly failed faces influence the next
assessment, not an unbounded cascade inside the current assessment. Positive
local tensile/shear strain and accumulated damage are still required; neither
a grip event nor a predefined limb automatically causes separation.

This is a mesh-scale approximation of a weakened fracture process zone. It is
not calibrated fracture energy or a physical temperature model. The distinct
initiation threshold is necessary because simply lowering every face's
strength made the intact bear accumulate damage under gravity. The lower
propagation strength lets a seeded crack grow under a short local pull.

Runtime tear caps are now subdivided curved patches. Skin and cap edges share
live-node normals and curvature bounds based on the current incident
tetrahedra, so the renderer does not insert unrelated spheres or add simulated
mass. Disconnected components carry exact optical tags: another fragment's
back surface cannot supply the current fragment's colour or thickness. The
fallback uses local tetrahedral support. Same-component folded surfaces still
share the limitations of a screen-space nearest-backface approximation; this
is not volumetric ray tracing or collision handling.

Thin runtime cut faces additionally filter their transmitted colour through
the local rest-coordinate dye. This bounded surface tint prevents the neutral
floor from overwhelming dark berry or blue pigment. It is a visual
approximation for the torn surface, not an invented optical thickness or
calibrated absorption coefficient. A nine-sample angular average around the
reflected ray softens studio-card reflections. Earlier regional materials
retain their original shading.

Verification for this pass uses real mouse and CDP touch drags rather than the
old demonstration trajectory. It checks actual mechanical detachment, an
identical tough/tearing-disabled control, rest stability, mass and rest-volume
conservation, material coordinates and exposed boundaries. The manual command
does not generate a video:

```sh
rtk proxy timeout 600 env GUMMY_MANUAL=1 GUMMY_VIDEO=0 node /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp/packages/app/scripts/capture-gummy-jelly-tear.mjs
```

The final native AMD RDNA 4 run records the following in
`gummy-hot-verification.json`. A 45-pixel outward drag takes 0.4 simulated
seconds, holds for 0.2 seconds, then releases for two seconds. The mouse test
starts opening cracks at 33.75 pixels and releases 40 unpinned components,
containing 0.876% of the original bear volume. The CDP touch test releases
46 unpinned components containing 0.800%. Total component counts also include
pinned pieces; they are not the number of free crumbs. A 100-pixel pull
releases 1.536% of the original volume. These are tests of a specific arm grip
and camera, not a universal pixel threshold at every zoom or touch position.

The identical tough and tearing-disabled pulls remain connected. Ten seconds
at rest at both default and maximum fragility cause no failed faces.
`gummy-hot-idle-verification.json` separately records the 60-second native
position replay at default softness and the native-controller test at maximum
softness; it distinguishes the two methods. All manual samples retain every
tetrahedron, conserve inertial mass and rest volume, and pass material-coordinate,
boundary and winding checks. Signed-volume error stays below 0.08% in this
fixture. Keyboard, orbit, touch cancellation, pinch, all comparison models,
and phone/tablet layouts pass with no browser errors or warnings. These touch
checks are emulated on desktop, not measurements on a physical tablet.

Visual inspection at that checkpoint showed stronger fragment dye after the
thin-face tint correction, but coarse triangular silhouettes and broad pale
faces remained. The later white-face diagnosis above identifies and corrects
the thickness and thin-skin causes.
The mouse test spends about 3.21 wall seconds in fracture checks during its
2.6-second simulated trajectory, including 1.72 seconds in resource allocation;
its longest check is about 135 ms. These diagnostic timings include readback
and replacement work, not a sustained playback frame rate. Resource reuse and
finer fragment geometry are the next priorities.

Historical verification: 251 focused tests in 30 files and four independent topology
tests pass. Repository typechecking, formatting, WGSL property validation,
documentation-index checks and the production build pass. The literal
`pnpm check` command exhausts its hardcoded 4 GiB ESLint heap. The same full
ESLint run at 8 GiB passes with zero errors and 88 warnings; formatting and WGSL
validation then complete separately. No full test suite or CI run is claimed.

`gummy-hot-production-verification.json` records the production smoke check:
the development hook is absent, a real 45-pixel pointer drag causes runtime
topology replacement, and responsive controls pass with no browser errors or
warnings on the native adapter. This is an input/rendering smoke check;
the development run above supplies the detailed detached-volume evidence.
All owned test browsers and the temporary production server were closed.
The separate LAN development preview remains available under its three-hour
timeout. No new video was generated for this pass.

### Earlier long-pull benchmark

The following section records the earlier material and renderer. Its measurements
are historical; the manual fragile-material pass above has its own report.

The earlier, tougher-material demonstration released small pieces from the stretched arm; it
does not yet consistently sever the whole arm. Its 12 detached components
contain about 0.636% of the original volume. All 7,299 tetrahedra remain in
the simulation, including those fragments. The final signed volume is
1.000026 of rest volume, and one detached component travels about
1.95 study units after release. The identical non-tearing control stays
joined and returns to 1.000044 of rest volume. Ten seconds at rest causes
no failed facets, including hidden damage in connected vertex stars.

In that earlier rendering pass, fresh cuts followed coarse, planar tetrahedral faces. They retain the
rough dyed cap material; increasing transmission made the thin facets wash
out instead of improving the gummy appearance. Smoother necking, rounded
fracture surfaces and reliable fragment contact remain separate work.

`gummy-jelly-tear-verification.json` records the native GPU controls,
conservation/boundary checks, mouse and touch pulling, keyboard, orbit,
pinch, cancellation, model switches and phone/tablet layout checks.
`gummy-jelly-tear.mp4` is a fixed-step, 12-second capture at 30 fps, not a
playback-speed measurement. CPU fracture assessment reuses scratch buffers;
saved-state comparisons match all strain values and topology events bit
for bit after that optimization.

The production run completed twelve simulated seconds in 15.28 wall seconds
on this desktop's native AMD RDNA 4 adapter, with 69 topology replacements,
no development hook and no browser errors or warnings. Fracture still causes
readback/allocation stalls, so this is not sustained real-time playback yet.
`gummy-jelly-tear-production-verification.json` records that run. Responsive
viewport and emulated touch checks do not establish physical tablet performance.

Earlier verification: 233 focused tests in 28 files plus four independent topology
probe tests pass. Typechecking, formatting, WGSL property validation, the
documentation-index check and production build pass. `pnpm check` reached
the repository's 4 GiB ESLint heap limit; the same full lint with an 8 GiB
heap passes with zero errors and 88 warnings. Its first completed pass
caught four older capture calls that needed to await the now-asynchronous
step API; those calls are corrected. The final full lint passes.

```sh
rtk proxy timeout 900 env GUMMY_VIDEO=1 node /home/maff/.codex/worktrees/gummy-fracture/chaos-master-fp/packages/app/scripts/capture-gummy-jelly-tear.mjs
```

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

The tetrahedral renderer reads the evolving solver buffers directly. Smooth cubic PN patches refine the exterior without increasing the physics resolution. The older regional models flatten edges where a fully failed seam meets a tear cap; their whole-cell partitions still create stepped cuts, and partially damaged interfaces do not yet have opening caps. Continuous runtime tears use curved cap patches with shared edge bounds and normals only across actual live-node adjacency. This softens surface shading but cannot turn a coarse tetrahedral chip into a rounded liquid drop. Most chips in the short-drag study contain only one tetrahedron.

The body is filled with absorbing material: measured front/back depth drives Beer-Lambert colour attenuation, with screen-space refraction, approximate soft scattering and studio reflection cards. A spherical-chord approximation corrects exterior optical depth; tear caps use a slab approximation. Six samples along the rest-coordinate segment integrate layered or marbled absorption. Continuous runtime fragments reject exit surfaces belonging to other mechanical components, using local tetrahedral support when no matching exit is available. The nearest-backface method still cannot distinguish folds and intervening air gaps within the same connected component; older regional models lack the component check. Floor shadows and a single-interface caustic projection follow the current shape. These are real-time approximations, not a path-traced or multiple-scattering reference render.

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

## Next steps, in order

The immediate goal is the feel of fragile, warm gummy candy under direct mouse
or finger contact. It is a stylized material target, not a claim of measured
candy temperature or experimentally calibrated fracture toughness. Keep the
four existing models available for comparison. Do not generate new videos for
each material pass; use the interactive preview and stills when a visual bug
needs diagnosis.

1. **Short, responsive crumbling.** Tune fragility separately from softness.
   Verify short drags detach actual volume while the untouched bear stays
   intact. Compare tearing off, tough material and fragile material under
   identical input. Short manual drags now release real chips. Next, reduce
   solver/renderer replacement stalls by caching invariant mesh data and
   reusing GPU resources. Fine now adds twice the surface detail with smaller
   internal time steps. Reduce its cost and residual surface vibration before
   increasing the density further.
2. **Continuous gummy surfaces.** Keep dyes attached to the material on new
   cuts. Round exposed fragment surfaces without closing real crack gaps or
   changing their simulated mass. Check silhouettes and thin fragments from
   several views; then investigate adaptive tetrahedra where necks and cracks
   form. The Fine preset already increases actual physics resolution; adaptive
   refinement should concentrate further detail where it is needed.
3. **Stretch, relax and stick.** Soft tear now adds controlled plastic memory
   before fracture. Compare it against Crumble and the intact elastic squeeze
   and stretch tests. Next, refine short ligaments and stress relaxation, then
   investigate adhesion. Improve inversion handling before stronger compression
   or a melting-looking setting; plastic memory alone does not supply viscosity,
   self-contact, remeshing or sticky bonds.
4. **Fragments and two-body contact.** Add crack-aware self/fragment contact,
   friction and a stable collision response. Test squeezing, scraping and
   crushing between two simple bodies before treating a chess capture as
   solved. Reduce readbacks and topology allocation pauses, then measure on the
   physical tablet as well as desktop.
5. **Selected chess forms.** Apply the approved classic amber/berry/turquoise
   design to a pawn and rook first. Build watertight rest solids, preserve
   material-space palettes and expose the same material controls. Bring them
   into the existing board as a selectable gummy mode alongside glass/fractal
   pieces. Extend to the remaining silhouettes after this pair behaves well.
6. **Full-board capture and final shot.** Once the material, piece contacts and
   board integration hold up interactively, stage one piece crushing/eating
   another: approach, compression, tearing, settling and a final hold. Only
   then make the polished animation/reply video.
