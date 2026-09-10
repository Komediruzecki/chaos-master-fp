# Server-Side GPU Render Worker

Headless WebGPU IFS fractal flame renderer running in Deno. Accepts flame descriptors via REST API, renders them on server-side GPU hardware, returns PNG images.

## Architecture

```
POST /render              GET /render/:id          GET /render/:id/result
     │                         │                         │
     ▼                         ▼                         ▼
┌─────────────┐         ┌─────────────┐          ┌─────────────┐
│  Validate    │         │  Job status  │          │  PNG binary  │
│  + enqueue   │         │  + progress  │          │  response    │
└──────┬──────┘         └─────────────┘          └─────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    renderFlameGPU()                           │
│                                                              │
│  WebGPU Device ─▶ typegpu root ─▶ IFS Pipeline               │
│                                       │                      │
│  Accumulation ◀── Density ◀── Blur ◀──┘                      │
│       │                                                      │
│       ▼                                                      │
│  Color Grading ─▶ Offscreen Texture ─▶ Readback ─▶ PNG      │
└──────────────────────────────────────────────────────────────┘
```

### Rendering Pipeline (mirrors client WebGPU pipeline)

1. **Point initialization** — points placed on disk/circle/square/etc (12 modes)
2. **IFS iteration** — random transform selection by cumulative probability, variation functions applied per transform
3. **Bucket accumulation** — atomic adds to 64-bit fixed-point accumulation buffer
4. **Density estimation** — local density normalization per pixel
5. **Adaptive blur** — spatial filtering based on sample count variance
6. **Color grading** — OkLab color space, palette mapping, gamma correction, exposure
7. **PNG output** — RGBA readback from offscreen render target

## Runtime WGSL Extraction

The client uses `unplugin-typegpu` build plugin to compile `'use gpu'` arrow functions into WGSL strings at build time. The server runs in plain Deno without a build step.

**Solution**: A typegpu wrapper intercepts `tgpu.fn()`, `tgpu.computeFn()`, and `tgpu.vertexFn()` calls via Proxy, extracting WGSL from TypeScript arrow function bodies at module init time.

### How it works

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 'use gpu'        │     │ wgslExtractor.ts │     │ typegpu           │
│ arrow function   │────▶│ rewrites TS body │────▶│ runtime string    │
│                  │     │ → WGSL string    │     │ path (createFnCore)│
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

The extractor rewrites:

- `'use gpu'` directive → removed
- `vec2f(x, y)` → `vec2f(x, y)` (preserved, both valid in TS and WGSL)
- `const` → `let` (WGSL only has `let`)
- `PI.$`, `EPS.$` → constant values
- Method chains: `.mul()`, `.sub()`, `.add()` → operator expressions

Functions the extractor cannot handle use the WGSL string API directly:

```typescript
export const random = tgpu.fn([], f32) /* wgsl */ `
  () -> f32 { ... raw WGSL ... }
`
```

### Key limitation: transitive .$uses() resolution

typegpu's runtime `.$uses()` resolution only scans the main WGSL template string for external references — it does not follow transitive dependencies. Flame functions and RNG must appear directly in the compute shader template, not nested inside intermediate functions like `executeRandomFlame`.

## API

### POST /render

Submit a render job.

```
Content-Type: application/json

{
  "flameJson": "<stringified FlameDescriptor>",
  "options": {
    "width": 1920,
    "height": 1080,
    "quality": 0.5        // 0.01–1.0
  }
}
```

Returns: `201 { "jobId": "uuid", "status": "queued" }`

### GET /render/:id

Check job status.
Returns: `{ "id", "status", "progress": 0–1, "error?", "renderTimeMs?" }`

### GET /render/:id/result

Download rendered PNG (200) or `202` if still processing.

### GET /health

Health check. Returns: `{ "status": "ok" }`

## Deployment

### Requirements

- **GPU**: Any Vulkan-capable GPU (Intel iGPU, AMD, NVIDIA) or software fallback via Mesa llvmpipe
- **Docker**: For containerized deployment
- **Deno 2.9+**: For direct execution

### Docker (recommended)

We provide helper scripts to build and run the container with graphics device passthrough based on your GPU vendor:

