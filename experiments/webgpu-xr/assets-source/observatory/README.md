# Observatory asset kit

This is the first authored environment kit for the desktop observatory. The terrace has a bevelled stone slab, separated radial floor sectors, a low raised rim, sweeping rails and structural ribs, seven survey markers and an Almanac lectern. The bridge is a separate repeatable tile; the far landing is a separate platform. Broad silhouettes, actual inlaid geometry and five opaque materials carry the appearance in the current factor-material renderer.

The visual direction comes from `personal/lumen-meta/concepts/08-seven-constellations.png` and `12-almanac-temple-teaser.png` in dotfiles. Those are concept images, not evidence of the shipping scene. The geometry intentionally leaves the sky and the live fractals unobstructed.

## Source and delivery

| Source                                          | Runtime file          | Purpose                              |
| ----------------------------------------------- | --------------------- | ------------------------------------ |
| `build_observatory.py`, `observatory-kit.blend` | `observation-bay.glb` | Terrace, rails, markers and lectern  |
| Same source                                     | `bridge-segment.glb`  | One repeatable bridge tile           |
| Same source                                     | `far-landing.glb`     | Destination pedestal and relic mount |
| `prepare_relic.py`, `celestial-seed.blend`      | `celestial-seed.glb`  | Reduced Meshy decorative seed        |

Runtime files live in `../../public/models/observatory/`. `manifest.json` describes the authored kit, coordinates and placements. `celestial-seed.manifest.json` records the provider lineage and derivative. Both record hashes and Blender version. No texture, decoder, skeletal animation or external buffer is required.

| Runtime module  | Triangles | GLB bytes | Current loader geometry bytes |
| --------------- | --------: | --------: | ----------------------------: |
| Observation bay |    16,390 |   447,376 |                     1,112,904 |
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

## Production findings

The first terrace pass showed twisting on nearly vertical tube ribs because a world-up frame flipped as the tangent crossed vertical. The final recipe transports the cross-section frame continuously. A bounds check also caught an oversized chamfer on the narrow bridge edge strips; corner sizes are now clamped to the section dimensions.

Fresh GLB imports were rendered with the authored materials and a neutral clay override. The source and export were inspected from the same elevated view, then the export from the proposed runtime camera. The seed was compared before and after reduction using the same clay, camera and lights, then inspected with its material from front and reverse angles. Its broad spiral blade, pointed silhouette and middle openings remain visible. The reduction does not add surface detail absent from the donor.

The geometry screen reports no non-finite, zero-area or opposing-normal flags. The inventory screen reports no dependency or structure errors. These screens do not certify collision, self-intersection, browser performance or physical-device comfort. Static material grouping is not automatically instanced rendering; the runtime owns draw and memory measurements.

All four final repository GLBs also pass the application's actual `parseBookGlb` loader. Its parsed bounds confirm a bridge width of 1.6 and a seed base at Y = 0 with height 1.0. The manifest and named nodes carry placement information; the current book parser only extracts its original two book dock anchors, so the observatory uses the placement manifest explicitly.

The materials are factors, not baked stone, patina or roughness textures. The Blender studio has area lighting and shadows that the current application renderer may not reproduce. Real browser inspection and headset acceptance remain separate gates.

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
