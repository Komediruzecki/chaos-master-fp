import { cameraFromFlame, creditsForRender } from '../flame/renderCost'
import { createJwt, extractBearerToken, generateId, hashPassword, isoNow, signState, verifyGoogleToken, verifyJwt, verifyPassword, verifyState, } from './auth'
import { createRenderJob, createSubscription, createUser, creditBalance, debitCredits, getAllFeatureFlags, getRenderJob, getRenderJobsByUser, getStaleRenderJobs, getSubscriptionByUserId, getUserByEmail, getUserById, getUserByProviderId, grantCredits, incrementRenderCount, refundCredits, updateRenderJob, updateUser, upsertSubscription, } from './db'
import { checkApiRateLimit } from './middleware/rateLimit'
import { isReviewHost, reviewRobotsTxt, withNoIndex, } from './middleware/reviewHost'
import { withSecurityHeaders } from './middleware/securityHeaders'
import { verifyTurnstile } from './middleware/turnstile'
import { handleDiscordRedirect, handleShareDiscord } from './routes/discord'
import { handleGalleryConfig, handleGalleryList, handleGalleryPoster, handleGallerySlug, } from './routes/gallery'
import { handleMetaInject, handleOgGet, handleOgPost } from './routes/og'
import { handleShortenGet, handleShortenPost } from './routes/shorten'
import { cancelRunpodJob, fetchRunpodStatus, runpodConfigured, RunpodJobExpiredError, submitRunpodJob, } from './runpod'
import { errMsg, json } from './utils'
import type { RenderEngine } from '../flame/renderCost'
import type { DbRenderJob } from './db'
import type { RunpodJobStatus } from './runpod'
import type { Env } from './types'

export type { Env }

/** Origins allowed for cross-origin API calls and OAuth returnTo targets. */
function allowedOrigins(env: Env): string[] {
  const extra = (env.APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...DEFAULT_APP_ORIGINS, ...extra]
}

/** CORS headers for allowlisted origins only. Unknown/absent origin gets no
 *  CORS headers (same-origin requests don't need them; foreign origins must
 *  not get carte blanche to call the authed API from any website). */
function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins(env).includes(origin)) {
    return {}
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

type EnvTier = 'dev' | 'preview' | 'staging' | 'prod'

/** Deployment tier. Unset/unknown ENVIRONMENT is treated as prod (fail-safe). */
function envTier(env: Env): EnvTier {
  const e = env.ENVIRONMENT
  return e === 'dev' || e === 'preview' || e === 'staging' ? e : 'prod'
}

/** Mock Stripe checkout (instant tier grants) — never in prod, and never once a
 *  real Stripe key is configured. */
function mockCheckoutAllowed(env: Env): boolean {
  return envTier(env) !== 'prod' && !env.STRIPE_SECRET_KEY
}

/** Credit checks/limits are enforced where money could be real: staging is the
 *  dress rehearsal for prod, dev/preview stay frictionless. */
function creditsEnforced(env: Env): boolean {
  const tier = envTier(env)
  return tier === 'prod' || tier === 'staging'
}

function getJwtSecret(env: Env): string {
  if (env.JWT_SECRET) return env.JWT_SECRET
  // Zero-setup local dev keeps a fixed secret; every deployed tier must set
  // JWT_SECRET or auth would mint forgeable tokens.
  if (envTier(env) === 'dev')
    return 'chaos-master-dev-secret-change-in-production'
  throw new Error('JWT_SECRET is not configured for this environment')
}

/** Credits granted to every new account (the free tier's render allowance). */
const WELCOME_CREDITS = 5

/** Create the free-tier subscription for a brand-new user and seed their
 *  ledger with the welcome credits (idempotent per user). */
async function createFreeSubscription(env: Env, userId: string): Promise<void> {
  const subNow = new Date().toISOString()
  const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  await createSubscription(env.CHAOS_DB, {
    id: generateId(),
    createdAt: subNow,
    updatedAt: subNow,
    userId,
    tier: 'free',
    status: 'active',
    currentPeriodStart: subNow,
    currentPeriodEnd: subEnd,
    rendersThisMonth: 0,
    renderLimitMonthly: WELCOME_CREDITS,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  })
  await grantCredits(
    env.CHAOS_DB,
    userId,
    WELCOME_CREDITS,
    'welcome',
    `grant:welcome:${userId}`,
  )
}

// ── Auth middleware ──────────────────────────────────────────────

async function requireAuth(
  request: Request,
  env: Env,
): Promise<{ userId: string; provider: string } | Response> {
  const token = extractBearerToken(request)
  if (!token) {
    return json({ error: 'Missing authorization token' }, 401)
  }
  const payload = await verifyJwt(token, getJwtSecret(env))
  if (!payload) {
    return json({ error: 'Invalid or expired token' }, 401)
  }
  return { userId: payload.sub, provider: payload.provider }
}

// ── Auth handlers ────────────────────────────────────────────────

async function handleAnonymousAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const { deviceId } = (await request.json()) as { deviceId?: string }
  if (!deviceId) {
    return json({ error: 'deviceId is required' }, 400)
  }

  const providerId = `anon:${deviceId}`
  let user = await getUserByProviderId(env.CHAOS_DB, 'anonymous', providerId)

  if (!user) {
    const now = isoNow()
    user = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      authProvider: 'anonymous',
      providerId,
      email: null,
      passwordHash: null,
      emailVerified: 0,
      displayName: 'Explorer',
      avatarUrl: null,
    }
    await createUser(env.CHAOS_DB, user)

    await createFreeSubscription(env, user.id)
  }

  const token = await createJwt(
    { sub: user.id, provider: 'anonymous' },
    getJwtSecret(env),
  )
  return json({ token, user: { id: user.id, displayName: user.displayName } })
}

async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  const { idToken } = (await request.json()) as { idToken?: string }
  if (!idToken) {
    return json({ error: 'idToken is required' }, 400)
  }

  // Pin the token to OUR OAuth client: a valid Google id-token minted for any
  // other app must not authenticate here (and via the email-merge below it
  // would otherwise allow account takeover by email match).
  const googleUser = await verifyGoogleToken(idToken)
  if (
    !googleUser ||
    !env.GOOGLE_CLIENT_ID ||
    googleUser.aud !== env.GOOGLE_CLIENT_ID
  ) {
    return json({ error: 'Invalid Google token' }, 401)
  }

  let user = await getUserByProviderId(env.CHAOS_DB, 'google', googleUser.sub)

  if (!user) {
    // Check if email already registered
    const emailUser = await getUserByEmail(env.CHAOS_DB, googleUser.email)
    if (emailUser) {
      // Upgrade existing user to Google auth
      emailUser.authProvider = 'google'
      emailUser.providerId = googleUser.sub
      emailUser.emailVerified = 1
      emailUser.updatedAt = isoNow()
      if (googleUser.picture) emailUser.avatarUrl = googleUser.picture
      await updateUser(env.CHAOS_DB, emailUser)
      user = emailUser
    } else {
      const now = isoNow()
      user = {
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        authProvider: 'google',
        providerId: googleUser.sub,
        email: googleUser.email,
        passwordHash: null,
        emailVerified: 1,
        displayName: googleUser.name || 'Explorer',
        avatarUrl: googleUser.picture || null,
      }
      await createUser(env.CHAOS_DB, user)

      await createFreeSubscription(env, user.id)
    }
  }

  const token = await createJwt(
    { sub: user.id, provider: 'google' },
    getJwtSecret(env),
  )
  return json({
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  })
}

