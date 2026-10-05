/** Presentation quality changes surface reconstruction and floor lighting, never particle physics. */
export type GummyBoardQuality = 'auto' | 'tablet' | 'high'
export function resolveGummyBoardQuality(
  quality: GummyBoardQuality,
  compact: boolean,
) {
  const tablet = quality === 'tablet' || (quality === 'auto' && compact)
  return {
    name: tablet ? ('tablet' as const) : ('high' as const),
    cellSize: tablet ? 0.08 : 0.06,
    lightResolution: tablet ? (512 as const) : (1024 as const),
  }
}