#### AMD GPU (Local)

Run the script to mount the local dri graphics device:

```bash
./run-amd.sh
```

#### NVIDIA GPU (Local / Cloud VM)

Requires the NVIDIA Container Toolkit installed on the host. Run the script to execute with full GPU capabilities and environment configurations:

```bash
./run-nvidia.sh
```

#### Software Vulkan (CPU fallback)

If running on a host with no GPU, execute with Mesa software rasterization (llvmpipe):

```bash
docker run --rm -it -e RENDER_WORKER_FORCE_CPU=true -p 8787:8787 chaos-render-worker
```

### RunPod Serverless (primary production path)

The image's default CMD runs `handler.py` (`runpod.serverless.start`): each
queue job invokes the Deno CLI once, uploads the PNG to R2 via the S3 API,
and returns `{ imageKey, timings, cost }` (or `{ error }` — the submitting
Cloudflare Worker treats that as failed and refunds the credit).

1. Build and push a **pinned tag** to GHCR (never `latest` — bumping the tag
   on the endpoint IS the release):
   ```bash
   docker build -f workers/render-worker/Dockerfile -t ghcr.io/komediruzecki/chaos-render-worker:0.1.0 .
   docker push ghcr.io/komediruzecki/chaos-render-worker:0.1.0
   ```
2. RunPod → Serverless → New Endpoint, from that image. Recommended settings
   (mirrors the proven mercurypitch endpoint):
   - Queue endpoint, **Min/Active workers 0** (scale-to-zero), Max ~3
   - **FlashBoot on** (cold start ~20s → ~2s once cached)
   - Idle timeout 30-60 s; execution timeout 300 s
   - RTX 4090-class GPU; **container disk 20 GB** (smaller fails at start)
3. Endpoint environment (R2 S3 credentials from a Cloudflare R2 API token):
   | Variable | Example / Default | Description |
   |----------|-------------------|-------------|
   | `S3_BUCKET` | `chaos-master-renders-staging` | Target R2 bucket |
   | `S3_ENDPOINT_URL` | `https://<account>.r2.cloudflarestorage.com` | R2 S3 endpoint |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | R2 API token pair |
   | `S3_REGION` | `auto` | R2 uses `auto` |
   | `S3_KEY_PREFIX` | `renders` | Must match the app worker's key scheme |
   | `RENDER_MAX_PIXELS` | `33177600` (8K) | Cheap pre-render rejection cap |
   | `RENDER_TIMEOUT_SECS` | `280` | Below the endpoint execution timeout |
   | `RUNPOD_GPU_USD_PER_HR` | `0` | Cost accounting in job output |
4. Cloudflare Worker secrets: `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID`
   (`wrangler secret put ... --env staging`).

#### Rolling out a new image (IMPORTANT)

Editing a template's `imageName` does **not** move a running endpoint —
existing workers keep serving the old image and new jobs land on them, so a
"deployed" fix silently does nothing. To force a rollout, point the endpoint
at a NEW template:

```bash
# 1. create a template carrying the new tag (copy the env of the old one)
# 2. PATCH the endpoint to it — this bumps the endpoint version and recycles workers
curl -s -X PATCH https://rest.runpod.io/v1/endpoints/<ENDPOINT_ID> \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"templateId":"<NEW_TEMPLATE_ID>"}'
```

Verify the rollout from the job output, not the console: every successful job
returns `backend` ("gpu"/"cpu") and `adapter` (the GPU description). If those
fields are missing, an older image is still serving.

#### API key scopes

Serverless invoke (`api.runpod.ai/v2/...`) and management
(`rest.runpod.io/v1/...`) are separate permissions. A management-scoped key
(e.g. the one used for the RunPod MCP) returns **403** on `/run` and
`/status`. `tools/cost-matrix.ts` preflights `/health` and says so explicitly.

### Self-hosted GPU Pod (fallback path)

The HTTP server (`src/server.ts`) still works for a long-running pod:

1. Push the image, create a RunPod **GPU Pod** from it with
   `--entrypoint deno` and the `src/server.ts` command from the Dockerfile
   comment; expose port `8787`.
