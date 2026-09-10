import type { DbEntity } from './types'

export interface UserProfile extends DbEntity {
  displayName: string
  email: string | null
  avatarUrl: string | null
  authProvider: 'anonymous' | 'google' | 'email'
}

export interface Subscription extends DbEntity {
  userId: string
  tier: 'free' | 'premium' | 'pro'
  status: 'active' | 'canceled' | 'past_due'
  currentPeriodStart: string
  currentPeriodEnd: string
  rendersThisMonth: number
  renderLimitMonthly: number
}

export interface RenderJob extends DbEntity {
  userId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  flameJson: string
  optionsJson: string
  progress: number
  resultUrl: string | null
  error: string | null
  renderTimeMs: number | null
}

export interface FeatureFlag extends DbEntity {
  key: string
  value: number
}

export const DB_TABLES = {
  users: 'userProfiles',
  subscriptions: 'subscriptions',
  renderJobs: 'renderJobs',
  featureFlags: 'featureFlags',
} as const
