import type { DatabaseAdapter, DbEntity, QueryOptions, Repository, } from '../types'

class ServerRepo<T extends DbEntity> implements Repository<T> {
  constructor(
    private endpoint: string,
    private getHeaders: () => Record<string, string>,
  ) {}

  async findById(id: string): Promise<T | null> {
    const res = await fetch(`${this.endpoint}/${encodeURIComponent(id)}`, {
      headers: this.getHeaders(),
    })
    if (!res.ok) return null
    return res.json()
  }

  async findAll(opts?: QueryOptions): Promise<T[]> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    if (opts?.orderBy) {
      params.set('orderBy', opts.orderBy)
      if (opts.orderDir) params.set('orderDir', opts.orderDir)
    }
    const qs = params.toString()
    const res = await fetch(`${this.endpoint}${qs ? `?${qs}` : ''}`, {
      headers: this.getHeaders(),
    })
    if (!res.ok) return []
    return res.json()
  }

  async create(entity: T): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getHeaders() },
      body: JSON.stringify(entity),
    })
    if (!res.ok) throw new Error(`Create failed: ${res.status}`)
    return res.json()
  }

  async update(entity: T): Promise<T> {
    const res = await fetch(
      `${this.endpoint}/${encodeURIComponent(entity.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.getHeaders() },
        body: JSON.stringify(entity),
      },
    )
    if (!res.ok) throw new Error(`Update failed: ${res.status}`)
    return res.json()
  }

  async delete(id: string): Promise<void> {
    await fetch(`${this.endpoint}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    })
  }
}

export class ServerAdapter implements DatabaseAdapter {
  private repos = new Map<string, Repository<DbEntity>>()

  constructor(
    private baseUrl: string,
    private getHeaders: () => Record<string, string>,
  ) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  getRepository<T extends DbEntity>(table: string): Repository<T> {
    let repo = this.repos.get(table)
    if (!repo) {
      repo = new ServerRepo<T>(`${this.baseUrl}/api/${table}`, this.getHeaders)
      this.repos.set(table, repo)
    }
    return repo as Repository<T>
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}
