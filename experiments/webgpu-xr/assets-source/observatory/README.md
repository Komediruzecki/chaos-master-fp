# Observatory asset kit

This is the authored environment kit for the desktop observatory. The terrace has a bevelled stone slab, separated radial floor sectors, a low raised rim, sweeping rails and structural ribs, seven survey markers and an Almanac lectern. The bridge is a separate repeatable tile; the far landing is a separate platform. Broad silhouettes, actual inlaid geometry and five opaque materials per module establish the base appearance. The separate surface-data study below adds optional architectural detail.

Version 2 gives only the observation bay the Night Almanac architecture palette: black basalt, charcoal floor insets, blackened bronze rails, satin silver trim and bone enamel markers. Separate `Bay | …` materials keep bridge and landing factors unchanged. Their exported files, the celestial seed, and both Glasswake assets remain byte-identical to the previous delivery. The editable kit source includes the complete arrangement.

The visual direction comes from `personal/lumen-meta/concepts/08-seven-constellations.png` and `12-almanac-temple-teaser.png` in dotfiles. Those are concept images, not evidence of the shipping scene. The geometry intentionally leaves the sky and the live fractals unobstructed.

## Source and delivery

| Source                                          | Runtime file          | Purpose                              |
| ----------------------------------------------- | --------------------- | ------------------------------------ |
| `build_observatory.py`, `observatory-kit.blend` | `observation-bay.glb` | Terrace, rails, markers and lectern  |
| Same source                                     | `bridge-segment.glb`  | One repeatable bridge tile           |
| Same source                                     | `far-landing.glb`     | Destination pedestal and relic mount |
| `prepare_relic.py`, `celestial-seed.blend`      | `celestial-seed.glb`  | Reduced Meshy decorative seed        |

Runtime files live in `../../public/models/observatory/`. `manifest.json` describes the authored kit, coordinates and placements. `celestial-seed.manifest.json` records the provider lineage and derivative. Both record hashes and Blender version. The base meshes require no texture, decoder, skeletal animation or external buffer; the optional surface bundle is separate.

| Runtime module  | Triangles | GLB bytes | Current loader geometry bytes |
| --------------- | --------: | --------: | ----------------------------: |
| Observation bay |    16,390 |   447,332 |                     1,112,904 |
| Bridge tile     |       352 |    19,532 |                        37,120 |
| Far landing     |     3,580 |   117,344 |                       284,880 |
| Celestial seed  |    14,000 |   253,364 |                       616,000 |

Geometry bytes count the current loader's interleaved vertex and index arrays for one copy of each module. They exclude render targets, live fractals, instance uniforms and any runtime duplication.

The packed seed Blender file contains both the hidden, normalized dense donor and the visible derivative. The immutable provider GLB is retained in the registered output run, outside the repository. The terrace source contains a display arrangement of five bridge tiles; each runtime module exports at its own origin.

## Placement contract

- Runtime coordinates use +Y up, forward -Z. These are metre-oriented study units, pending physical headset scale review.
- The terrace slab is centred at `[0, 0, 0]`, radius 4.2, with its front clipped at Z = -3.7. The low rim extends slightly beyond the slab. Top floor datum is Y = 0; surface sectors and trim rise slightly above it.
- `BookMount` is `[0, 0.85, -0.1]`. The lectern supports a book approximately 2 units wide. Keep the book and its orb docks under one uniformly scaled transform.
- `BridgeMouth` is `[0, 0, -3.7]`. The open mouth is wider than the 1.6-unit bridge.
- A bridge tile spans X = -0.8 to 0.8 and Z = -0.5 to 0.5. Its main walk surface is Y = 0, slab bottom Y = -0.19; decorative lines and edge strips rise above the surface. `Entry` is `[0, 0, 0.5]`, `Exit` is `[0, 0, -0.5]`.
- Five tiles at Z = -4.2, -5.2, -6.2, -7.2 and -8.2 connect the terrace to a landing centred at `[0, 0, -10]`. Their ends slightly overlap the landing support rather than leaving a gap.
- The far landing radius is 1.35. Its `RelicMount` is `[0, 0.1, 0]` in local coordinates.
- The seed is exactly 1 unit tall, centred in XZ, with its base at Y = 0. Its pointed base needs the mount or an intentional floating pose; it is not a freestanding floor prop.
- Nearby world anchors are `[-2.8, 3, -5.8]` and `[2.8, 3, -5.8]`. The initial camera study uses `[0, 2.2, 5.8]` looking at `[0, 1.4, -3.5]`.

