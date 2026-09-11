# Deployment & Secrets Configuration Guide

How to run the full stack (app + API worker + D1) locally, deploy the
fork-owned **staging** environment, and configure secrets. The `dev` and
`prod` Cloudflare environments are managed from the upstream repo; the fork
deploys **staging.lumenapeiron.com** only.

---

## 1. Local development

The API lives in a Cloudflare Worker (`packages/app/src/worker/index.ts`).
Locally it runs under `wrangler dev` with a **local** D1/R2 simulation — no
Cloudflare resources needed.

One-time setup:

```bash
# Create the local D1 tables + seed feature flags (server_rendering=1 etc.)
pnpm d1:init:local
```

Optional secrets for local Google sign-in, in gitignored
`packages/app/.dev.vars`:

```env
GOOGLE_CLIENT_ID=<web client id>
GOOGLE_CLIENT_SECRET=<web client secret>
# Optional: exercise the RunPod serverless path locally
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=...
# Optional: bot-check enforcement locally (Cloudflare test secret)
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

Run both servers:

```bash
pnpm wr-dev                        # API worker on http://localhost:8787
pnpm --filter chaos-master start   # vite app on https://localhost:5173
```

The vite dev server proxies `/api` and `/discord` to `localhost:8787`.

### There is no fixed dev login

Register any email + password (min 8 chars) in the Account modal — accounts
live in your local D1. In non-prod environments Stripe is mocked: the Account
modal shows "DEV MODE — Click any plan to upgrade instantly (mock Stripe)",
which grants tiers/credits without payment. New accounts start with 5 welcome
credits; server renders cost 1 credit, refunded automatically if the render
fails or times out.

---

## 2. Staging (fork-owned): staging.lumenapeiron.com

One-time resource creation (wrangler must be logged into the account owning
the `lumenapeiron.com` zone):

```bash
cd packages/app
pnpm exec wrangler d1 create chaos-master-db-staging   # paste id into wrangler.jsonc (PLACEHOLDER_STAGING_D1_ID)
pnpm run r2:create:staging                             # chaos-master-renders-staging bucket
pnpm run d1:init:staging                               # apply schema.sql remotely
```

Secrets (each prompts for the value):

```bash
pnpm exec wrangler secret put JWT_SECRET --env staging            # long random string
pnpm exec wrangler secret put TURNSTILE_SECRET --env staging
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env staging
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env staging
pnpm exec wrangler secret put RUNPOD_API_KEY --env staging
pnpm exec wrangler secret put RUNPOD_ENDPOINT_ID --env staging
# Later, when real billing goes live:
# STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PREMIUM_PRICE_ID, STRIPE_PRO_PRICE_ID
```

Deploy:

```bash
pnpm deploy:staging
```

Checklist outside this repo:

- Turnstile widget hostname list must include `staging.lumenapeiron.com`
  (and `localhost` for local testing).
- Google OAuth client: JS origin `https://staging.lumenapeiron.com`, redirect
  URI `https://staging.lumenapeiron.com/api/auth/google/callback`.
- RunPod serverless endpoint: see `workers/render-worker/DEPLOY_TUTORIAL.md`.

Staging behavior: credits/limits are ENFORCED (`ENVIRONMENT=staging`), while
the mock Stripe checkout stays available until a real `STRIPE_SECRET_KEY` is
set — so the whole charge/refund lifecycle is testable with play money.

---

## 3. Google OAuth redirect URIs

The worker builds `${origin}/api/auth/google/callback` from the request, so
the OAuth client must authorize exactly:

- **Local dev**: `http://localhost:8787/api/auth/google/callback`
- **Staging**: `https://staging.lumenapeiron.com/api/auth/google/callback`
- **Dev domain**: `https://dev.lumenapeiron.com/api/auth/google/callback`
- **Production**: `https://lumenapeiron.com/api/auth/google/callback`

JavaScript origins are only needed if the Google Identity Services popup flow
is ever adopted; the current flow is a full-page redirect.

---

## 4. Production notes (upstream-managed)

`prod` needs the same resources and secrets as staging (D1
`chaos-master-db`, R2 `chaos-master-renders`, all secrets — `JWT_SECRET` is
mandatory: the worker refuses to mint tokens without it outside dev). The D1
ids in `wrangler.jsonc` are placeholders until those databases are created.

`schema.sql` is idempotent for fresh databases (`CREATE TABLE IF NOT
EXISTS`); evolving an already-created table needs a manual `ALTER TABLE`
migration.

---

## 5. Cloudflare Dashboard alternative

Workers & Pages → service (`chaos-master-staging` etc.) → Settings →
Variables: add the secrets there instead of the CLI, then redeploy.