/**
 * Bot-gate an auth attempt. Enforced only when TURNSTILE_SECRET is configured
 * (deployed tiers); local dev without keys stays tokenless. Returns an error
 * Response to bounce with, or null when the request may proceed.
 */
async function requireTurnstile(
  request: Request,
  env: Env,
  token: string | undefined,
): Promise<Response | null> {
  if (!env.TURNSTILE_SECRET) return null
  const allowedHostnames = env.TURNSTILE_ALLOWED_HOSTNAMES
    ? env.TURNSTILE_ALLOWED_HOSTNAMES.split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : undefined
  const ok = await verifyTurnstile(
    env.TURNSTILE_SECRET,
    token ?? '',
    request.headers.get('cf-connecting-ip'),
    allowedHostnames,
  )
  return ok ? null : json({ error: 'Bot check failed' }, 403)
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const { email, password, displayName, turnstileToken } =
    (await request.json()) as {
      email?: string
      password?: string
      displayName?: string
      turnstileToken?: string
    }
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400)
  }
  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400)
  }
  const botBounce = await requireTurnstile(request, env, turnstileToken)
  if (botBounce) return botBounce

  const existing = await getUserByEmail(env.CHAOS_DB, email)
  if (existing) {
    return json({ error: 'Email already registered' }, 409)
  }

  const now = isoNow()
  const passwordHash = await hashPassword(password)
  const user = {
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    authProvider: 'email',
    providerId: email,
    email,
    passwordHash,
    emailVerified: 0,
    displayName: displayName || email.split('@')[0] || 'Explorer',
    avatarUrl: null,
  }
  await createUser(env.CHAOS_DB, user)

  await createFreeSubscription(env, user.id)

  const token = await createJwt(
    { sub: user.id, provider: 'email' },
    getJwtSecret(env),
  )
  return json(
    {
      token,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
      },
    },
    201,
  )
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password, turnstileToken } = (await request.json()) as {
    email?: string
    password?: string
    turnstileToken?: string
  }
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400)
  }
  const botBounce = await requireTurnstile(request, env, turnstileToken)
  if (botBounce) return botBounce

  const user = await getUserByEmail(env.CHAOS_DB, email)
  if (!user || !user.passwordHash) {
    return json({ error: 'Invalid email or password' }, 401)
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return json({ error: 'Invalid email or password' }, 401)
  }

  const token = await createJwt(
    { sub: user.id, provider: user.authProvider },
    getJwtSecret(env),
  )
  return json({
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  })
}

async function handleUpgradeAnonymous(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  const { email, password, displayName } = (await request.json()) as {
    email?: string
    password?: string
    displayName?: string
  }
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400)
  }

  const existing = await getUserByEmail(env.CHAOS_DB, email)
  if (existing && existing.id !== userId) {
    return json({ error: 'Email already registered' }, 409)
  }

  const user = await getUserById(env.CHAOS_DB, userId)
  if (!user) {
    return json({ error: 'User not found' }, 404)
  }

  user.authProvider = 'email'
  user.providerId = email
  user.email = email
  user.passwordHash = await hashPassword(password)
  if (displayName) user.displayName = displayName
  user.updatedAt = isoNow()
  await updateUser(env.CHAOS_DB, user)

  const token = await createJwt(
    { sub: user.id, provider: 'email' },
    getJwtSecret(env),
  )
  return json({
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
    },
  })
}

// ── Google OAuth Start and Callback Handlers ──────────────────────

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } })
}

function redirectWithError(returnTo: string, message: string): Response {
  return redirect(`${returnTo}#gauth_error=${encodeURIComponent(message)}`)
}

const DEFAULT_APP_ORIGINS = [
  'https://lumenapeiron.com',
  'https://dev.lumenapeiron.com',
  'https://staging.lumenapeiron.com',
  // Local dev: vite (5173), vite preview (4173), wrangler dev (8787).
  'https://localhost:5173',
  'http://localhost:5173',
  'https://localhost:4173',
  'http://localhost:8787',
]

function isAllowedReturnTo(returnTo: string, env: Env): boolean {
  let origin: string
  try {
    origin = new URL(returnTo).origin
  } catch {
    return false
  }
  const extra = (env.APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return [...DEFAULT_APP_ORIGINS, ...extra].includes(origin)
}

function getRedirectUri(requestUrl: string): string {
  const url = new URL(requestUrl)
  let origin = url.origin
  // Normalize local development IP back to localhost for OAuth consistency
  if (origin.includes('127.0.0.1')) {
    origin = origin.replace('127.0.0.1', 'localhost')
  }
  return `${origin}/api/auth/google/callback`
}

async function handleGoogleStart(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json(
      { error: 'Google login not configured (client id/secret missing)' },
      501,
    )
  }
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('returnTo') ?? ''
  if (!isAllowedReturnTo(returnTo, env)) {
    return json({ error: 'returnTo origin not allowed' }, 400)
  }

  const state = await signState({ returnTo, ts: Date.now() }, getJwtSecret(env))

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  auth.searchParams.set('redirect_uri', getRedirectUri(request.url))
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  auth.searchParams.set('prompt', 'select_account')
  return redirect(auth.toString())
}

async function handleGoogleCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url)
  const stateVal = url.searchParams.get('state') ?? ''
  const state = await verifyState(stateVal, getJwtSecret(env))
  if (!state || !isAllowedReturnTo(state.returnTo, env)) {
    return json({ error: 'Invalid or expired state' }, 400)
  }

  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    return redirectWithError(state.returnTo, oauthError)
  }
  const code = url.searchParams.get('code')
  if (!code) {
    return redirectWithError(state.returnTo, 'Missing authorization code')
  }

  // Exchange the code for an id_token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID as string,
      client_secret: env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: getRedirectUri(request.url),
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '')
    console.error(
      '[google-callback] code exchange failed:',
      tokenRes.status,
      detail,
    )
    let errCode = ''
    try {
      errCode = (JSON.parse(detail) as { error?: string }).error ?? ''
    } catch {
      /* not JSON */
    }
    return redirectWithError(
      state.returnTo,
      `Google code exchange failed${errCode !== '' ? ` (${errCode})` : ` (${tokenRes.status})`}`,
    )
  }

  const tokenData = (await tokenRes.json()) as { id_token?: string }
  if (!tokenData.id_token) {
    return redirectWithError(state.returnTo, 'No id_token from Google')
  }

  const googleUser = await verifyGoogleToken(tokenData.id_token)
  if (!googleUser || googleUser.aud !== env.GOOGLE_CLIENT_ID) {
    return redirectWithError(state.returnTo, 'Invalid Google token claims')
  }

  // Find or create user, similar to handleGoogleAuth
  let user = await getUserByProviderId(env.CHAOS_DB, 'google', googleUser.sub)

  if (!user) {
    // Check if email already registered
    const emailUser = await getUserByEmail(env.CHAOS_DB, googleUser.email)
    if (emailUser) {
      // Upgrade existing user to Google auth
      emailUser.authProvider = 'google'
      emailUser.providerId = googleUser.sub
      emailUser.emailVerified = 1
      emailUser.updatedAt = isoNow()
      if (googleUser.picture) emailUser.avatarUrl = googleUser.picture
      await updateUser(env.CHAOS_DB, emailUser)
      user = emailUser
    } else {
      const now = isoNow()
      user = {
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        authProvider: 'google',
        providerId: googleUser.sub,
        email: googleUser.email,
        passwordHash: null,
        emailVerified: 1,
        displayName: googleUser.name || 'Explorer',
        avatarUrl: googleUser.picture || null,
      }
      await createUser(env.CHAOS_DB, user)

      await createFreeSubscription(env, user.id)
    }
  }

  const token = await createJwt(
    { sub: user.id, provider: 'google' },
    getJwtSecret(env),
  )
  return redirect(`${state.returnTo}#gauth=${encodeURIComponent(token)}`)
}