These are render assets. No collision system, traversal, completed bridge encounter or hand interaction is implied by an anchor or a mesh.

## Reproduction

Both scripts require explicit absolute `--source-dir`, `--runtime-dir` and `--evidence-dir` arguments. First obtain a registered `agent-out` run with adequate capacity; direct all three output directories into that run. The scripts do not fall back to the repository or `/tmp`. Use isolated background Blender, for example:

```sh
rtk proxy timeout 600 /usr/bin/blender --background --threads 8 \
  --python experiments/webgpu-xr/assets-source/observatory/build_observatory.py -- \
  --source-dir "$OBSERVATORY_RUN/deliverables/observatory" \
  --runtime-dir "$OBSERVATORY_RUN/deliverables/observatory/runtime" \
  --evidence-dir "$OBSERVATORY_RUN/evidence/observatory"
```

Run from the repository root, with `OBSERVATORY_RUN` set to the exact registered run path. The relic recipe takes the same three arguments plus `--donor /absolute/path/to/celestial-seed-original.glb`. It asserts that the donor has no image textures, normalizes the dense source, reduces to 14,000 triangles with Blender Collapse, re-normalizes the derivative after reduction, and assigns one deliberate opaque teal-bronze material. No provider generation call or credit spending is part of either script.

Append `--no-render` to regenerate source and export only. Inspect fresh exports before copying reviewed source and runtime files back to the repository. The scripts disable Blender backup copies within their isolated process.

For a scoped palette revision, `build_observatory.py --only observation-bay` exports the bay and rebuilds the complete editable source/manifest while retaining existing bridge and landing GLBs. Those sibling files must already exist in `--runtime-dir`; the option fails if they are missing. Omit `--only` for a complete reproducible kit export.

## Production findings

The first terrace pass showed twisting on nearly vertical tube ribs because a world-up frame flipped as the tangent crossed vertical. The final recipe transports the cross-section frame continuously. A bounds check also caught an oversized chamfer on the narrow bridge edge strips; corner sizes are now clamped to the section dimensions.

Fresh GLB imports were rendered with the authored materials and a neutral clay override. The source and export were inspected from the same elevated view, then the export from the proposed runtime camera. The seed was compared before and after reduction using the same clay, camera and lights, then inspected with its material from front and reverse angles. Its broad spiral blade, pointed silhouette and middle openings remain visible. The reduction does not add surface detail absent from the donor.

The geometry screen reports no non-finite, zero-area or opposing-normal flags. The inventory screen reports no dependency or structure errors. These screens do not certify collision, self-intersection, browser performance or physical-device comfort. Static material grouping is not automatically instanced rendering; the runtime owns draw and memory measurements.

All four final repository GLBs also pass the application's actual `parseBookGlb` loader. Its parsed bounds confirm a bridge width of 1.6 and a seed base at Y = 0 with height 1.0. The manifest and named nodes carry placement information; the current book parser only extracts its original two book dock anchors, so the observatory uses the placement manifest explicitly.

The GLB materials contain factors rather than baked stone, patina or roughness textures. The optional surface fields below are not embedded in those exports. The Blender studio has area lighting and shadows that the application renderer may not reproduce. Real browser inspection and headset acceptance remain separate gates.

## Observatory and temple surface fields

`build_surfaces.py` authors a separate three-layer linear data bundle for the
architectural material pass. It does not regenerate or modify any geometry,
Blender file, GLB palette, light envelope, game state or Almanac texture. The
existing resource catalog was considered; custom procedural fields fit this
renderer and the accepted architecture without introducing external assets.

| Layer                 | Authored character                                                                      | Initial material mapping                                         |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0: mineral stone      | Quiet mineral strata, fine grains and small pores                                       | Bay basalt; bridge and landing basalt/slate; temple stone        |
| 1: worked dark finish | Shallow polishing marks, small pores and finely worked surface variation                | Bay charcoal inset                                               |
| 2: aged metal         | Directional machining, sparse polishing scratches and restrained tonal/roughness patina | Bay bronze; bridge/landing brass; teal-bronze relic; temple gold |

These are deterministic procedural maps, not photographs, scans, provider
textures or AI image-model output. Patina is encoded as monochrome surface
variation; the data adds no green tint, rust colour or painted lighting. The
existing base palette remains authoritative. Bone enamel, satin silver, tide
enamel and the temple's pale/teal detail can remain smooth. Glasswake's caldera
and tone-star materials are outside this asset pass.

