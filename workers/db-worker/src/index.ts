/**
 * db-worker: Auth + CRUD REST API for chaos-master premium features.
 *
 * Endpoints:
 *   POST /api/auth/anonymous — Create anonymous user, return JWT
 *   POST /api/auth/google     — Google OAuth login/signup, return JWT
 *   POST /api/auth/register   — Email/password registration
 *   POST /api/auth/login      — Email/password login
 *   GET  /api/auth/me         — Current user profile
 *   GET  /api/subscription    — Current user subscription
 *   POST /api/render          — Submit render job
 *   GET  /api/render/:id      — Get render job status
 *   GET  /api/feature-flags  — Public feature flags
 */

import {
  generateToken,
  hashPassword,
  verifyGoogleToken,
  verifyPassword,
  verifyToken,
} from './auth'
import {
  createRenderJob,
  createSubscription,
  createUser,
  getFeatureFlags,
  getRenderJobById,
  getSubscriptionByUserId,
  getUserByEmail,
  getUserById,
  incrementRenderCount,
  updateUser,
} from './tables'
import type { D1Database } from './tables'

const JWT_SECRET = 'chaos-master-jwt-secret-change-in-production'

interface Env {
  DB: D1Database
  JWT_SECRET?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

async function getUserIdFromRequest(
  request: Request,
  env: Env,
): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const secret = env.JWT_SECRET ?? JWT_SECRET
  const payload = await verifyToken(token, secret)
  return payload?.sub ?? null
}

async function handleAnonymousAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as { deviceId?: string }
  const deviceId = body.deviceId ?? globalThis.crypto.randomUUID()

  const userId = globalThis.crypto.randomUUID()
  await createUser(env.DB, {
    id: userId,
    authProvider: 'anonymous',
    providerId: deviceId,
    email: null,
    passwordHash: null,
    emailVerified: 0,
    displayName: 'Explorer',
    avatarUrl: null,
  })

  // Create default free subscription
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)
  await createSubscription(env.DB, {
    id: globalThis.crypto.randomUUID(),
    userId,
    tier: 'free',
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    rendersThisMonth: 0,
    renderLimitMonthly: 5,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  })

  const secret = env.JWT_SECRET ?? JWT_SECRET
  const token = await generateToken({ sub: userId, provider: 'anonymous' }, secret)

  return json({ token, userId, tier: 'free' })
}

async function handleGoogleAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as { idToken?: string }
  if (!body.idToken) return error('Missing idToken')

  const googleUser = await verifyGoogleToken(body.idToken)
  if (!googleUser) return error('Invalid Google token', 401)

  // Find existing user by email or create new one
  let user = await getUserByEmail(env.DB, googleUser.email)
  if (!user) {
    const userId = globalThis.crypto.randomUUID()
    await createUser(env.DB, {
      id: userId,
      authProvider: 'google',
      providerId: googleUser.sub,
      email: googleUser.email,
      passwordHash: null,
      emailVerified: 1,
      displayName: googleUser.name,
      avatarUrl: googleUser.picture ?? null,
    })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)
    await createSubscription(env.DB, {
      id: globalThis.crypto.randomUUID(),
      userId,
      tier: 'free',
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      rendersThisMonth: 0,
      renderLimitMonthly: 5,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })

    user = (await getUserById(env.DB, userId))!
  } else if (user.authProvider === 'anonymous') {
    // Upgrade anonymous user to Google
    await updateUser(env.DB, user.id, {
      authProvider: 'google',
      providerId: googleUser.sub,
      email: googleUser.email,
      emailVerified: 1,
      displayName: googleUser.name,
      avatarUrl: googleUser.picture,
    })
    user = (await getUserById(env.DB, user.id))!
  }

  const sub = await getSubscriptionByUserId(env.DB, user.id)
  const secret = env.JWT_SECRET ?? JWT_SECRET
  const token = await generateToken({ sub: user.id, provider: 'google' }, secret)

  return json({ token, userId: user.id, tier: sub?.tier ?? 'free' })
}

async function handleRegister(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as {
    email?: string
    password?: string
    displayName?: string
  }
  if (!body.email || !body.password) return error('Missing email or password')
  if (body.password.length < 8) return error('Password must be at least 8 characters')

  const existing = await getUserByEmail(env.DB, body.email)
  if (existing) return error('Email already registered', 409)

  const passwordHash = await hashPassword(body.password)
  const userId = globalThis.crypto.randomUUID()
  await createUser(env.DB, {
    id: userId,
    authProvider: 'email',
    providerId: null,
    email: body.email,
    passwordHash,
    emailVerified: 0,
    displayName: body.displayName ?? body.email.split('@')[0] ?? 'Explorer',
    avatarUrl: null,
  })

  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)
  await createSubscription(env.DB, {
    id: globalThis.crypto.randomUUID(),
    userId,
    tier: 'free',
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    rendersThisMonth: 0,
    renderLimitMonthly: 5,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  })

  const secret = env.JWT_SECRET ?? JWT_SECRET
  const token = await generateToken({ sub: userId, provider: 'email' }, secret)

  return json({ token, userId, tier: 'free' }, 201)
}