// ── Render handlers ──────────────────────────────────────────────

const RENDER_ENGINES: readonly RenderEngine[] = ['deno', 'chrome']

interface RenderOptions {
  width: number
  height: number
  quality: number
  backend?: 'gpu' | 'cpu'
  engine?: RenderEngine
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  width: 1920,
  height: 1080,
  quality: 0.5,
  backend: 'gpu',
  engine: 'deno',
}

/**
 * Per-engine pixel ceiling. Deno's is a hard technical limit (16 bytes/pixel of
 * accumulation buffer against a ~100MB per-allocation cap, measured on the RTX
 * 4090 endpoint: 81MB ok, 132.7MB fails with 24GB free). Chrome's is a
 * queue-occupancy decision, not a device one — 8K renders fine.
 */
export const MAX_RENDER_PIXELS: Record<RenderEngine, number> = {
  deno: 5_100_000,
  chrome: 33_177_600, // 7680x4320
}

/**
 * Resolve the requested engine, or explain why it cannot run.
 *
 * A request for an engine the endpoint cannot serve is REJECTED rather than
 * quietly downgraded: silently rendering a 'chrome' job on Deno would attribute
 * that path's timings and failures to the wrong engine, which defeats the point
 * of having the choice.
 */
export function resolveRenderEngine(
  requested: string | undefined,
  chromeAvailable: boolean,
): { engine: RenderEngine } | { error: string } {
  const engine = (requested ?? 'deno') as RenderEngine
  if (!RENDER_ENGINES.includes(engine)) {
    return { error: `Unknown render engine '${requested}'` }
  }
  if (engine === 'chrome' && !chromeAvailable) {
    return {
      error: 'The chrome render engine is not enabled on this deployment',
    }
  }
  return { engine }
}

/** The render endpoint only serves Chrome jobs when its image ships Chrome. */
function chromeEngineAvailable(env: Env): boolean {
  return env.RUNPOD_CHROME_ENGINE === 'true'
}

async function handleSubmitRender(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  const { flameJson, options } = (await request.json()) as {
    flameJson?: string
    options?: RenderOptions
  }
  if (!flameJson) {
    return json({ error: 'flameJson is required' }, 400)
  }
  const requested = options || DEFAULT_RENDER_OPTIONS

  const resolved = resolveRenderEngine(
    requested.engine,
    chromeEngineAvailable(env),
  )
  if ('error' in resolved) {
    return json({ error: resolved.error }, 400)
  }
  const opts: RenderOptions = { ...requested, engine: resolved.engine }

  // Cheap validation BEFORE anything billable is touched.
  if (
    !Number.isFinite(opts.width) ||
    !Number.isFinite(opts.height) ||
    opts.width < 16 ||
    opts.height < 16 ||
    !Number.isFinite(opts.quality) ||
    opts.quality <= 0
  ) {
    return json({ error: 'Invalid render options' }, 400)
  }
  const maxPixels = MAX_RENDER_PIXELS[resolved.engine]
  if (opts.width * opts.height > maxPixels) {
    return json(
      {
        error:
          `Resolution too large for the ${resolved.engine} render engine ` +
          `(max ~${(maxPixels / 1e6).toFixed(1)} megapixels)`,
      },
      400,
    )
  }

  let tier = 'free'
  if (creditsEnforced(env)) {
    const sub = await getSubscriptionByUserId(env.CHAOS_DB, userId)
    if (!sub || sub.status !== 'active') {
      return json({ error: 'No active subscription' }, 403)
    }
    tier = sub.tier

    const maxRes = tier === 'pro' ? 7680 : tier === 'premium' ? 3840 : 1920
    if (opts.width > maxRes || opts.height > maxRes) {
      return json(
        { error: `Maximum resolution for ${tier} tier is ${maxRes}px` },
        400,
      )
    }
  }

  return await createAndSubmitRender(env, userId, flameJson, opts)
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 3,
  delayMs = 150,
  timeoutMs = 5000,
): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        return res
      }
      if (res.status >= 500) {
        lastError = new Error(`Server returned status ${res.status}`)
      } else {
        return res
      }
    } catch (err) {
      lastError = err
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error(
    typeof lastError === 'string' ? lastError : `Failed to fetch ${url}`,
  )
}

/**
 * Price of one server render, in ledger credits. Derived from the SHARED cost
 * model (flame/renderCost.ts) so the number charged here is exactly the number
 * the dialog quoted: it accounts for resolution, quality AND camera zoom (a
 * zoomed-in flame needs zoom^2 more points for the same quality).
 * Falls back to 1 credit if the descriptor can't be parsed.
 */
function renderCostCredits(flameJson: string, opts: RenderOptions): number {
  try {
    const flame = JSON.parse(flameJson) as Parameters<typeof cameraFromFlame>[0]
    return creditsForRender(
      { width: opts.width, height: opts.height, quality: opts.quality },
      cameraFromFlame(flame),
      opts.engine ?? 'deno',
    )
  } catch {
    return 1
  }
}

/** R2 key of a finished render (mirrored by handler.py's upload). */
function renderObjectKey(jobId: string): string {
  return `renders/${jobId}.png`
}

/** Headers for the self-hosted pod fallback (shared bearer token, if set). */
function podHeaders(env: Env): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(env.RENDER_WORKER_TOKEN
      ? { Authorization: `Bearer ${env.RENDER_WORKER_TOKEN}` }
      : {}),
  }
}

async function markJobFailed(
  env: Env,
  job: DbRenderJob,
  error: string,
): Promise<void> {
  job.status = 'failed'
  job.error = error
  job.updatedAt = isoNow()
  await updateRenderJob(env.CHAOS_DB, job)
}

/**
 * Submit a render. Order of operations (mercurypitch pattern):
 *   1. create the job row,
 *   2. submit to the backend (RunPod serverless first, pod fallback),
 *   3. debit AFTER acceptance — the job id is the ledger's idempotency ref,
 *   4. on insufficient credits: cancel the just-submitted job, 402.
 * A failed submit therefore never charges, and a charged job always exists on
 * the backend. Every failure path afterwards refunds via refundCredits().
 */
