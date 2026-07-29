# Headless-Chrome server renderer

Status: **proof of concept validated locally** (2026-07-29). Not yet wired into
the render API or the RunPod image.

## Why

The Deno server renderer cannot allocate the buffers a high-resolution render
needs. On the RunPod RTX 4090 it refused single allocations somewhere between
77 MB and 126 MB despite 24 GB free; on the local RX 9070 XT it refuses at
33 MB with 14 GB free. The ceiling is per-allocation, not cumulative (sixteen
32 MiB buffers succeed where one 40 MB buffer fails), independent of usage
flags, and still present on the newest Deno (2.9.4). It is a wgpu/Deno
behaviour, not a hardware limit — the same GPUs allocate gigabyte buffers under
Chrome.

The renderer needs three buffers sized `width x height x sizeof(Bucket)`
(accumulation, postprocess, filter params). That puts 4K at 132.7 MB per buffer
and 8K at 531 MB, so the Deno path is structurally capped below the resolutions
the product sells.

Chunking the accumulation buffer into sub-32 MB tiles would mean tiling the IFS
accumulation, the density-estimation neighbourhood reads, and the color-grading
pass — three pipelines, plus seam handling on a filter that reads outside its
tile. That is a large change to the shared render core for a workaround to
someone else's bug.

## The alternative

Render in headless Chrome instead. Chrome ships Dawn, which does not have the
limitation, and the app already builds a browser renderer — so the server can
run the _actual production pipeline_ rather than a parallel Deno port of it.

That removes the whole class of bug the Deno path keeps producing: the runtime
WGSL extractor (`wgslExtractor.ts`) re-implements what `unplugin-typegpu` does
at build time, and every divergence has shipped as a server-only rendering bug
(`$uses` on a transformed fragment fn, the unresolved `GOLDEN_ANGLE` constant,
zoom-unaware point budgets). A Chrome renderer loads the same bundle the client
loads. There is no second shader path to drift.

## Measured (local, AMD Radeon RX 9070 XT, `example1`, quality 0.95)

| Resolution | Deno                                           | Headless Chrome                   |
| ---------- | ---------------------------------------------- | --------------------------------- |
| 1920x1080  | FAIL — 33.2 MB alloc, "not enough memory left" | 1.2 s                             |
| 3840x2160  | FAIL — 132.7 MB alloc                          | 2.0 s                             |
| 7680x4320  | not attempted                                  | 5.2 s, 1.87 B points, 24.6 MB PNG |

Chrome reports a real hardware adapter (`vendor: amd, architecture: rdna-4`)
with `maxBufferSize` 4294967292, and the driver refuses to proceed without one —
a software fallback cannot silently masquerade as a GPU render.

For scale: the Deno path on the RunPod RTX 4090 takes ~1.7 s at 1080p and
~26 s at 4K when it allocates at all. Chrome on a consumer AMD card beats both.

## What exists now

- `packages/app/headless.html` + `packages/app/src/headless/` — a second Vite
  entry (`build.rollupOptions.input.headless`) that mounts the real
  `Root`/`AutoCanvas`/`Camera2D`/`Flam3` stack at a fixed resolution and
  publishes its progress on `window`.
- `workers/render-worker/tools/chrome-render.mjs` — the driver: serves
  `packages/app/dist` over `http://localhost` (WebGPU needs a secure origin —
  `file://` and `about:blank` are opaque and have no `navigator.gpu`), launches
  Chrome, injects the job, polls to convergence, and reads the PNG back.

Run it from the repo root after `pnpm --filter chaos-master build`:

```bash
node workers/render-worker/tools/chrome-render.mjs --flame flame.json --out out.png --width 3840 --height 2160 --quality 0.95
```

### Things that are load-bearing and non-obvious

- **Chrome flags.** `--enable-unsafe-webgpu --enable-features=Vulkan
--use-angle=vulkan` are all required on Linux; without them
  `requestAdapter()` returns null in headless. This contradicts the note in
  `packages/landing/scripts/capture-posters.mjs` ("headless has no WebGPU on
  this box"), which was written before the Vulkan flags were known — that script
  runs headed for no longer-valid reason.
- **Secure origin.** The static server exists solely because `navigator.gpu` is
  undefined on opaque origins.
- **Capture reads the canvas, not the page.** `page.locator(...).screenshot()`
  clips at the viewport, so it can never capture a 4K canvas from an 800x600
  window. The driver calls `canvas.toBlob` in-page instead — the same call the
  in-app PNG export uses (`ExportJobHost.finalize`), so a server render is the
  client render.
- **Convergence is points-vs-limit.** `Flam3`'s `setCurrentQuality` accessor
  reads the _global_ accumulated-point signal, which only the main workspace
  export renderer writes (it is guarded by `isExportRenderer`). Any other
  renderer reads a constant 0 and therefore a quality of `-Infinity` forever.
  The driver instead compares accumulated points against
  `setQualityPointCountLimit` — the same test the render loop stops on.

## Remaining work

1. **Engine selection through the API.** `POST /api/renders` takes
   `engine: 'deno' | 'chrome'` (default `deno` until Chrome is proven on
   RunPod), persisted on the job row and echoed in status so a result can be
   attributed. The cost model is engine-independent — credits stay priced on
   worker occupancy — but `estimateRenderSeconds` will want separate constants
   once there are enough Chrome samples.
2. **Chrome in the RunPod image.** Add Chrome + its Vulkan stack to
   `workers/render-worker/Dockerfile` and a handler branch that shells out to
   the driver. The image currently carries Deno + the NVIDIA ICD; Chrome needs
   the same ICD plus `--no-sandbox`/`--disable-gpu-sandbox` (already passed).
   The built `packages/app/dist` has to be baked in, which couples the image to
   an app version — worth tagging the image with the app version.
3. **Cold start.** The driver launches a browser per render; on serverless that
   lands on top of container start. A persistent browser reused across jobs in
   one worker is the obvious fix, and needs a page-per-job isolation story.
4. **Resolution caps.** `MAX_RENDER_PIXELS` (5.1 MP) exists because of the Deno
   ceiling. Chrome does 33 MP. The cap becomes a pricing/queue decision rather
   than a technical one.
5. **Decide the Deno path's future.** If Chrome holds up on RunPod, the Deno
   renderer, `wgslExtractor.ts`, and the whole `src/stubs/` tree can go —
   several thousand lines whose only job is re-creating the browser bundle.