async function handleLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as { email?: string; password?: string }
  if (!body.email || !body.password) return error('Missing email or password')

  const user = await getUserByEmail(env.DB, body.email)
  if (!user || !user.passwordHash) return error('Invalid email or password', 401)

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) return error('Invalid email or password', 401)

  const sub = await getSubscriptionByUserId(env.DB, user.id)
  const secret = env.JWT_SECRET ?? JWT_SECRET
  const token = await generateToken({ sub: user.id, provider: user.authProvider }, secret)

  return json({ token, userId: user.id, tier: sub?.tier ?? 'free' })
}

async function handleGetMe(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await getUserIdFromRequest(request, env)
  if (!userId) return error('Unauthorized', 401)

  const user = await getUserById(env.DB, userId)
  if (!user) return error('User not found', 404)

  const sub = await getSubscriptionByUserId(env.DB, userId)

  return json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    emailVerified: !!user.emailVerified,
    subscription: sub
      ? {
          tier: sub.tier,
          status: sub.status,
          rendersThisMonth: sub.rendersThisMonth,
          renderLimitMonthly: sub.renderLimitMonthly,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null,
  })
}

async function handleGetSubscription(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await getUserIdFromRequest(request, env)
  if (!userId) return error('Unauthorized', 401)

  const sub = await getSubscriptionByUserId(env.DB, userId)
  if (!sub) return error('No subscription found', 404)

  return json(sub)
}

async function handleSubmitRender(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = await getUserIdFromRequest(request, env)
  if (!userId) return error('Unauthorized', 401)

  const sub = await getSubscriptionByUserId(env.DB, userId)
  if (!sub) return error('No subscription found', 404)

  if (sub.status !== 'active') return error('Subscription is not active', 403)
  if (sub.rendersThisMonth >= sub.renderLimitMonthly) {
    return error('Monthly render limit reached. Upgrade for more renders.', 429)
  }

  const body = (await request.json()) as {
    flameJson: string
    options: { width: number; height: number; quality: number }
  }
  if (!body.flameJson || !body.options) return error('Missing flameJson or options')

  const limits = {
    free: { maxRes: 1920 * 1080, maxQuality: 0.3 },
    premium: { maxRes: 3840 * 2160, maxQuality: 0.7 },
    pro: { maxRes: 7680 * 4320, maxQuality: 1.0 },
  }
  const tierLimit = limits[sub.tier as keyof typeof limits] ?? limits.free
  if (body.options.width * body.options.height > tierLimit.maxRes) {
    return error(
      `Maximum resolution for ${sub.tier} tier is ${tierLimit.maxRes} pixels`,
      413,
    )
  }
  if (body.options.quality > tierLimit.maxQuality) {
    return error(
      `Maximum quality for ${sub.tier} tier is ${tierLimit.maxQuality}`,
      413,
    )
  }

  const jobId = globalThis.crypto.randomUUID()
  const seed = globalThis.crypto.randomUUID()
  await createRenderJob(env.DB, {
    id: jobId,
    userId,
    status: 'queued',
    flameJson: body.flameJson,
    optionsJson: JSON.stringify(body.options),
    progress: 0,
    resultUrl: null,
    error: null,
    renderTimeMs: null,
    seed,
  })

  await incrementRenderCount(env.DB, userId)

  return json({ jobId, status: 'queued' }, 201)
}

async function handleGetRenderJob(
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> {
  const userId = await getUserIdFromRequest(request, env)
  if (!userId) return error('Unauthorized', 401)

  const job = await getRenderJobById(env.DB, jobId)
  if (!job) return error('Render job not found', 404)
  if (job.userId !== userId) return error('Forbidden', 403)

  return json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    resultUrl: job.resultUrl,
    error: job.error,
    renderTimeMs: job.renderTimeMs,
  })
}

async function handleGetFeatureFlags(env: Env): Promise<Response> {
  const flags = await getFeatureFlags(env.DB)
  const map: Record<string, boolean> = {}
  for (const flag of flags) {
    map[flag.key] = flag.value === 1
  }
  return json(map)
}

// Router
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  let response: Response

  if (path === '/api/auth/anonymous' && request.method === 'POST') {
    response = await handleAnonymousAuth(request, env)
  } else if (path === '/api/auth/google' && request.method === 'POST') {
    response = await handleGoogleAuth(request, env)
  } else if (path === '/api/auth/register' && request.method === 'POST') {
    response = await handleRegister(request, env)
  } else if (path === '/api/auth/login' && request.method === 'POST') {
    response = await handleLogin(request, env)
  } else if (path === '/api/auth/me' && request.method === 'GET') {
    response = await handleGetMe(request, env)
  } else if (path === '/api/subscription' && request.method === 'GET') {
    response = await handleGetSubscription(request, env)
  } else if (path === '/api/render' && request.method === 'POST') {
    response = await handleSubmitRender(request, env)
  } else if (path.startsWith('/api/render/') && request.method === 'GET') {
    const jobId = path.slice('/api/render/'.length)
    response = await handleGetRenderJob(request, env, jobId)
  } else if (path === '/api/feature-flags' && request.method === 'GET') {
    response = await handleGetFeatureFlags(env)
  } else {
    response = json({ error: 'Not Found' }, 404)
  }

  response.headers.set('Access-Control-Allow-Origin', '*')
  return response
}

export default {
  fetch: handleRequest,
}