async function createAndSubmitRender(
  env: Env,
  userId: string,
  flameJson: string,
  opts: RenderOptions,
): Promise<Response> {
  const now = isoNow()
  // eslint-disable-next-line no-restricted-globals
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const job: DbRenderJob = {
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    userId,
    status: 'queued',
    flameJson,
    optionsJson: JSON.stringify(opts),
    progress: 0,
    resultUrl: null,
    runpodJobId: null,
    runpodStatusJson: null,
    error: null,
    renderTimeMs: null,
    seed,
  }
  await createRenderJob(env.CHAOS_DB, job)

  const runpod = runpodConfigured(env)
  if (runpod) {
    try {
      const runpodJobId = await submitRunpodJob(runpod, {
        jobId: job.id,
        flameJson,
        width: opts.width,
        height: opts.height,
        quality: opts.quality,
        seed,
        engine: opts.engine ?? 'deno',
      })
      job.runpodJobId = runpodJobId
      job.status = 'running'
      job.updatedAt = isoNow()
      await updateRenderJob(env.CHAOS_DB, job)
    } catch (err) {
      console.error('[submit-render] RunPod submit failed:', errMsg(err))
      await markJobFailed(env, job, 'Render backend unavailable')
      return json({ error: 'Render backend unavailable' }, 503)
    }
  } else if (env.RENDER_WORKER_URL) {
    try {
      const res = await fetchWithRetry(
        `${env.RENDER_WORKER_URL}/render`,
        {
          method: 'POST',
          headers: podHeaders(env),
          body: JSON.stringify({ flameJson, options: opts }),
        },
        5,
        200,
        5000,
      )
      if (!res.ok) {
        console.error(
          '[submit-render] Render worker returned non-ok:',
          res.status,
        )
        await markJobFailed(env, job, 'Render backend unavailable')
        return json({ error: 'Render backend unavailable' }, 503)
      }
      const { jobId: renderJobId } = (await res.json()) as { jobId: string }
      job.status = 'running'
      job.resultUrl = `${env.RENDER_WORKER_URL}/render/${renderJobId}/result`
      job.updatedAt = isoNow()
      await updateRenderJob(env.CHAOS_DB, job)
    } catch (err) {
      console.error(
        '[submit-render] Failed to reach render-worker:',
        errMsg(err),
      )
      await markJobFailed(env, job, 'Render backend unavailable')
      return json({ error: 'Render backend unavailable' }, 503)
    }
  } else {
    await markJobFailed(env, job, 'Server rendering is not configured')
    return json({ error: 'Server rendering is not configured' }, 503)
  }

  // Debit after acceptance; the job row is the idempotency ref.
  const cost = renderCostCredits(flameJson, opts)
  if (creditsEnforced(env)) {
    const debit = await debitCredits(env.CHAOS_DB, userId, cost, job.id)
    if (debit === 'insufficient') {
      if (job.runpodJobId && runpod) {
        await cancelRunpodJob(runpod, job.runpodJobId)
      }
      await markJobFailed(env, job, 'Insufficient credits')
      const balance = await creditBalance(env.CHAOS_DB, userId)
      return json(
        { error: 'Insufficient credits', required: cost, balance },
        402,
      )
    }
  }
  // Display-only monthly counter (limits are enforced by the ledger).
  await incrementRenderCount(env.CHAOS_DB, userId)

  return json({ jobId: job.id, status: job.status, credits: cost }, 201)
}

async function handleGetRenderStatus(
  request: Request,
  env: Env,
  userId: string,
  jobId: string,
): Promise<Response> {
  const job = await getRenderJob(env.CHAOS_DB, jobId)
  if (!job) {
    return json({ error: 'Job not found' }, 404)
  }
  if (job.userId !== userId) {
    return json({ error: 'Unauthorized' }, 403)
  }

  // RunPod serverless path: reconcile live status into D1. Terminal failures
  // refund exactly once (idempotencyKey), completion records the R2 key.
  const runpod = runpodConfigured(env)
  if (job.runpodJobId && runpod && !isTerminalStatus(job.status)) {
    try {
      const status = await fetchRunpodStatus(runpod, job.runpodJobId)
      await applyRunpodStatus(env, job, status)
    } catch (err) {
      if (err instanceof RunpodJobExpiredError) {
        // RunPod forgot the job (~30 min TTL) — R2 is the source of truth now.
        await reconcileExpiredJob(env, job)
      } else {
        // Transient transport/5xx: keep current state, the next poll (or the
        // sweep) retries. Logged with ids so a stuck job is traceable.
        console.error(
          `[render-status] transient status failure job=${job.id} runpod=${job.runpodJobId}: ${errMsg(err)}`,
        )
      }
    }
  } else if (
    env.RENDER_WORKER_URL &&
    job.resultUrl &&
    !job.runpodJobId &&
    !isTerminalStatus(job.status)
  ) {
    // Self-hosted pod fallback: proxy the pod's status endpoint.
    const match = job.resultUrl.match(/\/render\/([^/]+)\/result$/)
    if (match) {
      try {
        const statusRes = await fetchWithRetry(
          `${env.RENDER_WORKER_URL}/render/${match[1]!}`,
          { method: 'GET', headers: podHeaders(env) },
        )
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            status: string
            progress: number
            error?: string
            renderTimeMs?: number
          }
          job.status = statusData.status
          job.progress = statusData.progress
          job.error = statusData.error ?? job.error
          job.renderTimeMs = statusData.renderTimeMs ?? job.renderTimeMs
          job.updatedAt = isoNow()
          await updateRenderJob(env.CHAOS_DB, job)
          if (job.status === 'failed') {
            await refundCredits(env.CHAOS_DB, job.id)
          }
        }
      } catch {
        // Render worker unreachable — fall back to D1 state
      }
    }
  }

  return json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    renderTimeMs: job.renderTimeMs,
  })
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

async function renderExistsInR2(env: Env, jobId: string): Promise<boolean> {
  if (!env.RENDERS) return false
  try {
    return (await env.RENDERS.head(renderObjectKey(jobId))) !== null
  } catch {
    return false
  }
}

export interface JobTransition {
  status: string
  progress: number
  resultUrl: string | null
  error: string | null
  renderTimeMs: number | null
  /** Trimmed raw RunPod payload, persisted for post-mortems. */
  runpodStatusJson: string | null
  shouldRefund: boolean
}

/**
 * Pure mapping of (job, RunPod status) -> the job's next persisted state.
 * All refund/complete/fail decisions live here so they are unit-testable;
 * the callers only persist and execute the refund flag.
 */
export function decideJobTransition(
  job: Pick<
    DbRenderJob,
    'id' | 'status' | 'progress' | 'resultUrl' | 'renderTimeMs'
  >,
  status: RunpodJobStatus,
): JobTransition {
  const base: JobTransition = {
    status: job.status,
    progress: job.progress,
    resultUrl: job.resultUrl,
    error: null,
    renderTimeMs: job.renderTimeMs,
    runpodStatusJson: status.rawPayload || null,
    shouldRefund: false,
  }
  // Terminal states never regress — a late/duplicate poll must not overwrite
  // a completed job or double-report a failure (refunds are idempotent, but
  // the row should not churn either).
  if (isTerminalStatus(job.status)) {
    return { ...base, runpodStatusJson: null }
  }
  if (status.phase === 'completed') {
    return {
      ...base,
      status: 'completed',
      progress: 1,
      resultUrl: status.imageKey ?? renderObjectKey(job.id),
      renderTimeMs:
        status.timings?.totalMs ?? status.executionMs ?? job.renderTimeMs,
    }
  }
  if (status.phase === 'failed') {
    return {
      ...base,
      status: 'failed',
      error: status.error ?? 'Render failed',
      renderTimeMs: status.executionMs ?? job.renderTimeMs,
      shouldRefund: true,
    }
  }
  return { ...base, status: status.phase } // 'queued' | 'running'
}

