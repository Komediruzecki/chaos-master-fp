# Irchiinnuss observatory

The `/observatory` route joins the Blender Almanac to a small authored place,
two retained WebGPU fractal worlds, and a guided melody-tracing encounter.
This is a desktop study. It does not enter WebXR or replace the original XR lab.

## Run and inspect

```sh
rtk proxy timeout 10800 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr dev --host 0.0.0.0 --port 5192 --strictPort
```

Open <https://127.0.0.1:5192/observatory>. Trust the local development certificate
if prompted. The strict port fails if occupied. The server expires after three
hours; Ctrl+C stops an interactive run.

1. Drag the view, scroll closer, or focus the canvas and use arrow keys and +/-.
   Choose Glasswake or Tideweave through the controls or their visible bounds.
2. Hear the world's motif. Playback needs a gesture; selecting another world
   stops it. Volume affects output. Pause motion holds the automatic scene.
3. Inspect the orb, then widen the view. The separate Almanac route remains
   available through the header.
4. Choose Tideweave and Trace a melody. Hear D–F–B–A, then drag through the four
   visible notes in order. Lift to pause; resume from the last earned note.
5. Keyboard alternative: choose Use keyboard, Enter to hold, arrow keys to move
   the tracer (two arrows can move diagonally), Enter to lift. The same judge
   evaluates both inputs. Escape returns.

The visible guide is intentional. This is practice following a melodic contour,
not a singing, pitch-recognition or rhythm assessment. There is no penalty for
retrying. The earned crossing lasts for this page session; it is not a durable
Almanac collectible. The five other constellations are proposed destinations.

## Render and asset contract

- One device, HDR/depth pass and camera own the complete scene.
- Two 131,072-point buffers are constructed once from bounded recipes and seed 73129. Motion transforms/deforms retained samples; it does not resample them.
- Glasswake uses Aureole; Tideweave's branching form is still a specimen study.
  The scene palette/composition is local to this study. Consolidating it with
  the Almanac's world identity record is the next art milestone.
- World satellites and rings are authored opaque primitives. Bridge pieces are
  repeated static meshes with independent transforms, not GPU-instanced draws.
- The camera makes deliberate view cuts. No automatic flights, walking,
  collision, book page turning or animated docking is implemented.
- Sky directions derive from the camera inverse matrix. Stars are not a
  screen-fixed image.
- Opaque meshes write shared depth; point sprites test it. Point-centre depth
  is an approximation, with no volumetric self-occlusion or dynamic shadows.
- Only opaque material factors are supported: no texture maps, transparent
  materials, skins, morphs, skeletal animation or general PBR/IBL claims.

Editable Blender files and reproducible scripts are in
[`assets-source/observatory`](assets-source/observatory/README.md).
The three authored GLBs are observation bay (16,390 triangles), bridge section
(352), and far landing (3,580). The reused book has 66,332 triangles.
The Meshy seed donor was reduced from 100,666 to 14,000 triangles in Blender.
Its original geometry is retained in the editable source; runtime metadata,
hashes and provider task are in
[`celestial-seed.manifest.json`](public/models/observatory/celestial-seed.manifest.json).
One preview cost 20 credits; no paid texture/refinement stage was used.

The scene uses one `MotifAudio` owner. Motion pause and reduced motion freeze
world transforms and deformation, while instructional note color can still
follow playback. A hidden tab stops audio and cancels an active trace.
Returning requires deliberate playback. Failed models can be retried; a lost
GPU produces a reload action. The runtime owns and destroys its GPU device,
including shared resources, when disposed.

## Verification

From this experiment:

```sh
rtk proxy timeout 180 pnpm test
rtk proxy timeout 90 pnpm typecheck
rtk proxy timeout 120 pnpm build
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/evidence VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 600 pnpm exec tsx scripts/verifyObservatory.ts
```

The browser script is standalone, headed, and checks the real adapter. It uses
the required hidden `agent-browser` workspace and checks that the foreground
does not change. Do not run the repository's SwiftShader Playwright test runner
as a substitute for WebGPU proof.

The local hidden compositor schedules animation frames at roughly 1 Hz even
with background-throttle flags. That is a scheduling limitation of this
verification surface, not a GPU benchmark. Keyboard verification uses controlled
32 ms frames with actual key events and the actual WebGPU renderer; the report
labels this explicitly. The script also reports whether native hidden-document
state can be observed. If this automation surface keeps background pages
visible, it explicitly simulates visibility changes to verify the handlers;
that does not establish native tab-hide behavior.

Synchronous allocation-failure cleanup, asset retry and loaded-device loss are
covered. Disposal while a device request, model fetch or validation is still
pending remains an asynchronous teardown coverage gap. Buffer counts exclude
viewport-dependent HDR/MSAA/depth textures. No desktop check establishes Quest stereo, hand reach, comfort or
sustained headset performance.

The current master sequence and implementation evidence are documented in
`/home/maff/.dotfiles/personal/lumen-meta/26-desktop-observatory-master-plan.md`
and `27-observatory-implementation-and-review.md`.
