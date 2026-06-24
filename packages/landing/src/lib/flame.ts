import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/** The app's origin — where `?flame=` links open. */
export const APP_URL = 'https://chaos-master.com'

/** Prettify a variation type literal: `sinusoidalVar` → `SINUSOIDAL`,
 *  `julia3D` → `JULIA 3D`. */
export function prettyVariation(type: string): string {
  return type
    .replace(/Var$/, '')
    .replace(/3D$/, ' 3D')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase()
}

/** Distinct variation types behind a flame, prettified —
 *  e.g. "SWIRL · SINUSOIDAL · SPHERICAL". */
export function variationSummary(flame: FlameDescriptor, max = 4): string {
  const types = new Set<string>()
  for (const t of Object.values(flame.transforms)) {
    for (const v of Object.values(t.variations)) {
      types.add(prettyVariation(v.type))
    }
  }
  return [...types].slice(0, max).join(' · ')
}
