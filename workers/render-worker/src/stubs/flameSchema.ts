/**
 * Server-side stub for @/flame/schema/flameSchema.
 * Provides FlameDescriptor type without importing the full valibot schema + variation cascade.
 */

export type TransformRecord = Record<
  string,
  {
    variations: Record<string, { type: string; [key: string]: unknown }>
    probability?: number
    [key: string]: unknown
  }
>

export type FlameDescriptor = {
  version?: string
  renderSettings?: {
    backgroundColor?: [number, number, number]
    drawMode?: string
    skipIters?: number
    colorInitMode?: string
    pointInitMode?: string
    densityEstimationQuality?: number
    estimatorCurve?: number
    estimatorRadius?: number
    exposure?: number
    vibrancy?: number
    palettePhase?: number
    paletteSpeed?: number
    contrast?: number
    gamma?: number
    paletteIndex?: number
    highlightPower?: number
    paletteMode?: number
    depthColorPower?: number
    lightDirection?: [number, number, number]
    lightPower?: number
    camera?: {
      zoom?: number
      position?: [number, number]
    }
  }
  transforms: Record<string, unknown>
  finalTransform?: unknown
  metadata?: { author?: string }
}

export function validateFlame(_data: unknown): FlameDescriptor {
  throw new Error(
    'Server-side stub: validateFlame not available in render worker.',
  )
}
