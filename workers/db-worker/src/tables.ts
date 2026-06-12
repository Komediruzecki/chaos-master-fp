/**
 * D1 database table operations for db-worker.
 *
 * Each table has access control rules:
 * - users: owner only (except auth ops)
 * - subscriptions: owner read, owner write (with limits)
 * - render_jobs: owner read/write
 * - feature_flags: public read, no public write
 */

export interface D1Result<T> {
  results: T[]
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<D1Result<unknown>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface UserRow {
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

export interface SubscriptionRow {
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

export interface RenderJobRow {
  id: string
  createdAt: string
  updatedAt: string
  userId: string
  status: string
  flameJson: string
  optionsJson: string
  progress: number
  resultUrl: string | null
  error: string | null
  renderTimeMs: number | null
  seed: string
}

export interface FeatureFlagRow {
  id: string
  key: string
  value: number
}

export function createUser(
  db: D1Database,
  user: Omit<UserRow, 'createdAt' | 'updatedAt'>,
): Promise<UserRow> {
  const now = new Date().toISOString()

  return db
    .prepare(
      `INSERT INTO users (id, createdAt, updatedAt, authProvider, providerId, email, passwordHash, emailVerified, displayName, avatarUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      user.id,
      now,
      now,
      user.authProvider,
      user.providerId ?? null,
      user.email ?? null,
      user.passwordHash ?? null,
      user.emailVerified,
      user.displayName,
      user.avatarUrl ?? null,
    )
    .run()
    .then(() => getUserById(db, user.id).then((u) => u!))
}

export function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<UserRow>()
    .then((row) => row ?? null)
}

export function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>()
    .then((row) => row ?? null)
}

export function updateUser(
  db: D1Database,
  id: string,
  updates: Partial<Pick<UserRow, 'email' | 'passwordHash' | 'emailVerified' | 'displayName' | 'avatarUrl' | 'authProvider' | 'providerId'>>,
): Promise<void> {
  const fields: string[] = ['updatedAt = ?']
  const values: unknown[] = [new Date().toISOString()]

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`)
    values.push(value)
  }

  values.push(id)
  return db
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
    .then(() => undefined)
}

export function createSubscription(
  db: D1Database,
  sub: Omit<SubscriptionRow, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const now = new Date().toISOString()
  return db
    .prepare(
      `INSERT INTO subscriptions (id, createdAt, updatedAt, userId, tier, status, currentPeriodStart, currentPeriodEnd, rendersThisMonth, renderLimitMonthly, stripeCustomerId, stripeSubscriptionId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sub.id,
      now,
      now,
      sub.userId,
      sub.tier,
      sub.status,
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.rendersThisMonth,
      sub.renderLimitMonthly,
      sub.stripeCustomerId ?? null,
      sub.stripeSubscriptionId ?? null,
    )
    .run()
    .then(() => undefined)
}

export function getSubscriptionByUserId(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare('SELECT * FROM subscriptions WHERE userId = ?')
    .bind(userId)
    .first<SubscriptionRow>()
    .then((row) => row ?? null)
}

export function incrementRenderCount(
  db: D1Database,
  userId: string,
): Promise<void> {
  return db
    .prepare(
      `UPDATE subscriptions SET rendersThisMonth = rendersThisMonth + 1, updatedAt = ? WHERE userId = ?`,
    )
    .bind(new Date().toISOString(), userId)
    .run()
    .then(() => undefined)
}

export function createRenderJob(
  db: D1Database,
  job: Omit<RenderJobRow, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const now = new Date().toISOString()
  return db
    .prepare(
      `INSERT INTO render_jobs (id, createdAt, updatedAt, userId, status, flameJson, optionsJson, progress, resultUrl, error, renderTimeMs, seed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.id,
      now,
      now,
      job.userId,
      job.status,
      job.flameJson,
      job.optionsJson,
      job.progress,
      job.resultUrl ?? null,
      job.error ?? null,
      job.renderTimeMs ?? null,
      job.seed,
    )
    .run()
    .then(() => undefined)
}

export function getRenderJobById(
  db: D1Database,
  id: string,
): Promise<RenderJobRow | null> {
  return db
    .prepare('SELECT * FROM render_jobs WHERE id = ?')
    .bind(id)
    .first<RenderJobRow>()
    .then((row) => row ?? null)
}

export function updateRenderJob(
  db: D1Database,
  id: string,
  updates: Partial<Pick<RenderJobRow, 'status' | 'progress' | 'resultUrl' | 'error' | 'renderTimeMs'>>,
): Promise<void> {
  const fields: string[] = ['updatedAt = ?']
  const values: unknown[] = [new Date().toISOString()]

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`)
    values.push(value)
  }

  values.push(id)
  return db
    .prepare(`UPDATE render_jobs SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
    .then(() => undefined)
}

export function getRenderJobsByUserId(
  db: D1Database,
  userId: string,
): Promise<RenderJobRow[]> {
  return db
    .prepare('SELECT * FROM render_jobs WHERE userId = ? ORDER BY createdAt DESC')
    .bind(userId)
    .all<RenderJobRow>()
    .then((result) => result.results)
}

export function getFeatureFlags(
  db: D1Database,
): Promise<FeatureFlagRow[]> {
  return db
    .prepare('SELECT * FROM feature_flags')
    .all<FeatureFlagRow>()
    .then((result) => result.results)
}

export function getFeatureFlag(
  db: D1Database,
  key: string,
): Promise<FeatureFlagRow | null> {
  return db
    .prepare('SELECT * FROM feature_flags WHERE key = ?')
    .bind(key)
    .first<FeatureFlagRow>()
    .then((row) => row ?? null)
}
