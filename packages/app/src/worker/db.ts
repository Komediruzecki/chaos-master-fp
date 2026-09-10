/**
 * D1 database query helpers for auth and CRUD operations.
 */

export interface DbUser {
  id: string
  createdAt: string
  updatedAt: string
  authProvider: string
  providerId: string | null
  email: string | null
  passwordHash: string | null
  emailVerified: number
  displayName: string
  avatarUrl: string | null
}

export interface DbSubscription {
  id: string
  createdAt: string
  updatedAt: string
  userId: string
  tier: string
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  rendersThisMonth: number
  renderLimitMonthly: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface DbRenderJob {
  id: string
  createdAt: string
  updatedAt: string
  userId: string
  status: string
  flameJson: string
  optionsJson: string
  progress: number
  resultUrl: string | null
  runpodJobId: string | null
  /** Trimmed raw RunPod status payload from the last reconcile — the
   *  post-mortem record (workerId, delay/execution times, error). */
  runpodStatusJson: string | null
  error: string | null
  renderTimeMs: number | null
  seed: string
}

export interface DbLedgerEntry {
  id: string
  createdAt: string
  userId: string
  delta: number
  reason: string | null
  jobRef: string | null
  idempotencyKey: string | null
}

export interface DbFeatureFlag {
  id: string
  key: string
  value: number
}

// Users

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<DbUser | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DbUser>()
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<DbUser | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<DbUser>()
}

export async function getUserByProviderId(
  db: D1Database,
  provider: string,
  providerId: string,
): Promise<DbUser | null> {
  return db
    .prepare('SELECT * FROM users WHERE authProvider = ? AND providerId = ?')
    .bind(provider, providerId)
    .first<DbUser>()
}

export async function createUser(db: D1Database, user: DbUser): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, createdAt, updatedAt, authProvider, providerId, email, passwordHash, emailVerified, displayName, avatarUrl)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      user.id,
      user.createdAt,
      user.updatedAt,
      user.authProvider,
      user.providerId,
      user.email,
      user.passwordHash,
      user.emailVerified,
      user.displayName,
      user.avatarUrl,
    )
    .run()
}

export async function updateUser(db: D1Database, user: DbUser): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET updatedAt = ?, authProvider = ?, providerId = ?, email = ?, passwordHash = ?, emailVerified = ?, displayName = ?, avatarUrl = ? WHERE id = ?`,
    )
    .bind(
      user.updatedAt,
      user.authProvider,
      user.providerId,
      user.email,
      user.passwordHash,
      user.emailVerified,
      user.displayName,
      user.avatarUrl,
      user.id,
    )
    .run()
}

// Subscriptions

export async function getSubscriptionByUserId(
  db: D1Database,
  userId: string,
): Promise<DbSubscription | null> {
  return db
    .prepare('SELECT * FROM subscriptions WHERE userId = ?')
    .bind(userId)
    .first<DbSubscription>()
}

export async function createSubscription(
  db: D1Database,
  sub: DbSubscription,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions (id, createdAt, updatedAt, userId, tier, status, currentPeriodStart, currentPeriodEnd, rendersThisMonth, renderLimitMonthly, stripeCustomerId, stripeSubscriptionId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sub.id,
      sub.createdAt,
      sub.updatedAt,
      sub.userId,
      sub.tier,
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.rendersThisMonth,
      sub.renderLimitMonthly,
      sub.stripeCustomerId,
      sub.stripeSubscriptionId,
    )
    .run()
}

export async function upsertSubscription(
  db: D1Database,
  sub: DbSubscription,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions (id, createdAt, updatedAt, userId, tier, status, currentPeriodStart, currentPeriodEnd, rendersThisMonth, renderLimitMonthly, stripeCustomerId, stripeSubscriptionId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       updatedAt = excluded.updatedAt,
       tier = excluded.tier,
       status = excluded.status,
       currentPeriodStart = excluded.currentPeriodStart,
       currentPeriodEnd = excluded.currentPeriodEnd,
       rendersThisMonth = excluded.rendersThisMonth,
       renderLimitMonthly = excluded.renderLimitMonthly,
       stripeCustomerId = excluded.stripeCustomerId,
       stripeSubscriptionId = excluded.stripeSubscriptionId`,
    )
    .bind(
      sub.id,
      sub.createdAt,
      sub.updatedAt,
      sub.userId,
      sub.tier,
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.rendersThisMonth,
      sub.renderLimitMonthly,
      sub.stripeCustomerId,
      sub.stripeSubscriptionId,
    )
    .run()
}

export async function incrementRenderCount(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE subscriptions SET rendersThisMonth = rendersThisMonth + 1, updatedAt = ? WHERE userId = ?',
    )
    .bind(new Date().toISOString(), userId)
    .run()
}

// Render jobs

export async function createRenderJob(
  db: D1Database,
  job: DbRenderJob,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO render_jobs (id, createdAt, updatedAt, userId, status, flameJson, optionsJson, progress, resultUrl, runpodJobId, runpodStatusJson, error, renderTimeMs, seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.id,
      job.createdAt,
      job.updatedAt,
      job.userId,
      job.status,
      job.flameJson,
      job.optionsJson,
      job.progress,
      job.resultUrl,
      job.runpodJobId,
      job.runpodStatusJson,
      job.error,
      job.renderTimeMs,
      job.seed,
    )
    .run()
}

