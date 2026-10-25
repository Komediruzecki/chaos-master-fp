/** Cloneable geometry and bounded pose samples for the worker-baked contact fracture study. */
export type ContactVector = [number, number, number]
export type ContactQuaternion = [number, number, number, number]
export type RookContactChunk = {
  centroid: ContactVector
  mass: number
  localMin: ContactVector
  localMax: ContactVector
  /** Exact occupied-cell box union, packed local center.xyz / halfExtent.xyz. */
  boxes: Float32Array
  /** Actual box corners, relative to the chunk centroid. */
  supportPoints: Float32Array
}
export type RookContactBond = {
  a: number
  b: number
  area: number
  centroid: ContactVector
  normal: ContactVector
}
export type RookContactPhysics = {
  chunks: RookContactChunk[]
  bonds: RookContactBond[]
  cellSize: number
}
export type RookContactMotion = {
  /** Frame-major [centroid displacement.xyz, 0, quaternion.xyzw]. */
  poses: Float32Array
  sampleRate: number
  frameCount: number
  chunkCount: number
  /** Seconds since move start, or -1 for an unbroken bond. */
  brokenAt: Float32Array
  stats: {
    boxCount: number
    steps: number
    contacts: number
    brokenBonds: number
    firstContact: number
    maxPenetration: number
  }
}
export type RookContactShot = {
  physics: RookContactPhysics
  attacker: { radius: number; height: number; path: Float32Array }
  duration: number
  sampleRate: number
  strength?: number
}
export const ROOK_CONTACT_MAX_BOXES = 1500
export const ROOK_CONTACT_MAX_FRAMES = 361
