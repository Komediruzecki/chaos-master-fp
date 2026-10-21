// Narrow signatures for the existing architectural factors, before any finish is applied.
import { d, tgpu } from 'typegpu'
import { SurfaceFinish } from '../almanac/bookDetailShader'

export const SCENE_DETAIL_URL =
  '/models/observatory/surfaces/observatory-surfaces-v1.bin'

/** 0 smooth enamel/bone/silver, 1 mineral stone, 2 charcoal lacquer, 3 worked alloy. */
export const sceneSurfaceKind = tgpu.fn(
  [d.vec3f, d.vec4f],
  d.u32,
)((base, surface) => {
  'use gpu'
  // Stone is recognized by roughness and metallic factors, so score tinting
  // cannot turn a temple pier or bridge tread into a different material.
  if (surface.x < 0.2 && surface.y >= 0.5) {
    if (surface.x < 0.01 && surface.y > 0.7 && surface.y < 0.76) return d.u32(2)
    // The bay's small ivory markings retain their smooth authored finish.
    if (base.x < 0.4) return d.u32(1)
  }
  if (surface.x > 0.55) {
    // Neutral silver keeps its clean edge. Warm brass and the teal-bronze
    // relic receive machining, without recoloring either alloy.
    if (base.x - base.y > 0.025 || base.y - base.x > 0.05) return d.u32(3)
  }
  return d.u32(0)
})

export const OBSERVATORY_FINISH = SurfaceFinish({
  repeat: d.vec3f(1.35, 0.32, 0.24),
  height: d.vec3f(0.006, 0.001, 0.0008),
  contrast: d.vec3f(2, 0.5, 0.45),
  environment: d.vec3f(0.2, 0.5, 1),
  roughness: 0.6,
  slope: 0.24,
})

export const TEMPLE_FINISH = SurfaceFinish({
  repeat: d.vec3f(1.4, 0.32, 0.24),
  height: d.vec3f(0.005, 0.001, 0.0008),
  contrast: d.vec3f(3, 0.5, 0.45),
  environment: d.vec3f(0.2, 0.5, 1),
  roughness: 0.65,
  slope: 0.22,
})
