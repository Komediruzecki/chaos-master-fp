import { DexieAdapter } from './adapters/dexie-adapter'
import { HybridAdapter } from './adapters/hybrid-adapter'
import { ServerAdapter } from './adapters/server-adapter'
import { getAuthHeaders } from './services/auth-service'
import type { DatabaseAdapter } from './types'

let _adapter: DatabaseAdapter | null = null

export async function createDatabase(): Promise<DatabaseAdapter> {
  const cloud = new ServerAdapter('', getAuthHeaders)
  const local = new DexieAdapter()
  const hybrid = new HybridAdapter(cloud, local)
  await hybrid.connect()
  _adapter = hybrid
  return hybrid
}

export function getDb(): DatabaseAdapter {
  if (!_adapter) {
    throw new Error('Database not initialized. Call createDatabase() first.')
  }
  return _adapter
}

export async function disconnectDb(): Promise<void> {
  if (_adapter) {
    await _adapter.disconnect()
    _adapter = null
  }
}

export { DexieAdapter, ServerAdapter, HybridAdapter }
export type { DatabaseAdapter }
