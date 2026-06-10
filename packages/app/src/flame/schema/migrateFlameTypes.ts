/**
 * Migration map from old variation type names to their canonical Var-suffixed names.
 *
 * Background: Variations were originally defined with short names (e.g. 'horseshoe')
 * in simple/general/index.ts. They were later refactored into individual files with
 * Var-suffixed names (e.g. 'horseshoeVar'). This map enables loading old flames that
 * still reference the short names.
 *
 * This map should be integrated into the official flame migration toolset once it exists.
 */
const VARIATION_TYPE_MIGRATIONS: Record<string, string> = {
  // Short names → Var-suffixed canonical names
  linear: 'linearVar',
  sinusoidal: 'sinusoidalVar',
  spherical: 'sphericalVar',
  swirl: 'swirlVar',
  horseshoe: 'horseshoeVar',
  polar: 'polarVar',
  handkerchief: 'handkerchiefVar',
  heart: 'heartVar',
  disc: 'discVar',
  spiral: 'spiralVar',
  hyperbolic: 'hyperbolicVar',
  diamond: 'diamondVar',
  julia: 'juliaVar',
  bent: 'bentVar',
  fisheye: 'fisheyeVar',
  eyefish: 'eyefishVar',
  exponential: 'exponentialVar',
  power: 'powerVar',
  cosine: 'cosineVar',
  bubble: 'bubbleVar',
  cylinder: 'cylinderVar',
  noise: 'noiseVar',
  waves: 'wavesVar',
  popcorn: 'popcornVar',
  rings: 'ringsVar',
  fan: 'fanVar',

  // Casing fixes
  flipyVar: 'flipYVar',
  flipcircleVar: 'flipCircleVar',
}

/**
 * Migrates old variation type names to their canonical forms in-place.
 *
 * Walks all `transforms.*.variations.*.type` fields in the raw flame data
 * and remaps any deprecated type names. This must be called on the raw
 * (unvalidated) data before schema validation, since the schema only
 * accepts canonical type literals.
 *
 * @param data - Raw flame descriptor object (mutated in place)
 * @returns The same object with migrated type names
 */
export function migrateFlameVariationTypes<T>(data: T): T {
  if (typeof data !== 'object' || data === null) return data

  const obj = data as Record<string, unknown>
  const transforms = obj.transforms as
    | Record<string, Record<string, unknown>>
    | undefined

  if (typeof transforms !== 'object' || transforms === null) return data

  for (const transform of Object.values(transforms)) {
    if (typeof transform !== 'object' || transform === null) continue

    const variations = transform.variations as
      | Record<string, Record<string, unknown>>
      | undefined

    if (typeof variations !== 'object' || variations === null) continue

    for (const variation of Object.values(variations)) {
      if (typeof variation !== 'object' || variation === null) continue

      const type = variation.type
      if (typeof type === 'string' && type in VARIATION_TYPE_MIGRATIONS) {
        variation.type = VARIATION_TYPE_MIGRATIONS[type]
      }
    }
  }

  return data
}
