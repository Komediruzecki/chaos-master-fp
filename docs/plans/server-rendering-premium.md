# Plan: Server-Side IFS Rendering (Premium Feature)

## Context

chaos-master is a WebGPU-based IFS fractal flame editor. Currently all rendering happens client-side on the user's GPU via WebGPU compute shaders. We want to add **server-side rendering** as a **premium feature** — allowing users to submit flame descriptors and receive rendered images without requiring WebGPU-capable hardware, enabling ultra-high-quality renders, headless/API access, and batch/animation rendering.

The mercurypitch `feat/database-implementation` branch provides a reference architecture: dual-adapter DB (IndexedDB local + Cloudflare D1 server), zero-dependency auth (anonymous + Google OAuth + email/password with JWT), and a worker-based REST API. We'll adapt this pattern.

## Target Branch

Branch from `main` on chaos-master-fp. Create `feat/server-rendering-premium`.

---

## Architecture Overview

```
                    Client (Browser)                          Cloudflare
                   ┌─────────────────┐                    ┌──────────────────┐
                   │  Flam3.tsx       │                    │  render-worker   │
                   │  (WebGPU IFS)    │                    │                  │
                   │                  │                    │  POST /render    │
                   │  Auth UI         │──Bearer JWT───────▶│  GET  /render/:id│
                   │  HybridAdapter   │                    │                  │
                   │  ├─ DexieAdapter │                    │  CPU Renderer    │
                   │  └─ ServerAdapter│────CRUD───────────▶│  (pure TS impl)  │
                   │                  │                    │                  │
                   └─────────────────┘                    │  D1 Database     │
                                                          │  ┌──────────────┐│
                   ┌─────────────────┐                    │  │ users        ││
                   │  db-worker      │                    │  │ subscriptions││
                   │  (auth + CRUD)  │                    │  │ render_jobs  ││
                   │  D1 binding     │                    │  │ feature_flags││
                   └─────────────────┘                    │  └──────────────┘│
                                                          └──────────────────┘
```

Two new workers (or one combined):
1. **db-worker**: Auth + user CRUD + subscription management (D1)
2. **render-worker**: Render job submission, CPU IFS rendering, result storage (D1 + KV/R2 for images)

---

## Phase 1: Modularize the Renderer

### Problem

The IFS pipeline is currently a monolith inside `packages/app/src/flame/`. The CPU renderer (`cpuFlameRenderer.ts`) is a stub — it doesn't actually run flame iterations. All variation functions are written in WGSL (`tgpu.fn`), making them GPU-only.

### Step 1.1: Create `packages/renderer-core/` — Pure Math, No GPU

Extract all pure-computation modules into a shared package usable by both the client WebGPU pipeline and the new server CPU renderer.

**Files to extract (pure, no typegpu/WGSL deps):**
- `flame/schema/flameSchema.ts` → `packages/renderer-core/src/schema.ts` (Valibot-based FlameDescriptor validation)
- `flame/colors.ts` → `packages/renderer-core/src/colors.ts` (OkLab math, RGB conversion)
- `flame/colorMap.ts` → `packages/renderer-core/src/colorMap.ts` (palette entries)
- `flame/flam3PaletteParser.ts` → `packages/renderer-core/src/paletteParser.ts`
- `flame/randomize.ts` → `packages/renderer-core/src/randomize.ts`

**New pure modules to create in this package:**
- `src/types.ts` — Plain-TS equivalents of `Point`, `Bucket`, `BucketData` (no typegpu atoms)
- `src/affine.ts` — Pure TS `transformAffine(params, point)` (replaces `affineTranform.ts` GPU function)
- `src/camera.ts` — Pure TS `camera2DWorldToClip` (ported from `@/lib/Camera2D`)
- `src/rng.ts` — Seedable deterministic PRNG (JS port of the WGSL hash RNG from `@/shaders/random`)
- `src/variations/` — All ~150 variation functions ported to pure TS

### Step 1.2: Port Variations to TypeScript

Each variation is currently a `tgpu.fn([vec2f, VariationInfo], vec2f)` (WGSL math). The math is identical — `sin`, `cos`, `atan2`, `sqrt`, `exp`, etc. A variation port is straightforward:

```typescript
// Current WGSL form (from variations/simple/general/juliaVar.tsx or similar):
// fn juliaVar(p: vec2f, info: VariationInfo) -> vec2f { ... }

// New pure TS form:
export function juliaVar(p: [number, number], info: VariationInfo): [number, number] {
  const r = info.weight * Math.sqrt(Math.sqrt(p[0] * p[0] + p[1] * p[1]))
  const theta = Math.atan2(p[1], p[0]) / 2 + (info.params?.omega ?? 0) * Math.PI
  return [r * Math.cos(theta), r * Math.sin(theta)]
}
```

**Inventory:**
- `variations/simple/general/` — ~40 variations (linear, sinusoidal, spherical, swirl, etc.)
- `variations/simple/pre/` — ~5 variations
- `variations/simple/post/` — ~10 variations
- `variations/parametric/general/` — ~40 parametric variations
- `variations/parametric/pre/` — ~5
- `variations/parametric/post/` — ~30
- `variations/parametric/crop/`, `cut/`, `blur/`, `dc/` — ~30 more

~150 total. Each is ~10-40 lines of math. Estimated: 2-3K lines of pure math.

### Step 1.3: Real CPU Renderer in `packages/renderer-cpu/`

Build a production CPU renderer that mirrors the WebGPU pipeline exactly:

```
Point init → skipIters warm-up → IFS iteration (random transform selection,
preAffine→variations→postAffine) → camera project → jitter → bucket accumulation
→ density estimation → adaptive blur → color grading → PNG output
```

**Key design decisions:**
- **Multi-threaded**: Use `Worker` threads for point iteration. Split point batch across N workers. Each worker writes to its own accumulation buffer. Merge buffers after each batch.
- **Deterministic**: Fixed random seed per render (stored in render_job record) for reproducible results.
- **Streaming output**: Support intermediate results (e.g., every 10K points, emit a progress event).
- **Configurable quality**: Same quality slider → point count mapping as the GPU pipeline.

**Tradeoff: Deno vs Cloudflare Workers for execution**

| Aspect | Cloudflare Workers | Deno (container/VPS) |
|--------|-------------------|---------------------|
| CPU time limit | 30s (free), 15min (paid) | Unlimited |
| Memory | 128MB (free) | Configurable |
| WebCrypto | Yes (for RNG seeding) | Yes |
| Multithreading | No (single-threaded) | Yes (Worker threads) |
| Integration | Same CF infra (D1, KV, R2) | Separate deployment |
| Cold start | ~5ms | Varies |
| Cost | Free tier generous | Server cost |