/** Persist a mapped RunPod status onto the job row, refunding on failure. */
async function applyRunpodStatus(
  env: Env,
  job: DbRenderJob,
  status: RunpodJobStatus,
): Promise<void> {
  const next = decideJobTransition(job, status)
  const changed =
    next.status !== job.status ||
    next.progress !== job.progress ||
    next.resultUrl !== job.resultUrl
  job.status = next.status
  job.progress = next.progress
  job.resultUrl = next.resultUrl
  job.error = next.error ?? job.error
  job.renderTimeMs = next.renderTimeMs
  if (next.runpodStatusJson) {
    job.runpodStatusJson = next.runpodStatusJson
  }
  if (changed || next.runpodStatusJson) {
    job.updatedAt = isoNow()
    await updateRenderJob(env.CHAOS_DB, job)
  }
  if (next.shouldRefund) {
    const refunded = await refundCredits(env.CHAOS_DB, job.id)
    console.error(
      `[render-job] FAILED job=${job.id} runpod=${job.runpodJobId ?? '-'} ` +
        `worker=${status.workerId ?? '-'} raw=${status.raw} ` +
        `delayMs=${status.delayMs ?? '-'} execMs=${status.executionMs ?? '-'} ` +
        `refunded=${refunded} error=${JSON.stringify(job.error)}`,
    )
  }
}

/** Reconcile a job whose RunPod state is GONE (expired/404): output in R2
 *  means it completed; otherwise it failed — refund and say why. */
async function reconcileExpiredJob(env: Env, job: DbRenderJob): Promise<void> {
  if (await renderExistsInR2(env, job.id)) {
    job.status = 'completed'
    job.progress = 1
    job.resultUrl = renderObjectKey(job.id)
    job.updatedAt = isoNow()
    await updateRenderJob(env.CHAOS_DB, job)
    return
  }
  await markJobFailed(
    env,
    job,
    'RunPod job expired without a stored result (worker likely crashed)',
  )
  const refunded = await refundCredits(env.CHAOS_DB, job.id)
  console.error(
    `[render-job] EXPIRED job=${job.id} runpod=${job.runpodJobId ?? '-'} refunded=${refunded}`,
  )
}

