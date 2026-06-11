# Plan: Server-Side IFS Rendering (Premium Feature) — Variant 2

## Context

chaos-master is a WebGPU-based IFS fractal flame editor using the `typegpu` library for GPU compute shaders. Currently all rendering happens client-side on the user's GPU. We want to add **server-side rendering** as a **premium feature** — using **Deno's native WebGPU runtime** to run the exact same shaders server-side on GPU hardware, without any CPU fallback or WASM compromise.

The mercurypitch `feat/database-implementation` branch provides a reference architecture for the Cloudflare side: dual-adapter DB (IndexedDB local + Cloudflare D1 server), zero-dependency auth (anonymous + Google OAuth + email/password with JWT), and a worker-based REST API.

**Deno 2.8+** supports `navigator.gpu` natively via its `wgpu` Rust backend, with headless off-screen rendering through `OffscreenCanvas.getContext('webgpu')`. This means our WGSL shaders and WebGPU pipeline can run identically on a GPU-equipped server.

---

## Architecture Overview

```
   Client (Browser)                Cloudflare Edge              GPU Server (any provider)
  ┌──────────────────┐          ┌─────────────────────┐        ┌────────────────────────┐
  │ Flam3.tsx          │          │ db-worker (CF Worker) │        │ render-worker (Deno)    │
  │ (WebGPU IFS)       │          │                       │        │                         │
  │                    │          │ POST /api/auth/*      │        │ POST /api/render        │
  │ Auth UI            │──JWT────▶│ GET/POST /api/:entity │        │ GET  /api/render/:id    │
  │                    │          │                       │        │ GET  /api/render/:id.png│
  │ HybridAdapter      │──CRUD───▶│ Stripe webhooks       │        │                         │
  │ ├─ DexieAdapter    │          │ Stripe checkout        │        │ WebGPU IFS Pipeline     │
  │ └─ ServerAdapter   │          │                       │        │ (same WGSL as client)  │
  │                    │          │ D1 Database ────────────▶ D1   │                         │
  │                    │          │ ┌─────────────────────┐│  HTTP  │ PNG Encode → R2         │
  │                    │──render──▶│ │ users               ││  API   │                         │
  │                    │          │ │ subscriptions       ││◀───────│ Environment:            │
  └──────────────────┘          │ │ renderJobs          ││        │ DENO_WEBGPU_BACKEND=    │
                                │ │ featureFlags        ││        │   vulkan                │
                                │ │ stripeCustomers     ││        │ DENO_WEBGPU_ADAPTER_NAME│
                                │ └─────────────────────┘│        │   (optional)            │
                                └─────────────────────┘        └────────────────────────┘
```

**Two workers, separate responsibilities:**

| Worker | Runtime | Where | Responsibility |
|--------|---------|-------|----------------|
| db-worker | Cloudflare Worker | CF Edge | Auth, user CRUD, subscriptions, Stripe, D1 |
| render-worker | Deno | GPU server | WebGPU rendering, PNG output, R2 storage |

**D1 is the shared state layer.** Both workers read/write `renderJobs`. db-worker owns `users` and `subscriptions`. Feature flags in D1 control gating.

---

## Phase 1 — Renderer Modularization

**Goal**: Extract the WebGPU pipeline into a shared `renderer-core` package that both the browser client and the Deno render-worker can import.

Currently the pipeline is a monolith inside `packages/app/src/flame/`. The key insight: **Deno implements the standard WebGPU API** (`navigator.gpu`, off-screen `GPUCanvasContext`). The same `typegpu`-based pipeline can run on both runtimes with minimal adaptation. We don't port variations or write a CPU renderer.

### Tasks

1. **Scaffold `packages/renderer-core/`**
   - `package.json`, `tsconfig.json`, export map
   - Dependencies: `typegpu`, `valibot` (pure schema), color math utils
   - This package is runtime-agnostic — no DOM, no `document`, no browser-specific APIs

2. **Extract FlameDescriptor schema**
   - Move `flame/schema/flameSchema.ts` → `renderer-core/src/schema.ts`
   - Re-export from old location for backward compat
   - Pure Valibot — no GPU deps, clean extraction

