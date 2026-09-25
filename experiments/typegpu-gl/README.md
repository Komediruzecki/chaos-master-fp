# TypeGPU to WebGL compatibility spike

Started 2026-09-25 from atlas revision `2e4fff5d` on `feat/typegpu-gl-compatibility-spike`.

The user prefers live WebGPU for the Quest experience and requested a separate
experiment to establish whether TypeGPU can also help with a WebGL/IWSDK route.
This experiment does not change the app's renderer or dependencies.

## Plan and acceptance

1. Pin the current published `@typegpu/gl` and its compatible TypeGPU compiler.
2. Import a small set of the app's actual 3D variation functions; resolve them
   as GLSL and check their numerical output on real WebGL against CPU values.
3. Render a modest 3D sample set using texture-backed positions and procedural
   triangles, the resource strategy available to the fallback API. This is a
   point-cloud presentation experiment, not a port of the compute accumulator.
4. Probe unsupported operations and the external-context limitation explicitly.
   Record package versions, browser/GPU, shader failures and evidence limits.
5. Use the results to scope a later IWSDK/WebXR branch. Do not claim VR from a
   desktop canvas, and do not treat a WebGL result as WebGPU/WebXR evidence.

The standalone dependency workspace intentionally uses TypeGPU 0.12.5 and
`@typegpu/gl` 0.12.4. The existing app remains on TypeGPU 0.12.0. Its root
`tinyest` override also predates the new GL package, so this spike must not
inherit the main workspace's dependency resolution.

Official sources: [GL package guide](https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-gl/),
[package source](https://github.com/software-mansion/TypeGPU/tree/main/packages/typegpu-gl).
The complete source audit, integration boundary and next branch plan are in
[the research record](/home/maff/.dotfiles/personal/lumen-meta/12-typegpu-gl-spike.md).

## Results, 2026-09-25

Six actual app variations (`linear3D`, `spherical3D`, `swirl3D`, `sinusoidal3D`,
`sphere3D`, `curl3D`) passed five-input numerical GLSL/CPU comparisons. Maximum
normalized error was about `1.152e-6`, below the `1e-4` tolerance. Six API probes
confirmed the expected rejections, including compute, storage and an existing
HTML canvas context. A 16,384-point texture-backed cloud rendered successfully;
pause held its image stable and resumed orbit changed it.

Tested in headed Chrome 147 on Linux / AMD Radeon RX 9070 XT, with Vulkan feature
and GPU-blocklist override flags. No Quest, XR, live compute, progressive density
accumulation, sustained performance or full variation coverage is claimed.

The point sampler is a small Verdant-style recipe using real variation functions,
not the application's full preset interpreter. The `@chaos-master/core` alias
deliberately resolves only the original affine schema required by those functions.
The display exercises `initWithGL`; the numerical probe separately exercises GLSL
resolution plus raw WebGL floating-point readback.

The next useful GL bridge is generated shader math inside a scene-owned material.
`initWithGL` requires OffscreenCanvas and transfers images to a bitmap canvas; it
cannot directly adopt IWSDK's WebGL canvas/XR framebuffer. Compute/storage support
is absent. Some accepted-looking API options are ignored in 0.12.4; see the audit.

## Run and verify

Verified with Node 25.8.2. Install from this nested workspace so its pinned compiler
is independent of the monorepo's TypeGPU 0.12.0 and `tinyest` override:

```sh
rtk proxy timeout 240 pnpm --dir /home/maff/.codex/worktrees/typegpu-gl-spike/chaos-master-fp/experiments/typegpu-gl install --frozen-lockfile --ignore-scripts
rtk proxy timeout 120 pnpm --dir /home/maff/.codex/worktrees/typegpu-gl-spike/chaos-master-fp/experiments/typegpu-gl build
rtk proxy timeout 10800 pnpm --dir /home/maff/.codex/worktrees/typegpu-gl-spike/chaos-master-fp/experiments/typegpu-gl exec vite preview --host 127.0.0.1 --port 5186 --strictPort
```

Open [the desktop preview](http://127.0.0.1:5186/). Stop the preview with Ctrl+C;
the timeout also ends it after three hours. While it is running, a second terminal
can execute:

```sh
rtk proxy timeout 120 pnpm --dir /home/maff/.codex/worktrees/typegpu-gl-spike/chaos-master-fp/experiments/typegpu-gl typecheck
rtk proxy timeout 120 pnpm --dir /home/maff/.codex/worktrees/typegpu-gl-spike/chaos-master-fp/experiments/typegpu-gl verify
```

The verification requires a graphical session and Playwright's Chromium. It uses
`--class=agent-browser` and no `playwright test` configuration. Evidence defaults to
the ignored root directory `webgpu-verify-out/typegpu-gl`; `VERIFY_BASE_URL` and
`VERIFY_OUT_DIR` can override the URL/output. The retained snapshot is in
[the research evidence directory](/home/maff/.dotfiles/personal/lumen-meta/verification/typegpu-gl/report.json).

Checks passed: root `pnpm check` (79 warnings in unchanged files, zero errors),
`pnpm docs:index:check`, isolated typecheck/build, and headed browser verification.
The experiment is outside the production workspace and normal app build; it must
continue to be checked explicitly. No app dependency upgrade or app renderer port
has been made.