export async function getRenderJob(
  db: D1Database,
  id: string,
): Promise<DbRenderJob | null> {
  return db
    .prepare('SELECT * FROM render_jobs WHERE id = ?')
    .bind(id)
    .first<DbRenderJob>()
}

export async function updateRenderJob(
  db: D1Database,
  job: DbRenderJob,
): Promise<void> {
  await db
    .prepare(
      `UPDATE render_jobs SET updatedAt = ?, status = ?, progress = ?, resultUrl = ?, runpodJobId = ?, runpodStatusJson = ?, error = ?, renderTimeMs = ? WHERE id = ?`,
    )
    .bind(
      job.updatedAt,
      job.status,
      job.progress,
      job.resultUrl,
      job.runpodJobId,
      job.runpodStatusJson,
      job.error,
      job.renderTimeMs,
      job.id,
    )
    .run()
}

export async function getRenderJobsByUser(
  db: D1Database,
  userId: string,
  limit = 20,
): Promise<DbRenderJob[]> {
  const result = await db
    .prepare(
      'SELECT * FROM render_jobs WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
    )
    .bind(userId, limit)
    .all<DbRenderJob>()
  return result.results
}

/** Jobs still queued/running whose last update predates the cutoff — the
 *  sweep marks these failed and refunds them (see scheduled handler). */
export async function getStaleRenderJobs(
  db: D1Database,
  cutoffIso: string,
  limit = 50,
): Promise<DbRenderJob[]> {
  const result = await db
    .prepare(
      `SELECT * FROM render_jobs WHERE status IN ('queued', 'running') AND updatedAt < ? LIMIT ?`,
    )
    .bind(cutoffIso, limit)
    .all<DbRenderJob>()
  return result.results
}

// ── Credit ledger ────────────────────────────────────────────────
// Append-only; balance = SUM(delta). Every mutation is idempotent through the
// UNIQUE idempotencyKey, so debit/refund/grant can safely race or replay
// (mirrors the mercurypitch billing-core design).

function ledgerId(): string {
  return globalThis.crypto.randomUUID()
}

export async function creditBalance(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE userId = ?',
    )
    .bind(userId)
    .first<{ balance: number }>()
  return row?.balance ?? 0
}

export type DebitResult = 'debited' | 'duplicate' | 'insufficient'

/**
 * Charge `cost` credits for a render job. Balance check and insert happen in
 * ONE conditional statement so concurrent submits can't overdraw. Key
 * `render:<jobRef>` makes a replayed debit a no-op ('duplicate').
 */
export async function debitCredits(
  db: D1Database,
  userId: string,
  cost: number,
  jobRef: string,
): Promise<DebitResult> {
  const key = `render:${jobRef}`
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (id, createdAt, userId, delta, reason, jobRef, idempotencyKey)
       SELECT ?, ?, ?, ?, 'render-job', ?, ?
       WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE userId = ?) >= ?`,
    )
    .bind(
      ledgerId(),
      new Date().toISOString(),
      userId,
      -cost,
      jobRef,
      key,
      userId,
      cost,
    )
    .run()
  if ((res.meta?.changes ?? 0) > 0) return 'debited'
  // changes = 0 is ambiguous: either the key already exists (idempotent
  // replay) or the balance was insufficient — disambiguate by lookup.
  const existing = await db
    .prepare('SELECT id FROM credit_ledger WHERE idempotencyKey = ?')
    .bind(key)
    .first<{ id: string }>()
  return existing ? 'duplicate' : 'insufficient'
}

/**
 * Return the credits a job debited. Reads the debit row by its key and writes
 * the inverse delta under `render-refund:<jobRef>` — INSERT OR IGNORE means at
 * most one refund ever, no matter how many observers report the failure.
 * Returns true when a refund was actually written.
 */
export async function refundCredits(
  db: D1Database,
  jobRef: string,
): Promise<boolean> {
  const debit = await db
    .prepare('SELECT * FROM credit_ledger WHERE idempotencyKey = ?')
    .bind(`render:${jobRef}`)
    .first<DbLedgerEntry>()
  if (!debit || debit.delta >= 0) return false
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (id, createdAt, userId, delta, reason, jobRef, idempotencyKey)
       VALUES (?, ?, ?, ?, 'render-refund', ?, ?)`,
    )
    .bind(
      ledgerId(),
      new Date().toISOString(),
      debit.userId,
      -debit.delta,
      jobRef,
      `render-refund:${jobRef}`,
    )
    .run()
  return (res.meta?.changes ?? 0) > 0
}

/** Grant credits (purchases, subscription periods, welcome bonus). The caller
 *  picks an idempotencyKey that encodes the source (e.g. `grant:sub:<id>:<period>`)
 *  so webhook replays and reconcile sweeps can't double-grant. */
export async function grantCredits(
  db: D1Database,
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (id, createdAt, userId, delta, reason, jobRef, idempotencyKey)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      ledgerId(),
      new Date().toISOString(),
      userId,
      amount,
      reason,
      idempotencyKey,
    )
    .run()
  return (res.meta?.changes ?? 0) > 0
}

// Feature flags

export async function getFeatureFlag(
  db: D1Database,
  key: string,
): Promise<DbFeatureFlag | null> {
  return db
    .prepare('SELECT * FROM feature_flags WHERE key = ?')
    .bind(key)
    .first<DbFeatureFlag>()
}

export async function getAllFeatureFlags(
  db: D1Database,
): Promise<DbFeatureFlag[]> {
  const result = await db
    .prepare('SELECT * FROM feature_flags')
    .all<DbFeatureFlag>()
  return result.results
}
