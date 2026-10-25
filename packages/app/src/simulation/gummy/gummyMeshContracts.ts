/** Shared gummy mesh buffers and face identifiers, independent of construction and partitioning. */
export type GummyVec3 = [number, number, number]

export type GummyMesh = {
  /** Runtime splits use actual shared-node adjacency and permanently exposed internal faces. */
  runtimeFracture?: boolean
  /** xyz in metres, w is inverse lumped mass; the bottom contact patch is optionally anchored. */
  positions: Float32Array
  tetrahedra: Uint32Array
  /** Three corresponding vertex pairs per cohesive triangle, followed by two padding words. */
  interfaces: Uint32Array
  /** Outward triangle indices and cohesive interface ID, EXTERIOR_FACE or EXPOSED_TEAR_FACE. */
  surface: Uint32Array
  restNormals: Float32Array
  nodeRegions: Uint32Array
  spacing: number
  restVolume: number
  /** Rest volume per study mass unit; absent retains the legacy per-mesh nodal normalization. */
  massReferenceVolume?: number
  bounds: { min: GummyVec3; max: GummyVec3 }
  demoGrip: { center: GummyVec3; radius: number; pull: GummyVec3 }
}

export const EXTERIOR_FACE = 0xffffffff
/** A fresh runtime tear face, permanently visible without a cohesive damage-buffer index. */
export const EXPOSED_TEAR_FACE = 0xfffffffe
export const GUMMY_DEMO_GRIP = {
  center: [0.64, 1.24, 0.08] as GummyVec3,
  radius: 0.28,
  pull: [0.95, 0.22, 0.14] as GummyVec3,
}