async function handleGetRenderResult(
  request: Request,
  env: Env,
  userId: string,
  jobId: string,
): Promise<Response> {
  const job = await getRenderJob(env.CHAOS_DB, jobId)
  if (!job) {
    return json({ error: 'Job not found' }, 404)
  }
  if (job.userId !== userId) {
    return json({ error: 'Unauthorized' }, 403)
  }

  // Serverless path: the PNG lives in R2 under the job's key. Serve it even
  // when the row hasn't been reconciled to 'completed' yet — storage outlives
  // both the RunPod job and any missed status polls.
  if (job.runpodJobId || (!job.resultUrl && env.RENDERS)) {
    const obj = env.RENDERS
      ? await env.RENDERS.get(renderObjectKey(job.id)).catch(() => null)
      : null
    if (obj?.body) {
      return new Response(obj.body as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }
    return json({ status: job.status, progress: job.progress }, 202)
  }

  if (job.status !== 'completed' || !job.resultUrl) {
    return json({ status: job.status, progress: job.progress }, 202)
  }

  // Pod fallback: fetch from the render worker and proxy the PNG.
  const result = await fetchWithRetry(
    job.resultUrl,
    { method: 'GET', headers: podHeaders(env) },
    3,
    200,
    10000,
  )
  if (!result.ok) {
    return json({ error: 'Result not available' }, 502)
  }

  return new Response(result.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

/**
 * Cancel a render. Refund policy mirrors mercurypitch: a job cancelled while
 * still IN_QUEUE never consumed GPU time and is refunded; once it is running
 * the spend is real and the credit stays consumed.
 */
async function handleCancelRender(
  env: Env,
  userId: string,
  jobId: string,
): Promise<Response> {
  const job = await getRenderJob(env.CHAOS_DB, jobId)
  if (!job) {
    return json({ error: 'Job not found' }, 404)
  }
  if (job.userId !== userId) {
    return json({ error: 'Unauthorized' }, 403)
  }
  if (isTerminalStatus(job.status)) {
    return json({ id: job.id, status: job.status })
  }

  let refunded = false
  const runpod = runpodConfigured(env)
  if (job.runpodJobId && runpod) {
    let inQueue = false
    try {
      inQueue = (await fetchRunpodStatus(runpod, job.runpodJobId)).inQueue
    } catch {
      // Pre-cancel state unreadable — treat as running (not refundable),
      // matching the conservative mercurypitch policy.
    }
    await cancelRunpodJob(runpod, job.runpodJobId)
    if (inQueue) {
      refunded = await refundCredits(env.CHAOS_DB, job.id)
    }
  }

  job.status = 'cancelled'
  job.updatedAt = isoNow()
  await updateRenderJob(env.CHAOS_DB, job)
  return json({ id: job.id, status: job.status, refunded })
}

async function handleListUserRenders(
  env: Env,
  userId: string,
): Promise<Response> {
  const jobs = await getRenderJobsByUser(env.CHAOS_DB, userId)
  return json(
    jobs.map((j) => ({
      id: j.id,
      status: j.status,
      progress: j.progress,
      createdAt: j.createdAt,
      error: j.error,
    })),
  )
}

// ── Stripe Integration ──────────────────────────────────────────

const CREDIT_PACKS: Record<
  string,
  { name: string; credits: number; priceId?: string }
> = {
  starter: { name: 'Starter Pack', credits: 10 },
  creator: { name: 'Creator Pack', credits: 50 },
  pro: { name: 'Pro Pack', credits: 200 },
}

const SUBSCRIPTION_PLANS: Record<
  string,
  { name: string; tier: string; monthlyCredits: number; priceId?: string }
> = {
  premium: { name: 'Premium', tier: 'premium', monthlyCredits: 50 },
  pro_sub: { name: 'Pro', tier: 'pro', monthlyCredits: 200 },
}

async function handleStripeCheckout(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  const body = (await request.json()) as {
    type?: 'credits' | 'subscription'
    sku?: string
    successUrl?: string
    cancelUrl?: string
  }

  if (mockCheckoutAllowed(env)) {
    const referer = request.headers.get('Referer')
    let successUrl = body.successUrl || '/?success=1'
    if (referer) {
      try {
        const refUrl = new URL(referer)
        successUrl = new URL('/?success=1', refUrl.origin).toString()
      } catch (_) {
        // Ignored
      }
    }

    const existingSub = await getSubscriptionByUserId(env.CHAOS_DB, userId)
    const now = new Date().toISOString()
    const oneMonthLater = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString()

    if (body.type === 'credits' && body.sku && CREDIT_PACKS[body.sku]) {
      const pack = CREDIT_PACKS[body.sku]!
      const currentCredits = existingSub?.renderLimitMonthly || 5
      await upsertSubscription(env.CHAOS_DB, {
        id: existingSub?.id || generateId(),
        createdAt: existingSub?.createdAt || now,
        updatedAt: now,
        userId,
        tier: existingSub?.tier || 'free',
        status: 'active',
        currentPeriodStart: existingSub?.currentPeriodStart || now,
        currentPeriodEnd: existingSub?.currentPeriodEnd || oneMonthLater,
        rendersThisMonth: existingSub?.rendersThisMonth || 0,
        renderLimitMonthly: currentCredits + pack.credits,
        stripeCustomerId: existingSub?.stripeCustomerId || 'mock_customer_id',
        stripeSubscriptionId:
          existingSub?.stripeSubscriptionId || 'mock_sub_id',
      })
      // Each mock purchase is a distinct grant (unique key on purpose).
      await grantCredits(
        env.CHAOS_DB,
        userId,
        pack.credits,
        'mock-credit-pack',
        `grant:mock:${generateId()}`,
      )
    } else if (
      body.type === 'subscription' &&
      body.sku &&
      SUBSCRIPTION_PLANS[body.sku]
    ) {
      const plan = SUBSCRIPTION_PLANS[body.sku]!
      await upsertSubscription(env.CHAOS_DB, {
        id: existingSub?.id || generateId(),
        createdAt: existingSub?.createdAt || now,
        updatedAt: now,
        userId,
        tier: plan.tier,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: oneMonthLater,
        rendersThisMonth: 0,
        renderLimitMonthly: plan.monthlyCredits,
        stripeCustomerId: existingSub?.stripeCustomerId || 'mock_customer_id',
        stripeSubscriptionId:
          existingSub?.stripeSubscriptionId || 'mock_sub_id',
      })
      await grantCredits(
        env.CHAOS_DB,
        userId,
        plan.monthlyCredits,
        'mock-subscription',
        `grant:mock:${generateId()}`,
      )
    } else {
      return json({ error: 'Invalid type or SKU' }, 400)
    }

    return json({ url: successUrl })
  }

  if (!env.STRIPE_SECRET_KEY) {
    // Prod (or any tier once a key exists) never mints mock upgrades.
    return json({ error: 'Billing is not configured' }, 503)
  }

  // Redirect targets must stay on our own origins — Stripe sends the user's
  // browser there after checkout, so an arbitrary URL would be an open
  // redirect laundered through a legitimate stripe.com page.
  const safeReturnUrl = (candidate: string | undefined, fallback: string) => {
    if (!candidate) return fallback
    try {
      return allowedOrigins(env).includes(new URL(candidate).origin)
        ? candidate
        : fallback
    } catch {
      return fallback
    }
  }
  const successUrl = safeReturnUrl(
    body.successUrl,
    'https://lumenapeiron.com/?success=1',
  )
  const cancelUrl = safeReturnUrl(
    body.cancelUrl,
    'https://lumenapeiron.com/?canceled=1',
  )

  const params = new URLSearchParams()
  params.set('success_url', successUrl)
  params.set('cancel_url', cancelUrl)
  params.set('client_reference_id', userId)

  if (body.type === 'credits' && body.sku && CREDIT_PACKS[body.sku]) {
    const pack = CREDIT_PACKS[body.sku]!
    params.set('mode', 'payment')
    params.set('line_items[0][quantity]', '1')
    params.set('line_items[0][price_data][currency]', 'usd')
    params.set('line_items[0][price_data][product_data][name]', pack.name)
    params.set(
      'line_items[0][price_data][product_data][description]',
      `${pack.credits} server renders`,
    )
    params.set(
      'line_items[0][price_data][unit_amount]',
      String(
        body.sku === 'starter' ? 500 : body.sku === 'creator' ? 1500 : 4000,
      ),
    )
    params.set('metadata[type]', 'credits')
    params.set('metadata[sku]', body.sku)
    params.set('metadata[credits]', String(pack.credits))
  } else if (
    body.type === 'subscription' &&
    body.sku &&
    SUBSCRIPTION_PLANS[body.sku]
  ) {
    const plan = SUBSCRIPTION_PLANS[body.sku]!
    params.set('mode', 'subscription')
    params.set('line_items[0][quantity]', '1')
    params.set('line_items[0][price_data][currency]', 'usd')
    params.set('line_items[0][price_data][product_data][name]', plan.name)
    params.set(
      'line_items[0][price_data][product_data][description]',
      `${plan.monthlyCredits} renders/month + premium features`,
    )
    params.set(
      'line_items[0][price_data][unit_amount]',
      String(body.sku === 'premium' ? 800 : 2000),
    )
    params.set('line_items[0][price_data][recurring][interval]', 'month')
    params.set('metadata[type]', 'subscription')
    params.set('metadata[sku]', body.sku)
    params.set('metadata[credits]', String(plan.monthlyCredits))
    params.set('metadata[tier]', plan.tier)
  } else {
    return json({ error: 'Invalid type or SKU' }, 400)
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } }
    console.error('Stripe checkout error:', err)
    return json({ error: err.error?.message || 'Stripe checkout failed' }, 502)
  }

  const session = (await res.json()) as { id: string; url: string }
  return json({ url: session.url })
}

async function handleStripePortal(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  if (mockCheckoutAllowed(env)) {
    // Mock "manage billing": downgrade back to free so tier flows can be
    // exercised round-trip without Stripe.
    const sub = await getSubscriptionByUserId(env.CHAOS_DB, userId)
    if (sub) {
      const now = new Date().toISOString()
      await upsertSubscription(env.CHAOS_DB, {
        ...sub,
        updatedAt: now,
        tier: 'free',
        renderLimitMonthly: 5,
      })
    }
    const returnUrl = request.headers.get('Referer') || '/'
    return json({ url: returnUrl })
  }

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Billing is not configured' }, 503)
  }

  const sub = await getSubscriptionByUserId(env.CHAOS_DB, userId)
  if (!sub?.stripeCustomerId) {
    return json({ error: 'No Stripe customer found' }, 404)
  }

  const params = new URLSearchParams()
  params.set('customer', sub.stripeCustomerId)
  params.set(
    'return_url',
    request.headers.get('Referer') || 'https://chaos-master.com',
  )

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    return json({ error: 'Failed to create portal session' }, 502)
  }

  const session = (await res.json()) as { url: string }
  return json({ url: session.url })
}

// Max accepted age (and future skew) of a Stripe webhook, in seconds. Stripe's
// own SDKs default to 5 minutes; anything older is treated as a replay.
const STRIPE_WEBHOOK_TOLERANCE_SECS = 300

/** Constant-time string equality (both args must be same-charset hex). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Verify a Stripe webhook signature header (`t=<unix>,v1=<hex>[,v1=...]`).
 * Computes HMAC-SHA256 over `${t}.${payload}`, compares the hex digest against
 * every `v1` entry in constant time, and rejects timestamps outside the replay
 * tolerance window.
 */
