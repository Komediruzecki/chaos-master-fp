# One stereo flame: IWSDK + shared TypeGPU math

A separate renderer spike, based on `feat/typegpu-gl-compatibility-spike`.
The production Solid/WebGPU atlas remains on `feat/explore-vr-flame-atlas`.

## What this proves

- 32,768 persistent world-space samples from the existing GL spike, which calls
  the app's actual 3D variation functions. Sampling happens once on the CPU.
- A TypeGPU-authored breathing function calls the app's `sinusoidal3D`; TypeGPU
  also produces the palette GLSL. IWSDK/Three draws instanced soft splats with
  its own uniforms, depth state, additive blending and tracked eye matrices.
- Native WebGL WebXR entry/exit, controller trigger and hand-pinch selection,
  a Solid browser overlay, and motion hold/resume.
- IWER desktop emulation uses two tracked views with 63 mm eye separation.
  Head movement changes the view without regenerating or relocating the flame.

This does **not** use `initWithGL` for Three's canvas, port the full compute
pipeline, implement music/NASA mapping, or prove physical Quest performance.
Experimental WebGPU XR is the next renderer proof, not an automatic IWSDK mode.

## Run

From this directory, install with `pnpm install --frozen-lockfile`, then:

```sh
rtk proxy timeout 10800 pnpm --dir /home/maff/.codex/worktrees/iwsdk-stereo-flame/chaos-master-fp/experiments/iwsdk-stereo dev
```

The pinned config binds `0.0.0.0:5187` with a strict port and a cached development
HTTPS certificate. Open `https://127.0.0.1:5187/` on desktop. Accept the local
certificate warning when prompted. The managed browser is disabled deliberately;
open your own browser. `pnpm dev:status` reports the current LAN URL.
The command exits after three hours. Stop with Ctrl+C, or `pnpm dev:down` from
this directory. It does not open a public tunnel or deploy anything.

In desktop IWER, press **Try stereo VR**. Use its controls to move the headset,
point a controller and press its trigger, or switch to hand input and pinch.
**Hold motion** freezes the cloud while tracked head movement continues.
**Leave VR** is available after returning to the browser overlay; on the
headset use the system menu to leave the immersive session.

## Quest 3 first run

1. Put Quest and this computer on the same reachable Wi-Fi network.
2. Run `pnpm dev:status` and open its HTTPS LAN URL in Quest Browser.
3. Accept the local development certificate prompt and allow VR/hand input.
4. Press **Enter VR**. Inspect the cloud with each eye, lean side to side, select
   with each controller, then switch to hands and pinch.
5. Open the headset system menu and return; motion should pause while blurred.
6. Exit and re-enter at least three times. Check recentering, seated height,
   comfort, tracking loss/recovery and sustained frame times on the real device.

`localhost` emulator activation is combined with an OculusBrowser/Quest user-agent
exclusion, so LAN and ADB-forwarded Quest pages retain native WebXR. Production
builds contain no IWER injection. No eye tracking is requested.

## Verify

```sh
pnpm typecheck
pnpm build
rtk proxy timeout 240 pnpm verify
```

Verification is standalone headed Chromium with the required agent-browser class,
not the repository's SwiftShader Playwright project. It drives IWER's public
remote API through real XR frames and saves `artifacts/report.json` plus images.
Do not substitute manually dispatched DOM selection events for XR input.
Artifacts are intentionally ignored; accepted evidence is saved in the personal
`lumen-meta` planning pack. Physical Quest results must be recorded separately.

To check the built UI without IWER, run a temporary production preview:

```sh
rtk proxy timeout 600 pnpm --dir /home/maff/.codex/worktrees/iwsdk-stereo-flame/chaos-master-fp/experiments/iwsdk-stereo preview --host 127.0.0.1 --port 5188 --strictPort
```

While that preview is running at `https://127.0.0.1:5188/`, run
`rtk proxy timeout 150 pnpm verify:production` from this directory. It verifies
desktop clicks, keyboard controls, a 390 px touch viewport and the unsupported-VR
layout. The preview stops after ten minutes or Ctrl+C. Both scripts accept
`VERIFY_BASE_URL` and `VERIFY_OUT_DIR` overrides.

The SDK's full bundle is still substantial in this spike; bundle size and Quest
frame-time tuning are follow-up work, not evidence of production readiness.