### Existing factors, inventoried before integration

Values below are the authored linear RGB/metalness/roughness, before runtime
lighting or colour grading. GLB floats are rounded to their source precision;
an omitted glTF metallic factor means 1, not 0. The temple is procedural source
geometry in `src/observatory/temple.ts`, not a Blender export.

| Material                    | Linear RGB          | Metalness | Roughness | Emission scalar |
| --------------------------- | ------------------- | --------: | --------: | --------------: |
| Bay black basalt            | 0.026, 0.026, 0.026 |         0 |      0.82 |               0 |
| Bay charcoal inset          | 0.043, 0.043, 0.043 |         0 |      0.72 |               0 |
| Bay blackened bronze        | 0.20, 0.15, 0.11    |         1 |      0.42 |               0 |
| Bay satin silver            | 0.90, 0.89, 0.86    |         1 |      0.36 |               0 |
| Bay bone enamel             | 0.60, 0.56, 0.48    |         0 |      0.62 |               0 |
| Bridge/landing blue basalt  | 0.039, 0.064, 0.083 |      0.03 |      0.77 |               0 |
| Bridge/landing slate inset  | 0.052, 0.112, 0.121 |      0.03 |      0.64 |               0 |
| Bridge/landing muted brass  | 0.24, 0.145, 0.063  |      0.78 |      0.46 |               0 |
| Bridge/landing bright brass | 0.55, 0.33, 0.115   |      0.86 |      0.31 |               0 |
| Bridge/landing tide enamel  | 0.17, 0.47, 0.44    |      0.03 |      0.39 |               0 |
| Relic patinated teal bronze | 0.064, 0.21, 0.19   |      0.60 |      0.38 |               0 |
| Temple STONE                | 0.24, 0.30, 0.38    |      0.12 |      0.54 |            0.04 |
| Temple EDGE                 | 0.65, 0.68, 0.63    |      0.32 |      0.30 |            0.02 |
| Temple GOLD                 | 0.92, 0.58, 0.19    |      0.65 |      0.28 |            0.18 |
| Temple TEAL                 | 0.13, 0.66, 0.59    |      0.32 |      0.30 |            0.18 |
| Temple PALE                 | 0.72, 0.88, 0.81    |      0.38 |      0.30 |            0.12 |

### Reproduce and upload

Run from the repository root with Python, NumPy and Pillow:

```sh
rtk proxy timeout 120 python3 experiments/webgpu-xr/assets-source/observatory/build_surfaces.py --evidence-dir /absolute/path/to/registered-run/evidence/observatory-surfaces
```

Optional `--runtime-dir /absolute/path/to/registered-run/scratch/reproduction`
allows a second generation without touching the shipping bundle. The generator
reuses the unchanged Almanac authoring utilities for periodic noise, linear
encoding and mips. Its manifest records both recipe hashes and dependency
versions, so that relationship is explicit.

The shipping asset is
`public/models/observatory/surfaces/observatory-surfaces-v1.bin`, with a sibling
manifest. Its format matches the Almanac `LMSURF01` contract: 32-byte header,
512 × 512, three layers, ten mips, four channels. Payload order is layer-major,
then mip-major from 512 to 1, then tightly packed row-major RGBA8. Total file
size is **4,194,332 bytes**; nominal GPU texel storage is **4,194,300 bytes**.

R is height, G roughness **variation**, and B albedo **variation**, all centred
on 0.5. G and B are not absolute material factors. A is constant 255 and carries
no AO/contact shadow. Upload as `rgba8unorm`, never an sRGB format. Mips are
linear 2 × 2 area averages. Inspection PNGs and the channel/repeat contact sheet
go only to the registered evidence directory; the runtime does not decode them.

Every field is periodic. A cyclic translation places the repeat origin at a
representative gradient instead of a rare strong machining line. This does not
patch border pixels or remove any detail. The receipt compares wrap gradients
with interior gradients in all three channels.

Starting scale suggestions are 1.35 study units per stone repeat on the bay,
0.85 for temple stone, 0.32 for the dark finish and 0.24 for metal machining.
These are artistic calibration values in the existing metre-oriented study
scene, not a headset scale measurement or fixed shader requirement. The runtime
may adjust them at its actual camera distance. Keep broad mineral structure
restrained and manufactured grain shallow; do not enlarge the grain to disguise
an unsuitable camera or mip setting.

