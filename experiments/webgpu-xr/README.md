# Native WebGPU XR lab

An isolated SolidJS/TypeGPU proof based on the accepted IWSDK stereo branch.
It owns its WebGPU device and native WebXR session. No IWER, Three.js renderer,
WebGL fallback, audio, locomotion, or application-route changes are included.

## Run

```sh
rtk proxy pnpm --dir /home/maff/.codex/worktrees/webgpu-xr-spike/chaos-master-fp/experiments/webgpu-xr install --frozen-lockfile
rtk proxy timeout 10800 pnpm --dir /home/maff/.codex/worktrees/webgpu-xr-spike/chaos-master-fp/experiments/webgpu-xr dev --host 0.0.0.0 --port 5190 --strictPort
```

Open <https://127.0.0.1:5190/> on desktop or the computer's LAN address on Quest.
The development certificate may need trust. The strict port will fail if busy.
The server expires after three hours; Ctrl+C stops an interactive restart.

- **Geometry probe:** three triangles at different positions and depths.
- **Cached flame:** a deterministic 32,768-point CPU reference using the same
  bounded sample paths as the GPU.
- **GPU-generated flame:** builds all points on the GPU from an empty output,
  using the app's actual `linear3D`, `swirl3D` and `sphere3D` variations. Both
  eyes reuse the cloud. No resampling or readback during ordinary rendering.
- **Rebuild same GPU flame:** explicitly repeats construction from the same
  paths. Detail should remain in place, including while rotating.
- **Two-eye preview:** two desktop cameras 63 mm apart. This is not a VR session.
- **Distance / Orbit:** desktop inspection without emulator keyboard shortcuts.
- **Start / Stop rotation:** motion is off initially and independent of cloud
  generation. Native `select` from a controller or hand toggles rotation; native
  input requires device verification.
- **Save diagnostic report:** capability results, browser/adapter, errors,
  buffer identity, generation, native frame count, eye matrices and viewports.
  The last native sample survives exit. Callback intervals are not GPU timings.

## Rendering contract

`capabilities.ts` checks the secure context, GPU, XR, immersive-session support,
binding constructor and XR-compatible adapter request separately. A fallback
desktop adapter never enables immersive entry. `nativeXr.ts` requires `webgpu`,
uses `XRGPUBinding` and `layers`, and reacquires subimages every XR frame.
`xrTypes.ts` consumes the supplied descriptor and viewport, including array
slices or a shared slice with multiple viewports. It never retains attachments.

`renderer.ts` wraps that same device with TypeGPU. A requested build runs once
before both eye draws in the same encoder; subsequent frames reuse its output. Each eye owns a separate uniform buffer. Pipelines are
cached per attachment format. Camera movement, entry and reentry do not replace
the flame buffer. The normal window loop is stopped during the native XR loop.

The flame uses additive world-sized billboards and has no opaque depth surface.
No depth is submitted to the compositor; space warp and foveation are out of
scope. The preferred reference space is `local-floor`; a reported 1.6 m estimate
is used with `local` as fallback. There are no rendered controllers or hand
meshes, and selection is a global pause toggle rather than a ray hit test.

## Verify

Run from this package:

```sh
rtk proxy timeout 90 pnpm typecheck
rtk proxy timeout 60 pnpm test
rtk proxy timeout 180 pnpm verify
rtk proxy timeout 120 pnpm build
```

`verify` is a standalone headed Chromium script with `--class=agent-browser` and
a hardware GPU. Never run this through the root Playwright configuration, which
uses SwiftShader. It requires the dev server above. Artifacts are ignored by Git.

The node tests use **XR contract doubles**. The GPU harness uses actual hardware
textures and pipelines with **synthetic poses and projection-layer targets**.
It checks all 32,768 CPU/GPU samples, matching cached/GPU eye images, exact
repeat builds, 30 rotating draws without resampling, and a single requested
compute dispatch for two views. Per-eye uniforms and visible parallax are
verified across two real texture-array slices. A repeat-build regression was
observed failing on the original per-frame random-walk implementation.
Neither test establishes native XR support. Production verification uses
`VERIFY_PRODUCTION=1` and `VERIFY_BASE_URL=https://127.0.0.1:5191/` against a
separately started HTTPS `pnpm preview`; it checks UI, report export and absence
of development hooks.

## Quest acceptance remains open

Run the [official barebones sample](https://immersive-web.github.io/webxr-samples/webgpu/vr-barebones.html)
first, recording exact browser/system versions and any flags. Then test this
lab in geometry, cached and compute modes: both eyes, leaning/turning, stable
world anchoring, trigger/pinch rotation, repeated exit/reentry and 10–15 minutes of
use. Save reports and human observations. Desktop success cannot close this gate.

The API targets the [August 12, 2026 editor's draft](https://immersive-web.github.io/webxr-webgpu-binding/).
It remains experimental. The planning pack and evidence live in
`/home/maff/.dotfiles/personal/lumen-meta/15-webgpu-xr-proof.md`.

## Why live sampling changed

The initial proof advanced every particle to its next random chaos-game position
on every active frame. That demonstrated GPU execution, but continually replaced
all visible samples: even with a fixed camera and rotation stopped, the cloud
could not settle. It had no screen accumulation to converge over time.

Now 1,024 deterministic chains each discard 64 burn-in iterations and retain 32
samples. CPU and GPU follow the same seeds, initial point, transforms and color
recurrence. The GPU buffer starts empty and is built on first use or explicit
rebuild. Moving a camera, switching modes or rotating never changes the points.
CPU/GPU floating-point results are close rather than guaranteed bit-identical;
repeating a GPU build on the tested device reproduces identical values/pixels.

This fixes temporal sample churn, not point density or all raster aliasing. The
splat size and 32,768-point budget are unchanged. This is a stable GPU-generated
cloud, not a continuously evolving music simulation. Next, animate coherent
world-space deformation/palette from smoothed audio parameters while preserving
sample identity; measure stereo resolution, density and overdraw on Quest before
choosing production quality settings. The detailed follow-up is in
`/home/maff/.dotfiles/personal/lumen-meta/16-flame-stability-and-next-steps.md`.
