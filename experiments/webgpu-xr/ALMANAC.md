# Blender Almanac study

The `/almanac` route shows a real fixed-open Blender book and two live fractal
specimens in one WebGPU scene. Covers, page blocks, curved pages, binding and
gold ornament are mesh geometry. Selection, world labels and listening controls
remain accessible HTML around the scene. This replaces the rejected CSS book
from the September 30 interaction study.

The work stays on `feat/orb-specimen-bench`. `/bench` retains the specimen
comparison; `/` retains the separate music and experimental XR proof.

## Open the study

```sh
rtk proxy timeout 14400 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec vite --host 0.0.0.0 --port 5192 --strictPort
```

Open [the Almanac](https://localhost:5192/almanac) in a WebGPU-capable browser.
The development certificate may need trust. No environment values are required.
The server expires after four hours; Ctrl+C stops an interactive restart. A busy
strict port fails instead of silently changing the preview address. Dependency
installation is documented in [BENCH.md](BENCH.md).

## What to inspect

1. Orbit the book by dragging the scene or focusing its canvas and using the
   arrow keys. Use the wheel or zoom controls to approach it. Inspect the front
   page edges, gutter, curved pages and cover from several angles.
2. Compare the material and clay views. Clay exposes the shape without the
   dark paper and gold finish disguising it.
3. Select Glasswake or Tideweave, inspect its orb and return. The same canvas
   and GPU owner stay mounted. Each world retains its camera settings.
4. Explicitly play, stop and replay the short motif. Selecting a world stops
   the current audition and never starts another automatically. Cancel motif
   cancels a pending browser audio unlock.
5. Select a future-region preview. Those five entries have no implemented
   specimen or encounter; the scene pauses while the proposal is shown.

Glasswake uses the Aureole recipe and an original C Ionian sketch. Tideweave
uses Thicket and an original D Dorian sketch. They are editable world studies,
not completed games or procedurally derived sonification.

## Asset and renderer boundary

The editable source, authoring recipe and runtime GLB live under
`assets-source/almanac` and `public/models/almanac`. The source recipe runs in
background Blender without modifying an existing GUI scene. No Meshy asset or
paid generation is involved.

`src/almanac/bookAsset.ts` is a bounded loader for this authored, uncompressed
glTF 2 binary. It is not a general model importer. It applies scene transforms,
normal transforms and mirrored winding; unsupported materials and encodings
fail explicitly. Runtime book geometry and flame points share the HDR render
pass and depth attachment. The book writes opaque depth; the luminous points
test against it. The orbit camera sees actual book thickness.

The material shader approximates lit metallic/rough surfaces with studio lights
and surface grain. It does not reproduce a Blender path-traced studio image
exactly. The stars are a screen-space backdrop, not a surrounding VR environment.
Labels and controls are still HTML, not spatial page lettering or hand targets.

The scene loads the GLB only when the book is requested. A failed model request
has a visible retry; pending loads are canceled when their owner is disposed.
The original specimen bench does not need to load this asset.

## Swapping the orb

The catalog separates world identity, specimen settings and motif from GPU
resources. The selected recipe follows those records. The other page displays
the other curated study in this two-world prototype.

These recipes are **not arbitrary `FlameDescriptor3D` imports**. Aureole uses
six contracting branches and the existing `swirl3D` variation. Thicket and
Vesper are the other bounded recipes. Swapping a supported recipe, seed,
palette or motif does not require redesigning the book.

Importing a saved editor flame requires a separate adapter for transforms,
affine parameters, variations and optional layers. That adapter must preserve
point identity and reject unsupported features explicitly.

## Verification

The standalone browser check runs on a real desktop GPU, independently of the
repository's SwiftShader Playwright configuration:

```sh
rtk proxy env VERIFY_BASE_URL=https://127.0.0.1:5192/almanac VERIFY_OUT_DIR=/home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/webgpu-verify-out/almanac-book timeout 360 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr exec tsx scripts/verifyAlmanac.ts
```

It checks the served asset hash against the exported file, captures material
and clay views, exercises selection/inspection/audio, checks desktop/tablet/phone
layouts and keyboard/emulated touch input, and exercises model-load retry,
disposal during loading and GPU failure. It also checks that `/bench` and `/`
still initialize. Screenshots and machine-specific evidence stay in ignored
`webgpu-verify-out`, separately from concept images.

The October 3 desktop hardware run passed on AMD RDNA4 with no unexpected
browser or GPU errors. It verified the served GLB hash, shared book/flame depth,
selection, audio, camera retention, loading retry, disposal and the existing
routes. The framebuffer proof completely hides flame samples beneath a page.
All 49 experiment tests, its typecheck and production build passed. Repository
typecheck, formatting, WGSL validation and focused lint also passed; lint
reports complexity warnings in the bounded loader and renderer.

The production build was inspected at 1440, 820 and 390 CSS pixels. A book-only
minimum projected particle footprint keeps the orbs visible when the camera
backs away for narrow screens; energy compensation follows the resulting size.
This trades some distant fine detail for reliable visibility. It does not change
the ordinary specimen bench or the underlying fractal samples.
The phone framebuffer regression changes only the selected orb's palette:
2,242 pixels respond with the footprint floor, versus zero when it is removed.

No Quest, stereo, physical hand interaction or headset performance result is
implied. No microphone, singing assessment, collection persistence, page turns
or game launch is implemented here.

The [planning record](/home/maff/.dotfiles/personal/lumen-meta/25-blender-almanac-book.md)
tracks the user's feedback and this bounded asset study. Dotfiles Git operations
remain with the user.
