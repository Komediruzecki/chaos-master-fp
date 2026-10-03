<!-- Pawn-board export dimensions, material policy, lineage and importer requirements. -->

# Pawn board assets

The four pawn GLBs contain a closed glass shell and an exact deterministic finite sample of the app's native IFS. The core uses glTF `POINTS`; it is not a reconstructed solid surface. Echo uses the original generator unchanged, while Lattice uses the independent structural components. Frost and Ember have separate materials and embedded recipes.

All files use metres and Y-up. Each pawn shell rests on local y=0, spans 1.34 m at its foot, and reaches y=1.89 m. Its native IFS coordinates are shifted upward by 0.03 m to fit above the shell floor. The board is 13.26 m square with its plinth resting on y=0; its 64 tiles use 1.6 m spacing and reach y=0.515 m. Place pawn origins on that tile height. The app's board uses the same geometry shifted down by 0.455 m.

Glass uses standard metallic-roughness PBR plus `KHR_materials_transmission`, `KHR_materials_ior` and `KHR_materials_volume`, with embedded roughness and normal microtextures. The board also includes an embedded base-colour microtexture. Optical transmission uses `OPAQUE` alpha mode, as required when alpha coverage is unused in the [Khronos transmission specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md#blend-mode). Engines without these extensions can manually assign the bundled material named “alpha glass fallback”; this approximation is identified by `extras.glassFallbackMaterial` / `materials[].extras.fallbackMaterial`.

Point size and point-material support vary between importers. These assets need an engine that renders glTF `POINTS`; their cores are not ordinary triangle meshes. The live app bakes its IFS recipes into instanced point clouds rather than loading these static GLBs, and approximates glass with Fresnel transparency. The GLB's full transmission material is an export feature, not a claim about the live renderer.

The GLBs contain intact pawns. Runtime shattering uses the shared procedural geometry source to split the same shell into 800 closed shards with inner surfaces and cut faces; animations are not embedded in these GLBs.

Rebuild from the repository root with:

```sh
pnpm --filter chaos-master exec node scripts/export-pawn-board-assets.mjs
pnpm --filter chaos-master exec node --test scripts/pawn-board-glb.test.mjs
```

The manifest records source hashes, GLB hashes, sample counts, dimensions, embedded textures and format checks. Existing reference images and recipe assets are preserved. Loader inspection results are recorded separately in `pawn-board-loader-report.json` after opening the exported bytes in Blender's glTF importer. Blender imports each native core as 24,000 loose vertices, which do not render directly. Optional Blender inspection images display those imported positions with 0.0035 m emissive sphere glyphs; the GLBs remain unchanged. The neutral clay inspection also uses that explicit display policy.
