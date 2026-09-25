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
- **Cached flame:** the stereo spike's deterministic 32,768-point CPU cloud.
- **Live GPU flame:** one compute step per active frame, using the app's actual
  `linear3D`, `swirl3D` and `sphere3D` variations. Persistent particle and PRNG
  storage; no readback during rendering. Both eyes read one generation.
- **Two-eye preview:** two desktop cameras 63 mm apart. This is not a VR session.
- **Distance / Orbit:** desktop inspection without emulator keyboard shortcuts.
- **Hold motion:** stops both rotation and live compute. Native `select` from a
  controller or hand toggles this; native input requires device verification.
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

`renderer.ts` wraps that same device with TypeGPU. One encoder records compute
then both eye draws. Each eye owns a separate uniform buffer. Pipelines are
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
It checks app-math CPU/GPU parity, a single compute dispatch for two views,
per-eye uniforms and visible parallax across two real texture-array slices.
Neither test establishes native XR support. Production verification uses
`VERIFY_PRODUCTION=1` and `VERIFY_BASE_URL=https://127.0.0.1:5191/` against a
separately started HTTPS `pnpm preview`; it checks UI, report export and absence
of development hooks.

## Quest acceptance remains open

Run the [official barebones sample](https://immersive-web.github.io/webxr-samples/webgpu/vr-barebones.html)
first, recording exact browser/system versions and any flags. Then test this
lab in geometry, cached and compute modes: both eyes, leaning/turning, stable
world anchoring, trigger/pinch pause, repeated exit/reentry and 10–15 minutes of
use. Save reports and human observations. Desktop success cannot close this gate.

The API targets the [August 12, 2026 editor's draft](https://immersive-web.github.io/webxr-webgpu-binding/).
It remains experimental. The planning pack and evidence live in
`/home/maff/.dotfiles/personal/lumen-meta/15-webgpu-xr-proof.md`.