3. **Extract color/palette modules**
   - `flame/colors.ts` → `renderer-core/src/colors.ts`
   - `flame/colorMap.ts` → `renderer-core/src/colorMap.ts`
   - `flame/flam3PaletteParser.ts` → `renderer-core/src/paletteParser.ts`
   - These are pure math (OkLab↔RGB conversion, palette interpolation)

4. **Extract WGSL generation functions**
   - `flame/transformFunction.ts` (creates WGSL per transform) → `renderer-core/src/wgsl/`
   - `flame/affineTransform.ts` (WGSL affine math) → `renderer-core/src/wgsl/`
   - `shaders/random.ts` (seedable WGSL PRNG) → `renderer-core/src/wgsl/`
   - These generate WGSL strings — pure string construction, no GPU API calls

5. **Extract point/color init mode implementations**
   - `flame/pointInitMode.ts` → `renderer-core/src/pointInit.ts`
   - `flame/colorInitMode.ts` → `renderer-core/src/colorInit.ts`
   - WGSL function bodies as strings

6. **Extract WebGPU pipeline creation (`ifsPipeline.ts`)**
   - Move core `createIFSPipeline()` to `renderer-core/src/pipeline.ts`
   - Parameterize runtime-specific concerns (device acquisition, buffer creation)
   - Expose `PipelineFactory` class that works with any `GPUDevice`
   - This is the largest extraction — ~465 lines of pipeline orchestration

7. **Extract density estimation, blur, color grading stages**
   - `flame/Flame3.tsx` stages → separate pipeline modules in renderer-core
   - `densityEstimation.ts`, `adaptiveBlur.ts`, `colorGrading.ts`
   - Each exports a function that takes `GPUDevice` + buffers and enqueues compute passes

8. **Extract renderer types (runtime-agnostic subset)**
   - Pure TS equivalents of `Point`, `BucketData` (not the `typegpu` struct variants)
   - `renderer-core/src/types.ts`
   - Keep `typegpu` struct definitions in shared location

9. **Update client imports**
   - Point `packages/app/src/flame/` imports to `renderer-core`
   - Verify `pnpm check` passes, GPU rendering still works in browser
   - Smoke test: render a flame in the editor

10. **Validate Deno compatibility**
    - Create a smoke test script: `deno run --allow-env packages/renderer-core/__tests__/deno-smoke.ts`
    - Import schema, colors, WGSL generators — verify no browser-only APIs are called
    - Validate that `typegpu` imports resolve in Deno (npm specifiers or node_modules)

---

## Phase 2 — Cloudflare db-worker (Auth, Users, Stripe)

**Goal**: Cloudflare Worker handling authentication, user profiles, subscription management, Stripe checkout/webhooks, and a CRUD API for cloud entities. Follows mercurypitch's `workers/db-worker/` pattern exactly.

### Tasks

1. **Scaffold `workers/db-worker/`**
   - `wrangler.jsonc` with D1 binding, routes, env vars
   - `package.json` with wrangler dev script
   - Directory: `src/index.ts`, `src/auth.ts`, `src/tables.ts`, `schema.sql`

2. **Create D1 schema**
   - `users` — id, authProvider, providerId, email (UNIQUE), passwordHash, emailVerified, displayName, avatarUrl
   - `subscriptions` — userId, tier (free/premium/pro), status, periodStart/End, rendersThisMonth, renderLimitMonthly, stripeCustomerId, stripeSubscriptionId
   - `renderJobs` — userId, status, flameJson, optionsJson, progress, resultUrl, error, renderTimeMs, seed
   - `featureFlags` — key, value
   - `stripeEvents` — idempotency log for webhook events

3. **Implement auth handlers** (copy mercurypitch pattern)
   - `POST /api/auth/anonymous` — deviceId → JWT
   - `POST /api/auth/register` — email + password → PBKDF2 hash → JWT
   - `POST /api/auth/login` — verify password → JWT
   - `POST /api/auth/google` — verify Google ID token → JWT
   - `GET /api/auth/me` — return current user from JWT
   - JWT via WebCrypto HMAC-SHA256, 30-day TTL
   - Upgrade path: anonymous → registered preserves userId

