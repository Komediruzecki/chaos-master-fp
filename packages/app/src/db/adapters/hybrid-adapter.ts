import type { DatabaseAdapter, DbEntity, Repository } from '../types'

const CLOUD_TABLES = new Set([
  'userProfiles',
  'subscriptions',
  'renderJobs',
  'featureFlags',
])

export class HybridAdapter implements DatabaseAdapter {
  constructor(
    private cloud: DatabaseAdapter,
    private local: DatabaseAdapter,
  ) {}

  async connect(): Promise<void> {
    await Promise.all([this.cloud.connect(), this.local.connect()])
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.cloud.disconnect(), this.local.disconnect()])
  }

  getRepository<T extends DbEntity>(table: string): Repository<T> {
    if (CLOUD_TABLES.has(table)) {
      return this.cloud.getRepository<T>(table)
    }
    return this.local.getRepository<T>(table)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.cloud.transaction(fn)
  }
}
