import { example1 } from '@/flame/examples/example1'
import { example29 } from '@/flame/examples/example29'
import { example33 } from '@/flame/examples/example33'
import { example40 } from '@/flame/examples/example40'
import { example44 } from '@/flame/examples/example44'
import { example45 } from '@/flame/examples/example45'
import { example46 } from '@/flame/examples/example46'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/** The app's origin — where `?flame=` links open. */
export const APP_URL = 'https://chaos-master.com'

/**
 * Landing render of the Enchanted Rose (example44) at high density-estimation
 * quality. The shared app example uses 0.6, which converges slowly / blurs during
 * movement; bump it here (landing-only) so it's crisp immediately like the earth.
 * Exported so the community card AND its poster render the exact same flame.
 */
export const ROSE_LANDING: FlameDescriptor = {
  ...example44,
  renderSettings: {
    ...example44.renderSettings,
    densityEstimationQuality: 1,
    estimatorCurve: 0.85,
  },
}

/** Static-poster path for a named landing flame (see `public/posters/`). */
export function posterFor(name: string): string {
  return `/posters/${name}.jpg`
}

/**
 * Single source of truth for every flame that appears live on the landing, keyed
 * by poster name. Gallery plates + community cards reference these by name; the
 * `poster-capture` page renders each one to `public/posters/<name>.jpg` so the
 * static fallback always matches the live flame exactly.
 */
export const LANDING_FLAMES = {
  example1,
  example29,
  example33,
  example40,
  example45,
  rose: ROSE_LANDING,
  earth: example46,
} satisfies Record<string, FlameDescriptor>

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