The [integration study](../../docs/scene-material-pilot.md#mapping-and-calibration)
records the current runtime calibration. Browser review increased temple stone
repeat to 1.4 and strengthened colour/roughness variation after the initial
fine-grain response proved too subtle at the normal camera distance. The
manifest retains the initial authoring recommendations; the bundle is unchanged.

The asset recipe proves reproducible data, not the actual scene finish. Matched
runtime views, fallback/retry, resource disposal, book preservation and Quest
performance remain separate integration checks. No browser acceptance is
claimed by this source document.

## Meshy lineage

The seed comes from Meshy text-to-3D preview task `01a14734-8023-71cb-9b11-96d1d797e726`, costing 20 credits. The donor has 100,666 triangles and no image textures. The authored derivative has 14,000 triangles. Its source hash, runtime hash, packed Blender hash and script hash are in `celestial-seed.manifest.json`.

Submitted 17 October 2026 with this text-only prompt:

> A single ancient celestial seed relic made of weathered basalt. Tall asymmetrical spiral stone sculpture, three thick sweeping ribs curling around a hollow central opening, broad clean negative spaces, tapered organic silhouette, subtly chipped edges and carved grooves. Elegant observatory artifact, solid grounded base, no pedestal, no terrain, no text, no separate floating parts. Opaque untextured geometry study, isolated object.

The result provides the broad spiral silhouette and openings; it does not
establish weathering, a stable freestanding base, or the other requested details.
Blender preparation supplies the deliberate teal-bronze factor material and
normalized mount. The relic is decoration, with no pick target or collection
reward attached. No third-party reference image was uploaded. Provider terms
and distribution rights remain a separate release/provenance check.

Originals, fresh-import renders, clay comparisons and audit reports are preserved in the registered 2026-10-17 Lumen Meta output run. Runtime screenshots and user art approval belong to the application milestone; this source document does not mark those gates passed.

## Tideweave crossing

`build_tideweave_crossing.py` and `tideweave-crossing.blend` provide a separate
encounter kit: two banks of branching mineral reeds, porcelain tines, bronze
tension strings and an arrival fan. The source also contains the reusable note
resonator and bridge weave, hidden from the default environment view. All three
exports are opaque, factor-only GLBs with material-batched closed geometry.

| Runtime file                 | Triangles | Material groups |   Bytes |
| ---------------------------- | --------: | --------------: | ------: |
| `tideweave-crossing.glb`     |    14,160 |               4 | 282,452 |
| `tideweave-resonator.glb`    |       956 |               3 |  20,688 |
| `tideweave-bridge-weave.glb` |     1,712 |               2 |  33,572 |

The environment is placed at identity in runtime coordinates. The resonator
origin is its centre, with its long axis along +Y. The weave shares the
existing bridge segment's local origin and appears only with an earned module.
The manifest records all source/export hashes, bounds, attachments and protected
trace clearance. No new provider assets or Meshy credits are used.

Allocate an admitted output run and set `TIDEWEAVE_RUN` to its absolute path:

```sh
rtk proxy timeout 1200 /usr/bin/blender --background --threads 8 \
  --python /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr/assets-source/observatory/build_tideweave_crossing.py -- \
  --source-dir "$TIDEWEAVE_RUN/deliverables/tideweave/source" \
  --runtime-dir "$TIDEWEAVE_RUN/deliverables/tideweave/runtime" \
  --evidence-dir "$TIDEWEAVE_RUN/evidence/tideweave-assets"
```

`--no-render` exports without the inspection images. The full recipe renders
the source and independently imported GLBs from matching cameras, clay views
and close reusable-part studies. The current export has no flagged primitives
in the geometry screen; all five focused asset tests pass. Fresh-import factor
renders differ from source by at most one 8-bit channel step. These checks
establish source/export agreement, not real-world scale, collision, headset
appearance or performance. See the [runtime crossing study](../../docs/tideweave-crossing.md)
for presentation, audio and desktop evidence.

## Glasswake Caldera

`build_glasswake_chamber.py` authors a separate open-sky encounter stage.
An irregular island of hexagonal obsidian columns supports two unequal stacks,
with a lower shoulder on the east side. Three broad slabs leave a quiet approach
in front. Seven pale porcelain columns form the sounding flower beneath the
live fractal. Tall columns are split into bevelled drums, with small controlled
offsets and twists; four have pointed crowns. The centre and sky remain open.
No new ring, brass trim, texture, carved lettering or provider model is included.

The source `glasswake-chamber.blend` contains 192 individually named chamber
meshes, attachment empties, the separate tone star, and evidence lighting.
The tone star is hidden in the saved studio view; reveal its `GlasswakeToneStar`
root and child to edit it. Chamber and star export separately, at their own
origins. The current runtime parser combines each asset into one draw; source
object and material counts do not describe runtime draw calls.

| Runtime asset             | Triangles | GLB bytes | Loader vertex/index bytes |
| ------------------------- | --------: | --------: | ------------------------: |
| `glasswake-chamber.glb`   |     6,836 |   504,536 |                   783,856 |
| `glasswake-tone-star.glb` |        48 |     4,048 |                     7,488 |

`glasswake-chamber.manifest.json` records the deterministic layout seed, Blender
version, both script hashes, packed source hash, GLB hashes and attachment
positions. The terrace recipe is imported only for the `bp` and `aim`
coordinate/camera helpers. Its Night Almanac revision leaves those two function
ASTs identical. The chamber manifest retains the original generation helper hash
and records the current compatible helper separately; the chamber source and
GLBs were not regenerated for that palette revision.

### Placement and material contract

The chamber origin is the floor below the glass. Place it at world
`[0, 0, -4.6]` without additional scale. Measured local bounds are
X `-3.604…3.604`, Y `-1.152…3.201`, Z `-2.812…2.335`.
The wider footprint preserves supports beneath the outer stacks rather than
clipping them to the provisional blockout dimensions.

`SealCenter` is `[0, 1.45, 0]`. The tone-star anchors are:

- C: `[0, 2.36, 0.15]`.
- E: `[-0.7880831174438392, 0.995, 0.15]`.
- G: `[0.7880831174438392, 0.995, 0.15]`.

The stars sit 0.06 ahead of the petal midpoints. Each star is 0.17 units long
along its local +Y axis, with a 0.05 circumradius and its origin at the centre.
The runtime rotates +Y to point away from the seal centre. `ListenerMark`
`[0, 0, 1.9]` records an approach datum, not a verified headset standing pose.

The porcelain flower reaches Y=0.13. No chamber triangle bounding box intersects
the reserved shard space X `-1.45…1.45`, Y `0.14…2.85`, local Z `-0.75…0.55`.
This conservative separation check accompanies the actual shatter verification;
it is not a general collision or traversal system.

The chamber exports three opaque dielectric material factors:
`Obsidian | gloss` (roughness 0.22), `Obsidian | worn` (0.58), and
`Porcelain | bone` (0.40). The star uses `Glass | frost` (0.15).
There are no images, UV channels, emission, alpha, transmission, skins or
animations. Broad prism sides and caps have flat normals; bevel strips have
their own smooth shading. The Blender studio uses area and point lights with
shadows, which the analytic runtime material does not reproduce.

### Reproduce and inspect

Allocate an output run, then use its absolute path for `GLASSWAKE_RUN`:

```sh
rtk proxy timeout 1200 /usr/bin/blender --background --threads 8 \
  --python /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr/assets-source/observatory/build_glasswake_chamber.py -- \
  --source-dir "$GLASSWAKE_RUN/deliverables/glasswake-caldera" \
  --runtime-dir "$GLASSWAKE_RUN/deliverables/glasswake-caldera/runtime" \
  --evidence-dir "$GLASSWAKE_RUN/evidence/caldera-assets"
```

`--no-render` generates only source, exports and manifest. Output arguments must
be absolute; the isolated process disables backup copies. It does not alter an
open Blender scene. Review the outputs before copying them into the repository.

The full recipe renders the source and a fresh GLB import from the same
1440×950 camera, a factor view with silhouette proxies, clay at all four
encounter aspect ratios, an oblique factor/clay inspection and a close star
view. The labelled proxies are opaque inspection meshes, excluded from both
GLBs and the saved source. They show clearance around the core and petals;
they do not represent the live fractal or the glass shader.

The exported files pass the actual application parser and both GLB inventory
and face/normal screens: no missing dependencies, non-finite data, zero-area
triangles or opposing-normal flags. Same-camera source and reimport renders
have mean channel differences below 0.00032 on an 8-bit scale. A fresh source
inspection finds all 193 meshes closed, manifold and positively oriented.
Five projected reference points agree with the application's 1440×950 camera
to within 0.0002 pixels. This is a numeric camera comparison; it is not a
composited screenshot alignment test. A valid export,
these comparisons and the measured clearance do not establish headset scale,
reach, collision, comfort or sustained performance.