4. **Implement CRUD API**
   - `GET/POST /api/:entity`, `GET/PATCH/DELETE /api/:entity/:id`, `GET /api/:entity/count`
   - Per-table access control (`src/tables.ts`)
   - Cloud entities: userProfiles, subscriptions, renderJobs, featureFlags

5. **Implement Stripe integration**
   - `POST /api/stripe/checkout` — create Stripe Checkout session for premium/pro
   - `POST /api/stripe/webhook` — handle `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Sync subscription state to D1 `subscriptions` table
   - Idempotency via `stripeEvents` table
   - `GET /api/stripe/portal` — customer billing portal redirect

6. **Deploy db-worker to Cloudflare**
   - `wrangler d1 create chaos-master-db`
   - `wrangler d1 execute chaos-master-db --file=schema.sql`
   - `wrangler deploy` (dev/staging first)
   - Verify auth flow end-to-end (anonymous → register → login)

---

## Phase 3 — Deno render-worker (GPU Rendering)

**Goal**: A Deno HTTP server running on GPU hardware that accepts render requests, runs the WebGPU IFS pipeline (same WGSL as client), and returns rendered PNGs.

### Tasks

1. **Scaffold `workers/render-worker/`**
   - `deno.json` with imports map (renderer-core, typegpu, PNG encoder)
   - `src/main.ts` — HTTP server entrypoint
   - `src/pipeline.ts` — GPU pipeline bootstrap
   - `src/render.ts` — render orchestration
   - `.env.example` — D1_API_TOKEN, R2_*, DENO_WEBGPU_* vars

2. **Implement WebGPU pipeline bootstrap for Deno**
   - Use `navigator.gpu.requestAdapter()` (Deno native)
   - Off-screen rendering via `OffscreenCanvas.getContext('webgpu')` or direct texture
   - Select adapter via `DENO_WEBGPU_BACKEND` env var (vulkan/metal/dx12)
   - Create GPU device with appropriate limits
   - Validate pipeline creation with a known flame descriptor

3. **Implement POST /api/render**
   - Accept `{ flameJson, options: { width, height, quality } }`
   - Validate against FlameDescriptor schema
   - Create renderJobs row in D1 (status: queued)
   - Run WebGPU pipeline headless:
     a. Parse FlameDescriptor → WGSL generation via renderer-core
     b. Create compute pipelines (IFS iteration, density, blur, grading)
     c. Allocate GPU buffers (accumulation, output)
     d. Dispatch compute passes
     e. Read back RGBA pixel buffer from GPU
     f. Encode PNG (pure TS PNG encoder)
   - Upload PNG to R2 (via S3-compatible API)
   - Update renderJobs row (status: completed, resultUrl)
   - Update subscription.renderCount

4. **Implement GET /api/render/:id**
   - Query renderJobs from D1
   - Return `{ jobId, status, progress, resultUrl?, error? }`

5. **Implement GET /api/render/:id.png**
   - Redirect to R2 signed URL or proxy the PNG

6. **Implement health check and GPU diagnostics**
   - `GET /api/health` — GPU adapter info, memory, queue status
   - Useful for monitoring and auto-scaling decisions

7. **Rate limiting and tier enforcement**
   - Validate subscription tier before rendering
   - Enforce max resolution and point count per tier
   - Reject if monthly limit exceeded
   - Read subscription state from D1 on each request

8. **Error handling and retry**
   - GPU OOM → mark job as failed, clear error message
   - Timeout → configurable max render time
   - Retry logic for transient D1/R2 failures

9. **Deploy render-worker to GPU server**
   - Provision GPU instance (see GPU hosting options below)
   - Install Deno 2.8+
   - Set env vars: D1_API_TOKEN, D1_DATABASE_ID, CF_ACCOUNT_ID, R2_*, JWT_SECRET, DENO_WEBGPU_BACKEND
   - `deno run --allow-net --allow-env --allow-ffi src/main.ts`
   - Systemd unit or Docker container for production
   - TLS termination via Caddy/Nginx

### GPU Server Hosting Options

| Provider | GPU | VRAM | ~$/hr | Notes |
|----------|-----|------|-------|-------|
| Lambda Labs | A10 | 24GB | $0.60 | Good availability, fast setup |
| Lambda Labs | A100 | 40GB | $1.10 | Higher perf, for Pro tier |
| RunPod | RTX 4090 | 24GB | $0.44 | Community cloud, spot available |
| RunPod | A6000 | 48GB | $0.76 | Large memory for 8K renders |
| Hetzner GPU | Tesla T4 | 16GB | ~$0.20 | Cheapest, limited availability |
| vast.ai | RTX 3090 | 24GB | ~$0.15 | Consumer GPUs, lowest cost |
| Self-hosted | Any NVIDIA/AMD | any | $0 | Full control, own hardware |

**Recommendation**: Start with Lambda Labs A10 ($0.60/hr) for development. For production, use on-demand and consider RunPod spot instances for cost savings (~70% cheaper). Scale horizontally — multiple render-worker instances behind a load balancer.

---

## Phase 4 — Frontend Integration

**Goal**: Add auth UI, server render submission, and the dual-adapter DB layer to the SolidJS app.

### Tasks

1. **Create frontend DB layer (`packages/app/src/db/`)**
   - Copy mercurypitch adapter pattern: `types.ts`, `entities.ts`, `index.ts`
   - `adapters/dexie-adapter.ts` — IndexedDB for local entities
   - `adapters/server-adapter.ts` — HTTP → db-worker REST API
   - `adapters/hybrid-adapter.ts` — Route cloud entities to ServerAdapter, rest to DexieAdapter
   - `services/auth-service.ts` — ensureAuth(), login(), register(), logout()
   - `services/render-service.ts` — submitRender(), getRenderStatus(), getRenderResult()

2. **Wire up auth context**
   - `AuthContext.tsx` — SolidJS reactive context
   - `authState()` signal: 'loading' | 'anonymous' | 'authenticated'
   - `user()`, `subscription()` derived signals
   - Auto-call `ensureAuth()` at app init (anonymous JWT)

3. **Build auth UI**
   - `AccountSection.tsx` — login/register modal
   - Google Sign-In button (load Google Identity Services script)
   - Email/password form
   - Tier badge display ("Free", "Premium", "Pro")
   - Upgrade CTA for free users

4. **Build server render dialog**
   - `ServerRenderDialog.tsx`
   - Resolution picker (1080p, 4K, 8K — gated by tier)
   - Quality slider with point count preview
   - "Render on Server" button with remaining renders counter
   - Progress bar (polling GET /api/render/:id every 2s)
   - Download button when complete
   - Upgrade upsell card for free tier users

5. **Feature gating**
   - Fetch `featureFlags` from server at init
   - Premium features get lock icon + CTA
   - Local WebGPU rendering: always free
   - Server rendering: gated behind subscription tier + monthly limits

6. **Integration testing**
   - End-to-end: submit render from UI, poll, download PNG
   - Auth flow: anonymous → open app → register → login → logout
   - Tier enforcement: free user hits limit → rejection shown in UI

---

## Phase 5 — Pricing, Launch & CI/CD

**Goal**: Finalize pricing, deploy everything, add CI/CD automation.

### Tasks

1. **Finalize Stripe product setup**
   - Create Premium ($8/mo) and Pro ($20/mo) products in Stripe dashboard
   - Configure checkout success/cancel URLs
   - Set up webhook endpoint in Stripe dashboard → db-worker URL

2. **CI/CD for db-worker**
   - GitHub Actions: `wrangler deploy` on push to `main`
   - D1 migration automation
   - Staging environment on `dev.chaos-master.com`

3. **CI/CD for render-worker**
   - GitHub Actions: build, run smoke tests against test GPU
   - Deploy to GPU server(s) via SSH or container registry
   - Health check after deploy

4. **Monitoring & alerting**
   - Render job queue depth, success rate, avg render time
   - GPU utilization dashboard
   - Stripe revenue metrics
   - Alert on GPU OOM or server down

5. **Documentation**
   - API docs for render endpoints
   - Self-hosting guide for render-worker
   - Tier comparison table in UI

---

## Pricing Summary

| Tier | Price | Renders/mo | Max Resolution | Max Point Count | Key Differentiator |
|------|-------|-----------|---------------|-----------------|-------------------|
| Free | $0 | 5 | 1920×1080 | 100K | Try server rendering |
| Premium | $8/mo | 50 | 3840×2160 | 500K | Hobbyist artists |
| Pro | $20/mo | 200 | 7680×4320 | 2M | Professional work |

---

## Key Design Decisions

### 1. Deno + WebGPU vs CPU Renderer (CHOSEN: Deno + WebGPU)
- **Deno + WebGPU**: Same WGSL shaders, no porting, identical visual output to client. Requires GPU server (~$0.20–$0.60/hr). Pros: zero math porting risk, pixel-identical to client, fast (GPU-accelerated). Cons: GPU server cost, server management.
- **CPU Renderer (rejected)**: Port ~150 variations to TS. Pros: runs on cheap CPU servers, Cloudflare Workers-compatible. Cons: 2-3K lines of ported math to verify against WGSL originals, inherent visual differences from float precision.

### 2. Shared D1 vs Separate Databases
- **Shared D1 (chosen)**: Both workers access same D1. Pros: single source of truth, no sync needed. Cons: render-worker needs CF API access.
- **Separate DBs**: render-worker has its own DB. Pros: independence. Cons: sync complexity, stale subscription data.

### 3. Client → render-worker Direct vs via db-worker Proxy
- **Direct (chosen)**: Client calls render-worker directly for `/api/render/*`. db-worker for everything else. Pros: no extra hop, render-worker can be on different infrastructure. Cons: two API domains to configure.
- **Proxy**: Client only talks to db-worker. Pros: single API surface. Cons: db-worker becomes bottleneck, large PNG responses tie up CF Worker.

### 4. `typegpu` on Deno
- `typegpu` generates WGSL strings and creates WebGPU pipeline layouts. Since Deno implements the full WebGPU API spec, `typegpu` should work. If there are browser-specific assumptions (e.g., `HTMLCanvasElement`), we can stun or patch them. The `OffscreenCanvas` API in Deno maps to `GPUCanvasContext`.
- **Fallback**: Extract pure WGSL generation from typegpu and use raw WebGPU calls. Higher effort but guaranteed to work.

### 5. GPU Server Scaling
- Single instance: one render at a time. Queue depth = 0-1 in practice.
- Multiple instances: load balance across N GPU servers. D1 handles job coordination.
- Future: Cloudflare Queues for job distribution to render workers.

---

## Implementation Order Summary

| Phase | What | Where | Effort |
|-------|------|-------|--------|
| 1 | Renderer modularization | `packages/renderer-core/` | Large (refactor, validate) |
| 2 | db-worker | `workers/db-worker/` | Medium (copy mercurypitch) |
| 3 | render-worker | `workers/render-worker/` | Large (new Deno code) |
| 4 | Frontend integration | `packages/app/src/` | Medium (SolidJS UI) |
| 5 | Pricing, CI/CD, launch | Config + infra | Medium |

---

## Verification Plan

1. **Renderer modularization**: `pnpm check` passes, flame renders identically in browser after refactor
2. **Deno WebGPU smoke test**: Create GPU device on Deno, run a single IFS iteration, read back pixels
3. **Auth flow**: Anonymous → register → login → Google OAuth → token refresh → logout
4. **Render parity**: Same flame descriptor rendered on server (Deno GPU) vs client (browser GPU) — visual comparison, bucket data within tolerance
5. **Stripe**: Checkout → payment → webhook received → subscription updated in D1 → tier upgrade reflected in UI
6. **Tier gating**: Free user renders 5 → 6th rejected. Premium renders 50 → 51st rejected.
