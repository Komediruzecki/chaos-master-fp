# Blender Almanac source

This is the authored fixed-open book for the desktop Almanac study. The model has curved page surfaces, a visible gutter, a leather cover and spine, twelve continuous folio seams on each half, gilt borders, corner cartouches, celestial dials and a cloth bookmark. Text and the two live fractals belong to the runtime, so they remain editable independently of this asset.

The visual direction comes from `personal/lumen-meta/concepts/12-almanac-temple-teaser.png` in the user's dotfiles. The model is deliberately simpler than that concept illustration. No provider mesh, external texture, generated lettering or purchased asset is included.

## Files and reproduction

- `build_book.py`: reproducible geometry, material setup, export and evidence renders.
- `almanac-book.blend`: editable Blender 5.2.2 LTS source with the seven material groups, attachment empties and studio lighting. No external resources need packing.
- `../../public/models/almanac/almanac-book.glb`: shipping mesh, uncompressed glTF 2.0.
- `../../public/models/almanac/manifest.json`: export version, hashes, materials and placement contract.

Run from the repository root. The process is isolated from any open Blender window and has a 15-minute limit:

```sh
rtk proxy timeout 900 /usr/bin/blender --background --threads 4 --python experiments/webgpu-xr/assets-source/almanac/build_book.py -- --evidence-dir /absolute/path/to/task-output/book
```

Append `--no-render` to regenerate only the Blender source, GLB and manifest. The script replaces those generated files and disables Blender backup creation.

The complete command also writes these local review images to the required absolute evidence directory:

- `source-final.png`: source mesh with the authored materials.
- `source-clay.png`: the same geometry/camera/light with a neutral clay override.
- `export-final.png`: source asset deleted, shipping GLB reimported, same studio camera and lights.
- `export-side.png`: the reimported GLB from a low oblique camera to expose curvature, binding, cover thickness and page edges.

## Runtime contract

The GLB uses +Y up and +Z toward the front edge. The origin is at the book's centre. The cover is 2.8 units wide and 1.9 units deep; the bookmark extends to Z = 1.11. These are scene units, not a claim that a handheld book should be 2.8 metres wide in VR. A later VR scene can uniformly scale the root and every attachment together.

`OrbDockLeft` is `[-0.69, 0.67, 0]`; `OrbDockRight` is `[0.69, 0.67, 0]`. A fractal radius around 0.34 leaves air between the orb and the curved page. `PageLabelLeft` and `PageLabelRight` give lower-page label positions. All four are named empty nodes parented to `AlmanacBook`.

Meshes are merged by material: seven mesh primitives and seven potential draw calls per view, before scene-level passes. The export contains 66,332 triangles, 33,997 exported vertices, 1,494,412 bytes and no textures, skins or animations. `POSITION`, `NORMAL` and `TEXCOORD_0` are present. Metallic/roughness material factors provide the base appearance; optional `KHR_materials_specular` controls paper, leather, ink and ribbon sheen. Normals use backface culling rather than relying on double-sided rendering to hide errors.

Version 2 authors the Night Almanac palette directly into the Blender materials: near-black paper, bone ink, gilt page edges, tobacco-black leather and a rubric ribbon. Bronze folio seams retain their earlier factors. Runtime procedural grain and scene lighting are separate from these authored values; the source contains no baked texture maps.

## Earned page reliefs

`build_book_reliefs.py` produces `almanac-page-reliefs.blend`, `glasswake-earned.glb`, `tideweave-earned.glb` and `earned-reliefs.manifest.json`. Run it with absolute `--source-dir`, `--runtime-dir` and `--evidence-dir` arguments. It imports the base recipe's paper height function, so regenerate it after changing `build_book.py` even when only materials changed.

The two standalone, opaque assets share the base book's exact root transform. Glasswake adds three faceted gold C–E–G stars in silver settings. Tideweave adds four verdigris D–F–B–A gems along the completed encounter's silver melody trace. Both use a near-black curved plaque with smooth analytic surface normals and sharp silver chamfers. They occupy the lower paper strips, leaving the existing charts and orb docks clear. The combined geometry is 1,162 triangles; no images, animation or texture dependencies are included. Earned visibility belongs to the runtime save state.

UVs are planar inspection coordinates for this factor-only version. They are not a packed unwrap suitable for detailed leather or page-edge texture bakes. Any future bake needs a deliberate UV layout and fresh texture/runtime verification.

## Review findings

The first render had a solid-looking gold page block because the folio strokes sat slightly inside the front wall. The revised export moves those strokes outside the wall, where they form continuous visible page divisions. Paper and bookmark materials were darkened and made rougher after visual review. The fine corner and chart ornament is physical low-relief geometry, not a flat backdrop.

