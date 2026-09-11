import Dexie from 'dexie'
import type { DatabaseAdapter, DbEntity, QueryOptions, Repository, } from '../types'

class DexieRepo<T extends DbEntity> implements Repository<T> {
  constructor(private table: Dexie.Table<T, string>) {}

  async findById(id: string): Promise<T | null> {
    return this.table.get(id).then((r) => r ?? null)
  }

  async findAll(opts?: QueryOptions): Promise<T[]> {
    let collection = this.table.toCollection()
    if (opts?.orderBy) {
      collection = this.table.orderBy(opts.orderBy)
    }
    let arr = await collection.toArray()
    if (opts?.orderDir === 'desc') arr.reverse()
    if (opts?.where) {
      for (const [key, val] of Object.entries(opts.where)) {
        arr = arr.filter(
          (item) => (item as Record<string, unknown>)[key] === val,
        )
      }
    }
    if (opts?.offset) arr = arr.slice(opts.offset)
    if (opts?.limit) arr = arr.slice(0, opts.limit)
    return arr
  }

  async create(entity: T): Promise<T> {
    await this.table.put(entity)
    return entity
  }

  async update(entity: T): Promise<T> {
    await this.table.put(entity)
    return entity
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }
}

export class DexieAdapter implements DatabaseAdapter {
  private db: Dexie
  private tableNames: string[]

  constructor(dbName = 'chaos-master-app') {
    this.db = new Dexie(dbName)
    this.tableNames = [
      'userProfiles',
      'subscriptions',
      'renderJobs',
      'featureFlags',
    ]
    this.db.version(1).stores({
      userProfiles: 'id',
      subscriptions: 'id, userId',
      renderJobs: 'id, userId, createdAt',
      featureFlags: 'id, key',
    })
  }

  async connect(): Promise<void> {
    await this.db.open()
  }

  disconnect(): Promise<void> {
    this.db.close()
    return Promise.resolve()
  }

  getRepository<T extends DbEntity>(table: string): Repository<T> {
    const dexieTable = this.db.table<T, string>(table)
    return new DexieRepo<T>(dexieTable)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.tableNames, fn)
  }
}
