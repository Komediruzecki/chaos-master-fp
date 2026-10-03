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
rtk proxy timeout 900 /usr/bin/blender --background --threads 8 --python experiments/webgpu-xr/assets-source/almanac/build_book.py
```

Append `-- --no-render` to regenerate only the Blender source, GLB and manifest. The script replaces those generated files. Blender may create a `.blend1` backup when an existing source is overwritten; that backup is not a runtime or source deliverable.

The complete command also writes these local review images to `webgpu-verify-out/book-asset/`:

- `source-final.png`: source mesh with the authored materials.
- `source-clay.png`: the same geometry/camera/light with a neutral clay override.
- `export-final.png`: source asset deleted, shipping GLB reimported, same studio camera and lights.
- `export-side.png`: the reimported GLB from a low oblique camera to expose curvature, binding, cover thickness and page edges.

## Runtime contract

The GLB uses +Y up and +Z toward the front edge. The origin is at the book's centre. The cover is 2.8 units wide and 1.9 units deep; the bookmark extends to Z = 1.11. These are scene units, not a claim that a handheld book should be 2.8 metres wide in VR. A later VR scene can uniformly scale the root and every attachment together.

`OrbDockLeft` is `[-0.69, 0.67, 0]`; `OrbDockRight` is `[0.69, 0.67, 0]`. A fractal radius around 0.34 leaves air between the orb and the curved page. `PageLabelLeft` and `PageLabelRight` give lower-page label positions. All four are named empty nodes parented to `AlmanacBook`.

Meshes are merged by material: seven mesh primitives and seven potential draw calls per view, before scene-level passes. The export contains 66,332 triangles, 33,997 exported vertices, 1,494,408 bytes and no textures, skins or animations. `POSITION`, `NORMAL` and `TEXCOORD_0` are present. Metallic/roughness material factors provide the base appearance; optional `KHR_materials_specular` reduces the paper, leather and ribbon sheen. Normals use backface culling rather than relying on double-sided rendering to hide errors.

UVs are planar inspection coordinates for this factor-only version. They are not a packed unwrap suitable for detailed leather or page-edge texture bakes. Any future bake needs a deliberate UV layout and fresh texture/runtime verification.

## Review findings

The first render had a solid-looking gold page block because the folio strokes sat slightly inside the front wall. The revised export moves those strokes outside the wall, where they form continuous visible page divisions. Paper and bookmark materials were darkened and made rougher after visual review. The fine corner and chart ornament is physical low-relief geometry, not a flat backdrop.

The final GLB was reimported into Blender and inspected in the final and oblique renders. The local `glb_inventory.py` report has no dependency, attribute or extension-required flags. `glb_geometry_audit.py` reports no non-finite, zero-area or opposing-normal flags. These checks do not measure browser rendering cost, headset performance or artistic acceptance in the actual Almanac camera. The application verification owns those checks.

The first delivery has a fixed spread, no page-turn rig, collision or leather-grain textures. The binding and bookmark are deliberately thin surfaces; this is a render asset rather than a watertight physical-printing solid.
