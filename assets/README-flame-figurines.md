# Flame figurines

Three additional native flame experiments live at `/figurines`, under **Flame
experiments**. **Geometric studies** keeps the previous four designs. Switching
collections remembers each selection and palette for the current page session.

Each new figure combines independent nonlinear recurrences in local coordinate
frames. The parts use weighted mixtures of sinusoidal, swirl, curl and linear 3D
maps, with separate structural colors. The authored and alternate palettes share
the same geometry. They do not repeat a complete chess-piece model inside itself.

- **Aurora queen:** turquoise currents, an indigo foot and a gold curled crown.
- **Ember bishop:** an orange Barnsley fern mantle, plum roots and a split gold
  flame head. A small sinusoidal warp and depth coupling bend its affine branches.
- **Tidal knight:** a blue neck, violet fins and a cyan head reaching forward.

The `fractal-flame-*.json` files retain the editable native recipes. The matching
GLBs contain 48,000 colored points each, in glTF `POINTS` primitives. Use a point
renderer to display them. These experiments are not solid glass meshes, collision
volumes or PBR surface assets, and they have not replaced the board's pieces.

Vertex colors use linear RGB converted from each sample's structural OkLab color
at fixed lightness 0.78. The live renderer grades lightness from accumulated
density, so its glow and highlights are not baked into these colors.

`flame-figurines-manifest.json` records recipes, source and asset hashes, colors
and sampled bounds. `flame-figurines-loader-report.json` records fresh Blender
imports, including preservation of point counts, bounds and linear vertex colors.
Blender stores imported colors as sRGB bytes; the check accounts for that explicit
quantization. The GLBs themselves retain floating-point colors.
`flame-figurines-comparison.png` shows the actual native WebGPU previews.

Regenerate from the repository root after changing the recipes:

```sh
rtk proxy node packages/app/scripts/export-flame-figurines.mjs
rtk proxy timeout --signal=TERM 90s blender --background --factory-startup --python-exit-code 1 --python packages/app/scripts/inspect-flame-figurines.py -- "$PWD/assets"
```

Fracture remains a separate experiment. These point attractors do not establish
finite-thickness connections, material strength or watertight shard interiors.
The previous [fracture research](fractal-fracture-research.md) describes that work.
