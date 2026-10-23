# Blue branching pawn: rendering research and design decisions

The approved reference is `references/glass-branch-pawn-core-study-v2.png`.
It is an image-generation design target. Runtime screenshots are captured
separately from the application and must not be presented as equivalent output.

## Glass, lighting and colour

Glass needs an environment to reflect. The live material uses an authored
studio illumination field with a broad key, a narrow rim card and an overhead
fill. Their role is to describe the shell while leaving the centre readable.
This is a procedural lighting environment, not a measured HDR panorama.

The dielectric index is 1.5. Normal-incidence reflection at one interface is
`((ior - 1) / (ior + 1))²`, or 4%; reflection increases toward grazing angles.
The renderer evaluates Fresnel reflection and keeps the scene in linear HDR
until one final filmic mapping and sRGB display conversion. The board uses a
GGX specular response. These choices follow the treatment of energy and colour
in [Filament's rendering reference](https://google.github.io/filament/main/filament.html).

The pawn is a hollow shell, with an approximately 18 mm authored wall at this
human scale. Refraction and absorption must use the wall rather than treating
the whole pawn as solid tinted glass. A separate pass records the nearest
back-facing shell surface and its instance ID; only a matching ID can supply
the front wall's thickness. A bounded fallback handles silhouettes and overlaps.
Beer–Lambert attenuation controls tint by optical path length, following
[Filament's material model](https://google.github.io/filament/Materials.md.html)
and [KHR_materials_volume](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md).

The live refraction is a screen-space thin-wall approximation. Snell's law gives
the in-wall direction; the reciprocal exit produces a lateral sample offset.
The two-interface reflection approximation is `2R / (1 + R)`, as described by
the thin dielectric model in [PBRT](https://www.pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF).
The scene texture contains the board, fractal points and shards. It does not
contain recursively refracted glass. Mutual refraction between pawns, internal
multiple bounces, dispersion, traced caustics and point-to-glass illumination
are not simulated. The soft board shadows are authored contact/height cues.

The GLBs carry portable PBR material parameters and embedded maps using
[KHR_materials_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md),
[KHR_materials_ior](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md)
and volume metadata. A loader's own lighting, transmission and point rendering
determine its appearance; the custom WebGPU studio shader is not embedded in GLB.

## Fractal anatomy

The core uses native 3D IFS transforms and independent chaos-walk groups for
its branching anatomy. The body must have open gaps and repeated forks that
remain visible at several scales. Whole pawn instances are not used as branch
elements. Frost and Ember vary colour while sharing their geometry.

An IFS is defined by its contracting maps; the invariant set and sampling
measure are related but distinct. Changing map probabilities changes which
parts dominate a finite render. Bounds therefore need both a domain argument
and tests of the production point sampler. This distinction follows
[Hutchinson, Fractals and Self Similarity (1981)](https://maths-people.anu.edu.au/~john/Assets/Research%20Papers/fractals_self-similarity.pdf).

The first live draft showed why those tests are not sufficient for art
direction: mathematically bounded maps still produced a needle-like stem and
radial star clusters. Narrow fern recurrences also proved too leaf-like. The
revised direction uses bowed affine-IFS stalks, staggered recursive canopy
branches and fern roots. Both the native accumulation preview
and the board's finite coloured point sample are inspected without glass before
approving the combined appearance.

The live core and exported core remain coloured points. They are not a closed
branch mesh or a physical fracture volume. Existing glass shards come from the
same shell grid as the intact surface; the existing core burst remains an
animation effect. Address-based coherent branch fracture is a separate next
step, not a claim of this rendering pass.

## Verification policy

Runtime appearance is checked in standalone Chrome on the real GPU, including
glass on/off, orbit, both sides, board view, capture, resize and touch gestures.
Firefox checks cover the layout available in that browser; a WebGPU fallback
screen is not evidence of rendered GPU output. Desktop touch emulation does
not establish frame rate on a physical tablet.

GLB byte validation is followed by a fresh Blender import. The importer check
compares positions, per-point colours, shell triangles, dimensions, embedded
textures, transmission and IOR against the exported bytes. Blender's byte colour
storage is checked with its explicit sRGB quantization policy. The original
assets and design studies are preserved.

The final pass completed `pnpm check`, the production build, 180 focused app
tests and seven GLB script tests. Production Chrome on the AMD GPU reported no
validation errors or device losses across board, inspection, palette changes,
older designs, resize and touch input. Both final GLBs passed a fresh Blender
import. All 79 earlier asset files match their original hashes.

The hidden test browser delivered roughly one-second animation-frame gaps,
including on a blank page, so its frame intervals are not a game-performance
benchmark. The shatter image holds the real renderer at capture age 0.85 seconds
and verifies the actual shard draw before saving the pixels. Physical tablet
performance remains unmeasured. Full evidence and source hashes are recorded in
`blue-branch-pawn-verification.json`.

## Reviewing the result

Open `/chess?view=study` for the blue Frost pawn. Drag to orbit, scroll or pinch
to zoom, and toggle **Glass shell** to see the actual branching core. Switch to
Ember for the companion palette. **Board** returns to the playable pawn race;
**Capture demo**, then **Capture on e5**, shows the existing capture sequence.
Glass echo and Crystal lattice remain available for comparison.

The native accumulation preview is at `/figurines`, under **Glass cores**.
Its native JSON download preserves the editable transform recipe. The board
uses a finite 100,000-point sample in inspection and 32,000 points per pawn on
the board. Four CPU samples at most are cached per mounted scene; inspection
builds only the selected palette. The mathematical core is the same, but its
density-based native preview and finite point sprites have different grading.

`fractal-pawn-blue-branch-frost.glb` and
`fractal-pawn-blue-branch-ember.glb` contain separate glass and coloured-point
nodes, with three embedded PBR maps. Their JSON siblings hold the native flame
recipes. `blue-branch-pawn-manifest.json` records source and output hashes;
`blue-branch-pawn-loader-report.json` records fresh-import measurements.

To reproduce the new exports from the repository root:

```sh
rtk proxy node packages/app/scripts/export-blue-branch-pawn.mjs
rtk proxy timeout 120s blender -b --factory-startup --threads 2 --python-exit-code 1 --python packages/app/scripts/inspect-blue-branch-pawn.py -- ./assets
```

An optional output-directory argument to the exporter keeps experiments in a
separate directory. Neither command rewrites the previous pawn or figurine assets.
