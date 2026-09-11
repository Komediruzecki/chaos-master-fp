/**
 * Shared render-cost model: how many points a quality level needs, how long
 * that takes on the server GPU, and what it costs in credits.
 *
 * ONE source of truth for four consumers, which previously disagreed:
 *   - the client renderer (Flam3.tsx bucketProbabilityInv / qualityPointCountLimit)
 *   - the server renderer (workers/render-worker/src/render.ts)
 *   - the Cloudflare worker (authoritative credit charge)
 *   - the render dialog (the estimate shown before you submit)
 *
 * The point budget is driven by the ZOOM/camera, not just the resolution: a
 * quality level is "points per unit of world area", so zooming in by 4x needs
 * 16x the points to look equally clean. The server used to ignore zoom, which
 * made zoomed-in server renders grainier than the on-canvas preview at the
 * same quality setting.
 *
 * Pure module — no GPU, no solid-js — so Deno, Workers, and the browser can
 * all import it.
 */

import { BUCKET_FIXED_POINT_MULTIPLIER } from './types'

/** Hottest buckets can run well above average; keeps atomics inside u32. */
const CONCENTRATION_FACTOR = 25

/** Mirrors Flam3's MIN_DENSITY_NORM_RADIUS: keeps a close 3D camera out of
 *  the blow-out regime. */
const MIN_DENSITY_NORM_RADIUS = 2

export interface Camera2DLike {
  zoom: number
}

export interface Camera3DLike {
  /** Distance from camera to target. */
  radius: number
  /** Vertical field of view, degrees. */
  fov: number
}

export interface RenderTarget {
  width: number
  height: number
  /** 0-1 quality slider (the low/mid/high/ultra presets). */
  quality: number
}

/**
 * Inverse bucket probability = the pixel area a unit of world space covers.
 * 2D: A = height² × zoom² / 4. 3D: the same area at the target distance.
 */
export function bucketProbabilityInv(
  height: number,
  camera: Camera2DLike | Camera3DLike,
): number {
  if ('radius' in camera) {
    const radius = Math.max(MIN_DENSITY_NORM_RADIUS, camera.radius || 1)
    const tanHalfFov = Math.tan(((camera.fov || 60) * Math.PI) / 180 / 2) || 1
    const scale = height / (2 * radius * tanHalfFov)
    return scale * scale
  }
  const zoom = camera.zoom || 1
  return (height ** 2 * zoom ** 2) / 4
}

/** u32-safe cap: prevents per-bucket atomic overflow at extreme quality. */
export function safeQualityCap(width: number, height: number): number {
  const maxPointsPerBucket = Math.floor(
    0xffffffff / BUCKET_FIXED_POINT_MULTIPLIER,
  )
  return Math.floor(
    (maxPointsPerBucket * width * height) / CONCENTRATION_FACTOR,
  )
}

/**
 * Points needed to reach `quality` at this resolution and camera.
 * quality → 1 diverges, so the safe cap always applies.
 */
export function qualityPointLimit(
  target: RenderTarget,
  camera: Camera2DLike | Camera3DLike,
): number {
  const q = Math.min(Math.max(target.quality, 0.01), 0.9999)
  const rawLimit = bucketProbabilityInv(target.height, camera) / (1 - q) ** 2
  return Math.min(rawLimit, safeQualityCap(target.width, target.height))
}

/**
 * Which server renderer runs the job.
 *
 * 'chrome' the app's own bundle in headless Chrome (Dawn): the primary engine.
 *          It renders with the very shaders the client ships, so there is no
 *          second shader path to drift, and it reaches 8K, at ~1.5s more fixed
 *          cost per job.
 * 'deno'   the Deno CLI renderer, kept as the fallback for endpoints whose
 *          image does not ship Chrome. Its WebGPU refuses single buffer
 *          allocations above ~100MB, capping it near 5.1Mpx.
 *
 * Declared HERE, in the pure module the client, the Worker and the render
 * dialog all already import, so there is exactly one definition. Three
 * structurally-identical copies used to exist; TypeScript's structural typing
 * hid that, right up until one of them gained a third engine.
 */
export type RenderEngine = 'deno' | 'chrome'

/**
 * The engine a job gets when it names none: Chrome wherever the deployment
 * ships it, Deno otherwise. The Worker (which charges) and the render dialog
 * (which quotes) both ask this, so they cannot pick differently.
 */
export function defaultRenderEngine(chromeAvailable: boolean): RenderEngine {
  return chromeAvailable ? 'chrome' : 'deno'
}