export async function verifyStripeWebhook(
  payload: string,
  signature: string,
  secret: string,
  nowSecs = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  let timestamp: number | undefined
  const candidates: string[] = []
  for (const part of signature.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't') timestamp = Number(v)
    else if (k === 'v1') candidates.push(v)
  }
  if (
    timestamp === undefined ||
    !Number.isFinite(timestamp) ||
    candidates.length === 0
  ) {
    return false
  }
  if (Math.abs(nowSecs - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECS) {
    return false
  }

  const encoder = new TextEncoder()
  // eslint-disable-next-line no-restricted-globals
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // eslint-disable-next-line no-restricted-globals
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${payload}`),
  )
  const expectedHex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  let valid = false
  for (const candidate of candidates) {
    if (timingSafeEqualStr(expectedHex, candidate.toLowerCase())) {
      valid = true
    }
  }
  return valid
}

async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe not configured' }, 503)
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return json({ error: 'Missing stripe-signature' }, 400)
  }

  const payload = await request.text()

  // Verify webhook signature
  const valid = await verifyStripeWebhook(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  )
  if (!valid) {
    return json({ error: 'Invalid signature' }, 400)
  }

  const event = JSON.parse(payload) as {
    id?: string
    type: string
    data: { object: Record<string, unknown> }
  }

  const obj = event.data.object
  // Stripe retries webhooks — the event id keys every grant so a redelivered
  // event can never double-credit.
  const eventId = event.id ?? generateId()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = obj as {
          client_reference_id?: string
          customer?: string
          subscription?: string
          metadata?: {
            type?: string
            sku?: string
            credits?: string
            tier?: string
          }
        }
        const userId = session.client_reference_id
        if (!userId) break

        const now = isoNow()
        const existingSub = await getSubscriptionByUserId(env.CHAOS_DB, userId)

        if (session.metadata?.type === 'credits') {
          // One-time credit purchase
          const credits = parseInt(session.metadata.credits || '0', 10)
          if (credits > 0) {
            await grantCredits(
              env.CHAOS_DB,
              userId,
              credits,
              'stripe-credit-pack',
              `grant:stripe:${eventId}`,
            )
          }
          const currentCredits = existingSub?.renderLimitMonthly || 5
          await upsertSubscription(env.CHAOS_DB, {
            id: existingSub?.id || generateId(),
            createdAt: existingSub?.createdAt || now,
            updatedAt: now,
            userId,
            tier: existingSub?.tier || 'free',
            status: 'active',
            currentPeriodStart: existingSub?.currentPeriodStart || now,
            currentPeriodEnd: existingSub?.currentPeriodEnd || now,
            rendersThisMonth: existingSub?.rendersThisMonth || 0,
            renderLimitMonthly: currentCredits + credits,
            stripeCustomerId:
              existingSub?.stripeCustomerId ||
              (session.customer as string) ||
              null,
            stripeSubscriptionId: existingSub?.stripeSubscriptionId || null,
          })
        } else if (session.metadata?.type === 'subscription') {
          // Monthly subscription with credits
          const tier = (session.metadata.tier as string) || 'premium'
          const monthlyCredits = parseInt(session.metadata.credits || '0', 10)
          if (monthlyCredits > 0) {
            await grantCredits(
              env.CHAOS_DB,
              userId,
              monthlyCredits,
              'stripe-subscription',
              `grant:stripe:${eventId}`,
            )
          }
          await upsertSubscription(env.CHAOS_DB, {
            id: existingSub?.id || generateId(),
            createdAt: existingSub?.createdAt || now,
            updatedAt: now,
            userId,
            tier,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: now, // updated by subscription.updated event
            rendersThisMonth: 0,
            renderLimitMonthly: monthlyCredits,
            stripeCustomerId:
              (session.customer as string) ||
              existingSub?.stripeCustomerId ||
              null,
            stripeSubscriptionId:
              (session.subscription as string) ||
              existingSub?.stripeSubscriptionId ||
              null,
          })
        }
        break
      }

      case 'customer.subscription.updated': {
        void (obj as {
          customer?: string
          status?: string
          current_period_start?: number
          current_period_end?: number
        })
        break
      }

      case 'customer.subscription.deleted': {
        void (obj as { customer?: string })
        break
      }
    }
  } catch (err) {
    console.error('Webhook error:', err)
    return json({ error: 'Webhook processing failed' }, 500)
  }

  return json({ received: true })
}

// ── KV Shortener (existing) ──────────────────────────────────────

// How long a job may sit queued/running without an update before the sweep
// declares it dead. RunPod's execution timeout is 300s; 15 min leaves ample
// headroom for queue waits before credits are returned.
const STALE_JOB_CUTOFF_MS = 15 * 60 * 1000

/**
 * Cron sweep: no job may stay queued/running forever. For each stale job,
 * first try to RECONCILE (a completed render that merely lost its polls must
 * finalize, not refund), then fail + refund. Every path is idempotent, so the
 * sweep can race live status polls safely.
 */
export async function sweepStaleRenderJobs(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_JOB_CUTOFF_MS).toISOString()
  const stale = await getStaleRenderJobs(env.CHAOS_DB, cutoff)
  const runpod = runpodConfigured(env)

  for (const job of stale) {
    try {
      if (job.runpodJobId && runpod) {
        try {
          await applyRunpodStatus(
            env,
            job,
            await fetchRunpodStatus(runpod, job.runpodJobId),
          )
          if (isTerminalStatus(job.status)) {
            console.info(
              `[sweep] reconciled job=${job.id} -> ${job.status} (live status)`,
            )
            continue
          }
          // Still queued/running past the cutoff: give up on it.
          await cancelRunpodJob(runpod, job.runpodJobId)
        } catch (err) {
          if (err instanceof RunpodJobExpiredError) {
            await reconcileExpiredJob(env, job)
            console.info(
              `[sweep] reconciled job=${job.id} -> ${job.status} (expired; R2 checked)`,
            )
            continue
          }
          // Transient status failure during a sweep of an ALREADY-stale job:
          // fall through to the timeout path below rather than leaving it
          // stuck another cycle — the refund is idempotent either way.
          console.error(
            `[sweep] status failure job=${job.id} runpod=${job.runpodJobId}: ${errMsg(err)}`,
          )
        }
      }
      const stuckIn = job.status
      await markJobFailed(env, job, `Render timed out (stuck ${stuckIn})`)
      const refunded = await refundCredits(env.CHAOS_DB, job.id)
      console.error(
        `[sweep] TIMED OUT job=${job.id} runpod=${job.runpodJobId ?? '-'} stuckIn=${stuckIn} refunded=${refunded}`,
      )
    } catch (err) {
      console.error('[sweep] Failed to reconcile job', job.id, errMsg(err))
    }
  }
}

export const baseHandler = {
  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // Keep the benchmark route canonical. The Vite build currently uses a
    // relative asset base, so serving index.html at `/benchmarks/` would make
    // its asset URLs resolve under `/benchmarks/assets/`.
    if (
      pathname === '/benchmarks/' &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      url.pathname = '/benchmarks'
      return Response.redirect(url.toString(), 308)
    }

    // The Arcade has a real path for sharing, but the app routes tabs by
    // fragment (lib/activeTab.ts), so hand it to the SPA as `#arcade`.
    if (
      (pathname === '/arcade' || pathname === '/arcade/') &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      url.pathname = '/'
      url.hash = 'arcade'
      return Response.redirect(url.toString(), 308)
    }

    // Rate-limit the write endpoints per IP.
    const rateLimitResponse = await checkApiRateLimit(request, env)
    if (rateLimitResponse) return rateLimitResponse

    // ── App API routes (auth / renders / billing) ──────────────────────────────
    const cors = corsHeaders(env, request.headers.get('Origin'))

    // CORS preflight for the app API (auth flows may run cross-origin in dev).
    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: cors })
    }

    // ── Auth routes ────────────────────────────────────

    if (pathname === '/api/auth/anonymous' && request.method === 'POST') {
      const res = await handleAnonymousAuth(request, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/auth/google' && request.method === 'POST') {
      const res = await handleGoogleAuth(request, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/auth/google/start' && request.method === 'GET') {
      const res = await handleGoogleStart(request, env)
      const headers = new Headers(cors)
      if (res.headers.has('Location')) {
        headers.set('Location', res.headers.get('Location')!)
      }
      return new Response(res.body, {
        status: res.status,
        headers,
      })
    }

    if (pathname === '/api/auth/google/callback' && request.method === 'GET') {
      const res = await handleGoogleCallback(request, env)
      const headers = new Headers(cors)
      if (res.headers.has('Location')) {
        headers.set('Location', res.headers.get('Location')!)
      }
      return new Response(res.body, {
        status: res.status,
        headers,
      })
    }

    if (pathname === '/api/auth/register' && request.method === 'POST') {
      const res = await handleRegister(request, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      const res = await handleLogin(request, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/auth/upgrade' && request.method === 'POST') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleUpgradeAnonymous(request, env, auth.userId)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/auth/me' && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const user = await getUserById(env.CHAOS_DB, auth.userId)
      if (!user) return json({ error: 'User not found' }, 404)
      return new Response(
        JSON.stringify({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: user.avatarUrl,
          authProvider: user.authProvider,
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      )
    }

    if (pathname === '/api/auth/subscription' && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const sub = await getSubscriptionByUserId(env.CHAOS_DB, auth.userId)
      const credits = await creditBalance(env.CHAOS_DB, auth.userId)
      return new Response(
        JSON.stringify({
          ...(sub || {
            tier: 'free',
            rendersThisMonth: 0,
            renderLimitMonthly: 5,
          }),
          credits,
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      )
    }

    // ── Feature flags ─────────────────────────────────

    if (pathname === '/api/feature-flags' && request.method === 'GET') {
      const flags = await getAllFeatureFlags(env.CHAOS_DB)
      const map: Record<string, boolean> = {}
      for (const f of flags) {
        map[f.key] = f.value === 1
        const camelKey = f.key.replace(/_([a-z])/g, (_, char) =>
          char.toUpperCase(),
        )
        map[camelKey] = f.value === 1
      }
      // Deployment capability, not a D1 flag: whether the render endpoint's
      // image ships headless Chrome. The client uses it to offer (or hide) the
      // chrome engine instead of letting users pick an option that 400s.
      map.chrome_render_engine = chromeEngineAvailable(env)
      map.chromeRenderEngine = map.chrome_render_engine
      return new Response(JSON.stringify(map), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── Render routes ──────────────────────────────────

    if (pathname === '/api/renders' && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleListUserRenders(env, auth.userId)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/renders' && request.method === 'POST') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      // Per-USER burst cap (the generic API_RL above is per-IP): GPU time is
      // the costliest resource behind any route, so scripted hammering gets a
      // 429 before it ever reaches RunPod. Fail-open like the other limiters —
      // a limiter hiccup must not take rendering down.
      try {
        const { success } = await env.RENDER_RL!.limit({ key: auth.userId })
        if (!success) {
          return new Response(
            JSON.stringify({
              error: 'Too many render requests — try again in a minute',
            }),
            {
              status: 429,
              headers: { ...cors, 'Content-Type': 'application/json' },
            },
          )
        }
      } catch (err) {
        console.error('Render rate limit check failed (allowing):', errMsg(err))
      }
      const res = await handleSubmitRender(request, env, auth.userId)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const renderStatusMatch = pathname.match(/^\/api\/renders\/([^/]+)$/)
    if (renderStatusMatch && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleGetRenderStatus(
        request,
        env,
        auth.userId,
        renderStatusMatch[1]!,
      )
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const renderResultMatch = pathname.match(
      /^\/api\/renders\/([^/]+)\/result$/,
    )
    if (renderResultMatch && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleGetRenderResult(
        request,
        env,
        auth.userId,
        renderResultMatch[1]!,
      )
      return res
    }

    const renderCancelMatch = pathname.match(
      /^\/api\/renders\/([^/]+)\/cancel$/,
    )
    if (renderCancelMatch && request.method === 'POST') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleCancelRender(
        env,
        auth.userId,
        renderCancelMatch[1]!,
      )
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── Stripe routes ────────────────────────────────

    if (pathname === '/api/stripe/checkout' && request.method === 'POST') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleStripeCheckout(request, env, auth.userId)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/stripe/webhook' && request.method === 'POST') {
      const res = await handleStripeWebhook(request, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/api/stripe/portal' && request.method === 'GET') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const res = await handleStripePortal(request, env, auth.userId)
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Shortener endpoints
    if (pathname === '/api/shorten' && request.method === 'POST') {
      return handleShortenPost(request, env)
    }

    if (pathname.startsWith('/api/shorten/') && request.method === 'GET') {
      return handleShortenGet(pathname, env)
    }

    // Home gallery endpoints (must match config and poster before per-slug)
    if (pathname === '/api/gallery/config' && request.method === 'GET') {
      return handleGalleryConfig(env)
    }

    if (
      pathname.startsWith('/api/gallery/poster/') &&
      request.method === 'GET'
    ) {
      return handleGalleryPoster(pathname, env)
    }

    if (pathname === '/api/gallery' && request.method === 'GET') {
      return handleGalleryList(url, env)
    }

    if (pathname.startsWith('/api/gallery/') && request.method === 'GET') {
      return handleGallerySlug(pathname, env)
    }

    // Open Graph image upload & preview
    if (pathname.startsWith('/api/og/') && request.method === 'POST') {
      return handleOgPost(request, env, pathname)
    }

    if (pathname.startsWith('/og/') && request.method === 'GET') {
      return handleOgGet(pathname, env)
    }

    // Discord share & invite
    if (pathname === '/api/share-discord' && request.method === 'POST') {
      return handleShareDiscord(request, env, url)
    }

    if (pathname === '/discord' && request.method === 'GET') {
      return handleDiscordRedirect(env)
    }

    // Inject meta tags for shared links so crawlers see a rich preview
    if (
      (pathname === '/' || pathname === '/index.html') &&
      request.method === 'GET'
    ) {
      const metaRes = await handleMetaInject(request, env, url)
      if (metaRes) return metaRes
    }

    // Unknown API routes must remain API-shaped 404s.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404)
    }

    // Everything else → static assets (the frontend)
    return env.ASSETS.fetch(request)
  },
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url)
    if (!isReviewHost(url)) {
      return withSecurityHeaders(await baseHandler.fetch(request, env, ctx))
    }

    // The review deploy serves production's build from a different origin, so
    // it is kept out of search here at the boundary rather than inside the
    // routes. Two layers, because they stop different things: this robots.txt
    // prevents the crawl, and the header prevents indexing anything already
    // fetched. See middleware/reviewHost.ts.
    const isRead = request.method === 'GET' || request.method === 'HEAD'
    const response =
      url.pathname === '/robots.txt' && isRead
        ? reviewRobotsTxt()
        : await baseHandler.fetch(request, env, ctx)
    return withNoIndex(withSecurityHeaders(response))
  },
  async scheduled(_event: unknown, env: Env, _ctx: unknown): Promise<void> {
    await sweepStaleRenderJobs(env)
  },
}
