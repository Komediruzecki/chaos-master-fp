-- Database schema for chaos-master premium features
-- D1 (SQLite) database

-- Users table (auth)
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

-- Subscription tiers
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

-- Render jobs
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
  error TEXT,
  renderTimeMs INTEGER,
  seed TEXT NOT NULL
);

-- Feature flags (server-side gating)
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_userId ON subscriptions(userId);
CREATE INDEX IF NOT EXISTS idx_render_jobs_userId ON render_jobs(userId);
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);
