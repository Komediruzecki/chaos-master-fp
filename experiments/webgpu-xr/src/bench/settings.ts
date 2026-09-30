// Serializable specimen identity and presentation, independent of GPU objects.
import { BENCH_RECIPES } from './recipes'

export interface BenchSettings {
  recipe: number
  pointCount: number
  seed: number
  source: 'compute' | 'cached'
  palette: 'lagoon' | 'ember' | 'violet' | 'ivory'
  exposure: number
  pointSize: number
  yaw: number
  pitch: number
  distance: number
  rotation: boolean
  rings: boolean
  depthProbe: 'off' | 'front' | 'through' | 'behind'
  stars: boolean
}

export const DEFAULT_BENCH_SETTINGS: Readonly<BenchSettings> = Object.freeze({
  recipe: 0,
  pointCount: 131072,
  seed: 73129,
  source: 'compute',
  palette: 'lagoon',
  exposure: 1,
  pointSize: 0.003,
  yaw: 0,
  pitch: 0,
  distance: 3,
  rotation: false,
  rings: true,
  depthProbe: 'off',
  stars: false,
})

const bounded = (value: number, fallback: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

export function normalizeSettings(settings: BenchSettings): BenchSettings {
  const defaults = DEFAULT_BENCH_SETTINGS
  return {
    ...settings,
    recipe: BENCH_RECIPES.some((recipe) => recipe.index === settings.recipe)
      ? settings.recipe
      : 0,
    pointCount: [32768, 131072, 524288].includes(settings.pointCount)
      ? settings.pointCount
      : defaults.pointCount,
    seed: Math.trunc(bounded(settings.seed, defaults.seed, 1, 0x7fffffff)),
    source: settings.source === 'cached' ? 'cached' : 'compute',
    palette: ['lagoon', 'ember', 'violet', 'ivory'].includes(settings.palette)
      ? settings.palette
      : defaults.palette,
    exposure: bounded(settings.exposure, defaults.exposure, 0.3, 2),
    pointSize: bounded(settings.pointSize, defaults.pointSize, 0.001, 0.008),
    yaw: bounded(settings.yaw, defaults.yaw, -360, 360),
    pitch: bounded(settings.pitch, defaults.pitch, -80, 80),
    distance: bounded(settings.distance, defaults.distance, 1.4, 6),
    depthProbe: ['off', 'front', 'through', 'behind'].includes(
      settings.depthProbe,
    )
      ? settings.depthProbe
      : 'off',
    rotation: settings.rotation,
    rings: settings.rings,
    stars: settings.stars,
  }
}