/**
 * Server render seconds, calibrated on the RunPod RTX 4090 endpoint
 * (tools/cost-matrix.ts, 2026-07-29: 32 cells, both engines, 720p-4K x
 * low/mid/high/ultra):
 *
 *   fixed + ~0.12s per megapixel (allocation, clear, readback, PNG encode)
 *   + points / 1.9e9 (throughput)
 *
 * Throughput and the per-megapixel term are the SAME for both engines —
 * measured 1.79-2.00e9 points/s across every cell either could complete. Only
 * the fixed term differs, and only because Chrome starts a browser per job.
 *
 * That equality is not a given: the headless renderer originally ran Flam3's
 * interactive rAF loop and sustained only ~0.45e9 points/s. Switching it to the
 * export driver closed the gap. If a future measurement shows Chrome's
 * throughput drifting again, suspect the loop, not the GPU.
 *
 * Predictions against measurement: deno 1080p ultra 7.7s vs 7.8s; chrome 4K
 * ultra 28.4s vs 27.7s; chrome 4K high 4.0s vs 4.3s.
 */
export const RENDER_FIXED_SECONDS: Record<RenderEngine, number> = {
  // Deno boot + shader compile.
  deno: 1.3,
  // Node start + Chromium launch + page load, on top of the same work: a flat
  // ~1.5s tax on every job, worst in relative terms on cheap renders. Paid on
  // purpose. Chrome is the default for its single shader path and its 8K
  // ceiling, not for its speed.
  chrome: 2.8,
}
export const RENDER_SECONDS_PER_MEGAPIXEL = 0.12
export const RENDER_POINTS_PER_SECOND = 1.9e9

export function estimateRenderSeconds(
  target: RenderTarget,
  camera: Camera2DLike | Camera3DLike,
  engine: RenderEngine = 'chrome',
): number {
  const megapixels = (target.width * target.height) / 1e6
  const points = qualityPointLimit(target, camera)
  return (
    RENDER_FIXED_SECONDS[engine] +
    RENDER_SECONDS_PER_MEGAPIXEL * megapixels +
    points / RENDER_POINTS_PER_SECOND
  )
}

/**
 * Credits for one render. Priced on WORKER OCCUPANCY, not GPU cost: even the
 * heaviest render is under a cent of GPU, but it holds a worker (and the queue
 * behind it) for its whole duration. One credit covers a typical render;
 * long ones scale with the seconds they occupy.
 */
export const SECONDS_PER_CREDIT = 5

export function creditsForRender(
  target: RenderTarget,
  camera: Camera2DLike | Camera3DLike,
  engine: RenderEngine = 'chrome',
): number {
  return Math.max(
    1,
    Math.ceil(
      estimateRenderSeconds(target, camera, engine) / SECONDS_PER_CREDIT,
    ),
  )
}

/** Animation export = one image render per frame, all sharing the queue. */
export function creditsForAnimation(
  target: RenderTarget,
  camera: Camera2DLike | Camera3DLike,
  frameCount: number,
  engine: RenderEngine = 'chrome',
): number {
  return creditsForRender(target, camera, engine) * Math.max(1, frameCount)
}

export function estimateAnimationSeconds(
  target: RenderTarget,
  camera: Camera2DLike | Camera3DLike,
  frameCount: number,
  engine: RenderEngine = 'chrome',
): number {
  return estimateRenderSeconds(target, camera, engine) * Math.max(1, frameCount)
}

/**
 * Read the render camera out of a flame descriptor (2D zoom or 3D
 * radius/fov), so callers holding only the descriptor price it correctly.
 */
export function cameraFromFlame(flame: {
  renderSettings?: {
    dimensions?: number
    camera?: { zoom?: number }
    camera3D?: {
      radius?: number
      fov?: number
      position?: number[]
      target?: number[]
    }
  }
}): Camera2DLike | Camera3DLike {
  const rs = flame.renderSettings
  if (rs?.dimensions === 3 && rs.camera3D) {
    const c = rs.camera3D
    let radius = c.radius ?? 5
    // Prefer a real position/target pair when present — radius may be stale.
    if (c.position && c.target && c.position.length >= 3) {
      const dx = (c.position[0] ?? 0) - (c.target[0] ?? 0)
      const dy = (c.position[1] ?? 0) - (c.target[1] ?? 0)
      const dz = (c.position[2] ?? 0) - (c.target[2] ?? 0)
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d > 0) radius = d
    }
    return { radius, fov: c.fov ?? 60 }
  }
  return { zoom: rs?.camera?.zoom ?? 1 }
}
