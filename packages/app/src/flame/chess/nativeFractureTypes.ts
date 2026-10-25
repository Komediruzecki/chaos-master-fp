/** Portable breakup modes shared by native chess settings, recipes and renderers. */
export type NativeFractureMode = 'points' | 'connected' | 'contact'

export function parseNativeFractureMode(
  value: unknown,
): NativeFractureMode | undefined {
  if (
    value === undefined ||
    value === 'points' ||
    value === 'connected' ||
    value === 'contact'
  )
    return value
  throw new Error('Choose point breakup, rigid chunks or contact fracture.')
}

/** Finite solids currently exist only for the Window rook collection. */
export function effectiveNativeFracture(
  collectionId: string,
  mode?: NativeFractureMode,
): NativeFractureMode {
  return collectionId === 'lattice-court' ? (mode ?? 'points') : 'points'
}