**Recommendation**: Start with Cloudflare Workers for simplicity (share D1, same deploy pipeline). For renders exceeding Worker limits, offer a queued job system that runs on Cloudflare Containers (like mercurypitch's UVR setup) or a Deno VPS. The CPU renderer package is runtime-agnostic — it can run on either.

---

## Phase 2: Database & Auth Infrastructure

### Step 2.1: Create `workers/db-worker/`

Following mercurypitch's pattern:
- `workers/db-worker/schema.sql` — D1 DDL
- `workers/db-worker/src/index.ts` — CRUD REST API
- `workers/db-worker/src/auth.ts` — Auth handlers (anonymous, Google OAuth, email/pw)
- `workers/db-worker/src/tables.ts` — Per-table access control
- `workers/db-worker/wrangler.jsonc` — Worker config with D1 binding

### Step 2.2: Database Schema (D1)

```sql
-- Users table (auth-only, not exposed via CRUD API)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  authProvider TEXT NOT NULL DEFAULT 'anonymous',
  providerId TEXT,
  email TEXT UNIQUE,
  passwordHash TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  displayName TEXT NOT NULL DEFAULT 'Explorer',
  avatarUrl TEXT
);

-- Subscription tiers
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  userId TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'premium' | 'pro'
  status TEXT NOT NULL DEFAULT 'active',
  currentPeriodStart TEXT NOT NULL,
  currentPeriodEnd TEXT NOT NULL,
  rendersThisMonth INTEGER NOT NULL DEFAULT 0,
  renderLimitMonthly INTEGER NOT NULL DEFAULT 5,  -- free tier: 5/month
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT
);

-- Render jobs
CREATE TABLE render_jobs (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  flameJson TEXT NOT NULL,          -- full FlameDescriptor
  optionsJson TEXT NOT NULL,        -- { width, height, quality }
  progress REAL NOT NULL DEFAULT 0,
  resultUrl TEXT,                   -- R2 or KV URL of rendered PNG
  error TEXT,
  renderTimeMs INTEGER,
  seed TEXT NOT NULL                -- deterministic seed
);

-- Feature flags (server-side gating)
CREATE TABLE feature_flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value INTEGER NOT NULL
);
```

### Step 2.3: Auth Implementation

Copy mercurypitch's zero-dependency auth approach:

- **Anonymous**: `POST /api/auth/anonymous` with `deviceId` → JWT
- **Google OAuth**: `POST /api/auth/google` with ID token → verify against Google → JWT
- **Email/Password**: `POST /api/auth/register` + `POST /api/auth/login` with PBKDF2 hashing
- **JWT**: HS256 via WebCrypto, 30-day TTL, `{ sub: userId, provider: string, iat, exp }`
- **Upgrade path**: Anonymous users upgrade same row when registering (preserves data)

### Step 2.4: Frontend DB Adapter Layer

Create `packages/app/src/db/` following mercurypitch's adapter pattern:

```
src/db/
  types.ts          # DbEntity, Repository<T>, DatabaseAdapter, QueryOptions
  entities.ts       # UserProfile, Subscription, RenderJob, FeatureFlag
  index.ts          # createDatabase(), getDb() singleton, adapter routing
  adapters/
    dexie-adapter.ts   # IndexedDB local storage
    server-adapter.ts  # HTTP → db-worker REST API
    hybrid-adapter.ts  # Route cloud entities to server, rest to local
  services/
    user-service.ts    # getAuthHeaders(), userId persistence
    auth-service.ts    # ensureAuth(), login/register/logout
    render-service.ts  # submitRender(), getRenderStatus(), getRenderResult()
```

**Cloud entities** (stored in D1 via ServerAdapter):
- `userProfiles`, `subscriptions`, `renderJobs`, `featureFlags`

**Local entities** (stored in IndexedDB via DexieAdapter):
- Flame descriptor drafts, editor preferences, timeline state, palette presets

---

## Phase 3: Render Worker & API

### Step 3.1: Create `workers/render-worker/`

```typescript
// POST /api/render — Submit a render job
// Body: { flameJson: string, options: { width, height, quality } }
// Auth: Bearer token (free: 5/month, premium: unlimited)
// Returns: { jobId: string, status: 'queued' }

// GET /api/render/:id — Check job status
// Returns: { jobId, status, progress, resultUrl?, error? }

// GET /api/render/:id/result — Download rendered PNG
// Returns: image/png binary
```

**Rate limiting by tier:**
| Tier | Monthly renders | Max resolution | Max quality |
|------|----------------|---------------|-------------|
| Free | 5 | 1920×1080 | 100K points |
| Premium | 50 | 3840×2160 | 500K points |
| Pro | 200 | 7680×4320 | 2M points |

### Step 3.2: Rendering Pipeline in Worker

```
1. Receive POST /api/render with FlameDescriptor + options
2. Validate tier limits (check subscriptions table)
3. Create render_jobs row (status: queued)
4. Generate deterministic seed from job ID
5. Run CPU renderer (packages/renderer-cpu):
   a. Parse FlameDescriptor
   b. Create variation function registry
   c. Initialize accumulation buffer
   d. For each batch:
      - Generate random points
      - Run IFS iterations (skipIters + quality-driven count)
      - Accumulate to buckets
      - Update progress in D1
   e. Run density estimation
   f. Run adaptive blur
   g. Run color grading → RGBA pixel buffer
6. Encode PNG (use WebCrypto-friendly PNG encoder or pure TS)
7. Store result in R2 (or KV for small renders)
8. Update render_jobs row (status: completed, resultUrl)
```

**For long renders** (exceeding Worker 30s limit):
- Use Cloudflare Queues: The worker enqueues a render request, a consumer worker picks it up and processes it. Or use a Cloudflare Container for CPU-heavy work (like mercurypitch's UVR setup).
- Alternatively: Start with the 15-minute paid Worker tier (bundled with Workers Paid plan).

---

## Phase 4: Frontend Integration

### Step 4.1: Auth UI Components

- `AccountSection.tsx` — Login/register modal, Google Sign-In button, tier display
- `AuthContext.tsx` — SolidJS context providing `authState` (anonymous | authenticated), `user()`, `subscription()`

### Step 4.2: Render Submission UI

- Add "Render on Server" button to `ExportPngDialog.tsx` or as a new `ServerRenderDialog.tsx`
- Shows tier limits: "5 free renders this month, 3 remaining"
- Quality selector (resolution + quality slider)
- Progress indicator (polling GET /api/render/:id)
- Download button when complete
- Upsell: "Upgrade to Premium for higher quality and unlimited renders"

### Step 4.3: Feature Gating

- Read `feature_flags` from server at app init
- Show premium features with lock icon + upgrade CTA
- Local feature: always available (WebGPU rendering)
- Server rendering: gated behind `subscriptions.tier !== 'free'` with monthly limits for free tier

---

## Phase 5: Pricing & Subscription

### Recommendations

| Tier | Price | Renders/mo | Max Res | Key differentiator |
|------|-------|-----------|---------|-------------------|
| Free | $0 | 5 | 1920×1080 | Try it out |
| Premium | $8/mo | 50 | 4K | Hobbyist artists |
| Pro | $20/mo | 200 | 8K | Professional use |

**Implementation**: Stripe Checkout integration in the worker, webhook handler for subscription events (`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`).

**MVP shortcut**: Start with just the free tier + manual premium assignment (update the DB row directly). Add Stripe later.

---

## Tradeoffs & Alternatives

### 1. CPU Renderer vs WASM Renderer
- **CPU (chosen)**: Port variations to TypeScript. ~150 functions, ~3K lines. Pros: debuggable, no build toolchain, works in any JS runtime. Cons: slower than WASM.
- **WASM**: Compile renderer from Rust/C++. Pros: faster (2-5x). Cons: build complexity, debugging difficulty, larger artifact size.
- **Verdict**: Start with CPU. If performance is insufficient, WASM is an optimization, not a rewrite.

### 2. Single Worker vs Separate Workers
- **Single worker**: db-worker handles auth + CRUD + rendering. Pros: simpler deployment. Cons: rendering ties up auth/CRUD.
- **Separate workers (chosen)**: db-worker for auth/CRUD, render-worker for rendering. Pros: independent scaling, rendering doesn't block auth. Cons: two deployments.

### 3. Cloudflare Containers vs Pure Workers for Rendering
- **Workers**: 15-min paid limit, 128MB memory, single-threaded. Works for renders up to ~4K resolution at moderate quality.
- **Containers**: Docker-based, up to 15GB memory, multi-threaded, no timeout. Needed for 8K+ or animation renders.
- **Verdict**: Start with Workers for MVP. Add Container support for Pro tier later.

### 4. Palette Handling
- Palettes are currently GPU-side (`@typegpu/color` OkLab conversion in color grading shader).
- Need to port `oklabToRgb` and palette interpolation to pure TS → goes in `renderer-core`.

### 5. Animation Support
- Server-side animation rendering (exporting video frames) is a natural extension.
- Each frame is an independent render job. Could add batch submission endpoint.
- Out of scope for initial implementation but the architecture supports it.

---

## Implementation Order

1. **Branch**: `feat/server-rendering-premium` from `main`
2. **Package scaffolding**: Create `packages/renderer-core/` and `packages/renderer-cpu/` with `package.json`, `tsconfig.json`
3. **Extract pure modules**: Move `schema`, `colors`, `colorMap`, `paletteParser`, `randomize` to `renderer-core`
4. **Port variations**: Implement all ~150 variations in pure TypeScript
5. **Implement CPU renderer**: IFS iteration, bucket accumulation, density estimation, blur, color grading
6. **Create db-worker**: Auth (anonymous + Google + email/pw), CRUD API, D1 schema
7. **Create render-worker**: Job submission, CPU rendering, result storage in R2
8. **Frontend DB layer**: Adapter pattern, auth context, user/subscription state
9. **Frontend UI**: Auth modal, server render dialog, tier display, upselling
10. **CI/CD**: Worker deployment workflows, D1 migration automation
11. **Stripe integration**: (can be post-MVP)

---

## Verification

1. **Unit tests**: Each variation function produces identical output to its WGSL counterpart (within float epsilon). Test harness: feed same seed + inputs, compare outputs.
2. **Integration test**: Render a known flame descriptor via CPU renderer, compare bucket data to WebGPU pipeline result (within tolerance).
3. **End-to-end**: Submit a render via the UI, verify the returned PNG matches the client-side WebGPU render at the same parameters.
4. **Auth flow**: Anonymous → register → login → Google OAuth → token refresh → logout.
5. **Tier gating**: Free user submits 6th render → rejected. Premium user submits → accepted.