The final GLB was reimported into Blender and inspected in the final and oblique renders. The local `glb_inventory.py` report has no dependency, attribute or extension-required flags. `glb_geometry_audit.py` reports no non-finite, zero-area or opposing-normal flags. These checks do not measure browser rendering cost, headset performance or artistic acceptance in the actual Almanac camera. The application verification owns those checks.

The first delivery has a fixed spread, no page-turn rig, collision or leather-grain textures. The binding and bookmark are deliberately thin surfaces; this is a render asset rather than a watertight physical-printing solid.

## Surface detail bundle

`build_surfaces.py` authors three independent, repeating detail fields for black
rag paper, tobacco-black pebbled leather and polished brushed metal. These are
deterministic procedural materials, not scans or photographs. They add fine
surface information without changing the Blender geometry, authored palette,
earned relief identity or save data. They remain separate runtime resources; the
GLBs and Blender material factors do not embed these maps.

The paper has short irregular fibres in fine pulp with restrained broad mottling.
Leather uses randomly distributed, warped pebble cells with softened creases and
small pores. Metal has fine directional brushing and sparse polishing scratches,
without dirt, rust or painted highlights. These fields describe surface variation;
actual reflections and normal strength belong to the runtime material shader.

Generate the shipping bundle and inspection PNGs from the repository root:

```sh
rtk proxy timeout 120 python3 experiments/webgpu-xr/assets-source/almanac/build_surfaces.py --evidence-dir /absolute/path/to/registered-run/evidence/almanac-surfaces
```

The recipe uses Python, NumPy and Pillow. The manifest records the precise
generator hash, dependency versions, seeds and output hash. `--runtime-dir` may
point to an absolute scratch directory for an independent reproducibility check.
PNG files and the diagnostic contact sheet are inspection output only and are not
served by the app. They contain numeric linear data, not photographic colour.

### Binary contract

The runtime asset is `public/models/almanac/surfaces/almanac-surfaces-v1.bin`.
It is 4,194,332 bytes: a 32-byte header followed by 4,194,300 bytes of tightly
packed RGBA8 data. No image decoding or colour conversion is required.

| Byte offset | Field                                          |
| ----------- | ---------------------------------------------- |
| 0–7         | Eight ASCII bytes `LMSURF01`                   |
| 8           | Little-endian uint32 width: 512                |
| 12          | Little-endian uint32 height: 512               |
| 16          | Little-endian uint32 layers: 3                 |
| 20          | Little-endian uint32 mip levels: 10            |
| 24          | Little-endian uint32 channels: 4               |
| 28          | Little-endian uint32 payload length: 4,194,300 |

Payload order is layer-major: paper, leather, then metal. Each layer contains
row-major mips from 512 × 512 down to 1 × 1, with no padding. The manifest gives
every absolute file offset and byte length. Mips use arithmetic area averaging in
linear space, with integer round-to-nearest. Upload as `rgba8unorm`; using an sRGB
format changes the intended data and is incorrect.

| Channel | Meaning                                                               |
| ------- | --------------------------------------------------------------------- |
| R       | Height, centred on 0.5; derive a shallow surface normal               |
| G       | Roughness control, centred on 0.5                                     |
| B       | Albedo variation, centred on 0.5                                      |
| A       | Constant 255, reserved; no ambient occlusion or unique relief shadows |

The intended physical repeating period is 48 mm. The GLB uses authoring units,
not metres: a 2.8-unit spread representing a 280 mm book needs a 0.48-unit repeat,
not a 0.048-unit repeat. The runtime must document its chosen physical scale.
Metal brushing follows texture U. Every authoring operation uses
periodic boundaries; the final pixel does not duplicate the first pixel because
it samples the neighbouring point of a continuous repeating field. Diagnostic
seam gradients are compared with interior gradients, and the 2 × 2 contact sheet
exposes the wrap boundaries. The asset tests check the complete mip inventory,
hashes, alpha, neutral mean, area averaging and border continuity. These data
checks do not replace matched runtime camera review or headset verification.

### Isolated Blender material study

`preview_surfaces.py` creates a separate three-sample studio scene using the
inspection images as non-colour data. It packs those images into a new `.blend`
inside the registered output run. It does not open, modify or replace the book
source. The sample geometry uses metres, with a true 48 mm repeat. Left to right:
paper, leather and gold metal. Its Cycles lighting is an authoring reference;
the browser uses a different material implementation and must be reviewed
independently.

```sh
rtk proxy timeout 300 /usr/bin/blender --background --threads 4 --python experiments/webgpu-xr/assets-source/almanac/preview_surfaces.py -- --evidence-dir /absolute/path/to/registered-run/evidence/almanac-surfaces --deliverables-dir /absolute/path/to/registered-run/deliverables/almanac-surfaces
```
