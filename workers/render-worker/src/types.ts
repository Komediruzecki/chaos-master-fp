/**
 * CPU-side types for server IFS rendering.
 * Plain TypeScript equivalents of the GPU tgpu structs.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Point {
  position: Vec2
  /** OkLab a and b */
  color: Vec2
}

export interface Bucket {
  count: number
  colorA: number
  colorB: number
}

export const BUCKET_FIXED_POINT_MULTIPLIER = 1000
export const BUCKET_FIXED_POINT_MULTIPLIER_INV = 0.001

export interface AffineCoefs {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface VariationParams {
  name: string
  weight: number
  params?: Record<string, number>
}

export interface Transform {
  preAffine: AffineCoefs
  postAffine: AffineCoefs
  variations: VariationParams[]
  colorX: number
  colorY: number
  colorSpeed: number
  probability: number
}
