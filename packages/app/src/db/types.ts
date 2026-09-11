export interface DbEntity {
  id: string
  createdAt: string
  updatedAt: string
}

export interface Repository<T extends DbEntity> {
  findById(id: string): Promise<T | null>
  findAll(opts?: QueryOptions): Promise<T[]>
  create(entity: T): Promise<T>
  update(entity: T): Promise<T>
  delete(id: string): Promise<void>
}

export interface QueryOptions {
  where?: Record<string, unknown>
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface DatabaseAdapter {
  getRepository<T extends DbEntity>(table: string): Repository<T>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  connect(): Promise<void>
  disconnect(): Promise<void>
}
