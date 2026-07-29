# Headless-Chrome server renderer

Status: **live on staging** (2026-07-29). Selectable per job through
`POST /api/renders`, served by the RunPod staging endpoint
(`chaos-render-staging`) from a `CHROME_ENGINE=true` image, and priced with
per-engine cost constants measured on that endpoint.

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

## Measured

Local (AMD Radeon RX 9070 XT), `example1`, quality 0.95 — the allocation ceiling:

| Resolution | Deno                                           | Headless Chrome |
| ---------- | ---------------------------------------------- | --------------- |
| 1920x1080  | FAIL — 33.2 MB alloc, "not enough memory left" | 0.7 s           |
| 3840x2160  | FAIL — 132.7 MB alloc                          | 0.8 s           |
| 7680x4320  | not attempted                                  | 1.9 s           |

RunPod RTX 4090 endpoint, 32 cells across both engines (`tools/cost-matrix.ts`,
2026-07-29), exec seconds:

| Resolution | Preset | Deno     | Chrome |
| ---------- | ------ | -------- | ------ |
| 1280x720   | high   | 1.36     | 2.83   |
| 1280x720   | ultra  | 3.92     | 5.70   |
| 1920x1080  | high   | 1.43     | 2.84   |
| 1920x1080  | ultra  | 7.76     | 8.93   |
| 2560x1440  | ultra  | 12.8     | 13.2   |
| 3840x2160  | high   | **FAIL** | 4.33   |
| 3840x2160  | ultra  | **FAIL** | 27.7   |

Marginal throughput, from each resolution's high→ultra delta, is the same for
both: deno 1.82-2.00e9 points/s, chrome 1.79-1.98e9. Every deno 4K cell fails in
~0.1 s at allocation, as predicted.

The entire difference is fixed overhead — deno ~1.4 s, chrome ~2.8 s, because
chrome starts a browser per job. So **deno is cheaper wherever it can allocate**,
and chrome is the only option above ~5.1 megapixels. The defaults reflect that:
deno unless asked otherwise.

That equality was not free. The headless page first ran Flam3's INTERACTIVE rAF
loop — 60 ticks/s of small chunks sized for UI responsiveness — and sustained
only ~0.45e9 points/s, a 4x deficit that was invisible at `low` and made 1080p
ultra take 29.8 s. Flam3 already had the right loop (`exportDriver`, the
self-scheduling async driver); the headless renderer just was not using it. If
chrome's throughput ever drifts from deno's again, suspect the loop, not the GPU.

Chrome reports a real hardware adapter and the driver refuses to proceed without
one, so a software fallback cannot masquerade as a GPU render.

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

## Engine selection (built)

`POST /api/renders` accepts `engine: 'deno' | 'chrome'`, defaulting to `deno`.

The rule throughout is **never silently downgrade**. A `chrome` request against
a deployment or image that cannot serve it is rejected, not quietly rendered by
Deno — a mis-attributed render would defeat the entire point of offering the
choice, and would fail anyway at any resolution Deno cannot allocate. So:

- The submit route rejects `chrome` unless `RUNPOD_CHROME_ENGINE=true`
  (`resolveRenderEngine`), and rejects unknown engines outright.
- `/api/feature-flags` reports `chromeRenderEngine`, so the dialog only offers
  the picker where it works instead of surfacing a 400 after the fact.
- The handler refuses `chrome` unless `CHROME_RENDER_ENABLED=true`.
- Every handler output — success **and** failure — carries the engine that
  actually ran, surfaced through `mapRunpodStatus`.

Pixel ceilings are per engine (`MAX_RENDER_PIXELS`): 5.1 MP for Deno because of
the allocation limit, 33 MP for Chrome, which is a queue-occupancy decision
rather than a device one. Tier caps follow (`TIER_MAX_RES`), so pro reaches 8K
on Chrome and stays at 3008px on Deno.

Credits price worker occupancy. `RENDER_FIXED_SECONDS` is now per engine (deno
1.3 s, chrome 2.8 s); throughput and the per-megapixel term are shared, because
they measured identical. The dialog quotes with the engine the submit will use,
so the quote matches the charge.

`--build-arg CHROME_ENGINE=true` builds an image with Node, Chromium and the
app bundle; without it the image is Deno-only and ~500 MB lighter.

## Remaining work

1. **Cold start.** The driver launches a browser per render — that is the whole
   1.5 s gap to deno, and on serverless it lands on top of container start. A
   persistent browser reused across jobs in one worker would erase it, and needs
   a page-per-job isolation story.
2. **8K on the endpoint.** Verified locally (1.9 s at high) but not yet swept on
   RunPod; `MAX_RENDER_PIXELS.chrome` already allows it.
3. **Decide the Deno path's future.** Deno is now the cheaper engine below
   5.1 megapixels, so "delete it" is no longer obviously right — but keeping it
   means keeping `wgslExtractor.ts` and the `src/stubs/` tree, i.e. the runtime
   WGSL extraction that has caused every server-only rendering bug so far. The
   trade is ~1.5 s per small render against that maintenance burden.
