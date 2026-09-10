-- D1 Database Schema for chaos-master
-- Run: wrangler d1 execute chaos-master-db --file=src/worker/schema.sql

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  userId TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  currentPeriodStart TEXT NOT NULL,
  currentPeriodEnd TEXT NOT NULL,
  rendersThisMonth INTEGER NOT NULL DEFAULT 0,
  renderLimitMonthly INTEGER NOT NULL DEFAULT 5,
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  flameJson TEXT NOT NULL,
  optionsJson TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  resultUrl TEXT,
  -- RunPod serverless job id (primary render path); NULL for pod-mode jobs.
  runpodJobId TEXT,
  -- Trimmed raw RunPod status payload from the last reconcile (post-mortems).
  runpodStatusJson TEXT,
  error TEXT,
  renderTimeMs INTEGER,
  seed TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_user ON render_jobs (userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs (status, updatedAt);

-- Append-only credit ledger: the balance is SUM(delta) per user. Debits carry
-- idempotencyKey 'render:<jobId>', refunds 'render-refund:<jobId>', grants
-- 'grant:<source>' — the UNIQUE constraint makes every operation replay-safe.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  userId TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  jobRef TEXT,
  idempotencyKey TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger (userId);

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value INTEGER NOT NULL
);

-- Default feature flags
INSERT OR IGNORE INTO feature_flags (id, key, value) VALUES ('ff_server_rendering', 'server_rendering', 1);
INSERT OR IGNORE INTO feature_flags (id, key, value) VALUES ('ff_premium_tier', 'premium_tier', 1);
