// Minimal Cloudflare Workers type stubs
// Full types available from @cloudflare/workers-types if needed

interface D1Result<T = unknown> {
  results: T[]
  meta?: { changes?: number }
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
  raw<T = unknown>(): Promise<T[]>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>
  exec(query: string): Promise<D1Result>
}

interface KVNamespace {
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { expirationTtl?: number },
  ): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
}
