/** Renderer input contract shared by interactive, inspection and export surfaces. */
import type { v4f } from 'typegpu/data'
import type { Palette } from './colorMap'
import type { ExportImageType } from './exportImageType'
import type { CompletedPointCountInfo } from './renderDrivers'
import type { FlameDescriptor } from './schema/flameSchema'
import type { RendererRandomImplementationId } from '@/shaders/random'

export type Flam3Props = {
  quality: number
  pointCountPerBatch: number
  renderInterval: number
  adaptiveFilterEnabled: boolean
  stochasticFilterEnabled?: boolean
  /** Compile-time renderer RNG selection. Defaults to canonical xoroshiro64**. */
  randomImplementationId?: RendererRandomImplementationId
  animationEnabled: boolean
  flameDescriptor: FlameDescriptor
  edgeFadeColor: v4f
  onExportImage?: ExportImageType
  /** Marks the main workspace renderer: exports (animation/still) switch its
   *  render loop from rAF to the async export driver. Preview instances must
   *  not set this. */
  isExportRenderer?: boolean
  /** Forces the async export driver on directly (independent of the global
   *  export signals). Used by the offscreen export-job renderer so it runs the
   *  fast loop without flipping the main workspace renderer into export mode. */
  exportDriver?: boolean
  /** Offscreen export driver only. While set, accumulation resets when this key
   *  changes and on nothing else, so the sub-frames of one output frame (motion
   *  blur) accumulate into one buffer instead of each flame change starting it
   *  over. The main workspace renderer gets the same behaviour from the global
   *  animationExportRunning signal; an offscreen job cannot use that, because it
   *  would also freeze the live view's resets while the job runs. */
  exportFrameKey?: number
  /** Export motion blur: stop accumulating at this fraction of the quality
   *  point limit, and never let one export tick run past it. The export loop
   *  raises it sub-frame by sub-frame. Without it the export driver sizes a
   *  tick to reach the whole limit at once, so the first sub-frame took the
   *  entire budget and the rest accumulated nothing. Undefined = whole limit. */
  accumulationFraction?: number
  setCurrentQuality?: (fn: () => number) => void
  setQualityPointCountLimit?: (fn: () => number) => void
  palette?: () => Palette | undefined
  outputAlpha?: boolean
  onAccumulatedPointCount?: (count: number) => void
  /**
   * Queue-completed counterpart to `onAccumulatedPointCount`.
   *
   * The existing callback intentionally fires immediately after submit because
   * interactive UI consumers need low-latency progress. Benchmark consumers
   * need the stronger guarantee that the GPU finished the captured submission.
   */
  onCompletedPointCount?: (info: CompletedPointCountInfo) => void
  /** Reports rejection of the queue fence used by onCompletedPointCount. */
  onCompletedPointCountError?: (error: unknown) => void
  disableQualityLimit?: boolean
  blendFlame?: FlameDescriptor
  blendWeight?: number
  /** Default true. When false, chains re-seed every dispatch instead of
   *  persisting across dispatches — required for single-transform preview
   *  flames, whose chains would otherwise collapse onto the lone map's
   *  attractor (shape contraction) and decay color toward the transform's. */
  persistChains?: boolean
}