2. Set `NVIDIA_VISIBLE_DEVICES=all`,
   `NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute`, `PORT=8787`, and a
   `RENDER_WORKER_TOKEN` (the Cloudflare Worker sends it as a Bearer token —
   set the same value as a `RENDER_WORKER_TOKEN` secret there, plus
   `RENDER_WORKER_URL`).

### Direct (Deno)

```bash
deno run --unstable-webgpu --allow-ffi --allow-net --allow-env --allow-read --sloppy-imports src/server.ts
```

### Environment (pod server)

| Variable              | Default | Description                                              |
| --------------------- | ------- | -------------------------------------------------------- |
| `PORT`                | `8787`  | Server listen port                                       |
| `RENDER_WORKER_TOKEN` | unset   | When set, all endpoints require it as a Bearer token     |
| `RENDER_DEBUG`        | unset   | `1` logs accumulation/postprocess buffer sums per render |

## Testing

```bash
# Direct render test (no HTTP server)
deno run --unstable-webgpu --allow-ffi --allow-read --sloppy-imports test-render.ts

# Type-check
deno check --unstable-webgpu --sloppy-imports src/server.ts

# Curl smoke test
curl -s http://localhost:8787/health
```

## File Map

```
workers/render-worker/
  src/
    server.ts              # HTTP server + job management
    render.ts              # Main render function (WebGPU pipeline orchestration)
    png.ts                 # PNG encoder (CompressionStream deflate)
    typegpuWrapper.ts      # Proxy interceptor for runtime WGSL extraction
    wgslExtractor.ts       # TS→WGSL body rewriter
    typegpuPatch.ts        # Early monkey-patch (superseded by typegpuWrapper)
    solid-stub.ts          # SolidJS stub for SSR compatibility
    stubs/
      ifsPipeline.ts          # IFS compute shader + bind group layout
      random.ts               # RNG functions (WGSL string API)
      colorInitMode.ts        # Color initialization functions
      pointInitMode.ts        # Point initialization functions (12 modes)
      densityEstimationPipeline.ts  # Density normalization compute shader
      adaptiveBlurPipeline.ts       # Adaptive spatial blur compute shader
      Camera2D.ts             # Camera matrix uniforms
      CameraContext.ts        # Camera bind group context
      CanvasContext.ts        # Canvas context stub
      RootContext.ts          # typegpu root context stub
      flameSchema.ts          # FlameDescriptor Valibot schema
      variations.ts           # Variation type exports
      defaults.ts / clone.ts  # Utility stubs
      solid-store.ts          # SolidJS store stub
      structura.ts            # structurajs stub
      schemaUtil.ts / storage.ts / useContextSafe.ts / vramLog.ts  # Misc stubs
      jsx-runtime.ts          # JSX runtime stub
      ParametricEditors/      # Editor component stubs
    types/
      jsx.d.ts                # JSX type declarations
  deno.json                # Deno import map + task definitions
  deno.lock                # Dependency lock file
  Dockerfile               # Docker build with Vulkan/Mesa libraries
  test-render.ts           # Direct render diagnostics
```

## Dependency Flow

```
server.ts
  └─ render.ts
       ├─ typegpuWrapper (intercepts tgpu.fn/computeFn/vertexFn)
       │    └─ wgslExtractor (TS → WGSL)
       └─ stubs/
            ├─ ifsPipeline (compute shaders)
            │    ├─ random (RNG via WGSL string API)
            │    ├─ colorInitMode (extractor-processed)
            │    ├─ pointInitMode (extractor-processed)
            │    └─ transformFunction (real, from app package)
            └─ densityEstimationPipeline / adaptiveBlurPipeline
                 └─ colorGrading (real, from app package)
```

## Known Limitations

- **Blending**: Only single-flame rendering supported; blending path throws "not yet implemented"
- **Buffer writer**: typegpu's compiled IO writer may error on dynamically-structured flame uniforms; falls back to slower JS writer
- **No animation**: Single frame only; batch submission not yet implemented
- **No persistence**: In-memory job store; jobs lost on restart
- **No auth/rate-limiting**: MVP — all endpoints are open
- **Variation stubs**: The `@/flame/variations` stub only exports types; actual variation function implementations come through `createFlameWgsl` from the real app package
