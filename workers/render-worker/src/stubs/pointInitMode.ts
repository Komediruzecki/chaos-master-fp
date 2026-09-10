/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/restrict-plus-operands */
/**
 * Server-side stub for @/flame/pointInitMode.
 *
 * Functions use 'use gpu' arrow syntax — the typegpu wrapper's extractor
 * converts them to WGSL strings at module init time. Each implementation is
 * cast `as any` because TS cannot verify tgpu DSL return types against the
 * tgpu.fn signature without the build plugin.
 */

import { perlin2d } from '@typegpu/noise'
import { tgpu } from 'typegpu'
import { f32, u32, vec2f } from 'typegpu/data'
import { add, cos, floor, log, mul, sin, sqrt } from 'typegpu/std'
import { PI } from '@/flame/constants'
import { random } from '@/shaders/random'

const pointInitModeFn = tgpu.fn([u32], vec2f)

export const pointInitModeCircle = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r = sqrt(random())
  const theta = random() * 2 * PI.$
  return mul(r, vec2f(cos(theta), sin(theta)))
}) as any)

export const pointInitModeSquare = pointInitModeFn(((_index: number) => {
  'use gpu'
  return vec2f(random(), random()).mul(2.0).sub(1.0)
}) as any)

export const pointInitModeCross = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r1 = random()
  const r2 = random()

  const t = r1 * 2.0 - 1.0
  if (r2 < 0.5) {
    return vec2f(t, t)
  } else {
    return vec2f(t, -t)
  }
}) as any)

export const pointInitModePlus = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r1 = random()
  const r2 = random()

  const t = r1 * 2.0 - 1.0
  if (r2 < 0.5) {
    return vec2f(t, 0.0)
  } else {
    return vec2f(0.0, t)
  }
}) as any)

export const pointInitModeTriangle = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r1 = random()
  const r2 = random()

  const s = sqrt(r1)
  const a = f32(1.0) - s
  const b = s * (f32(1.0) - r2)
  const c = s * r2

  const x = a * -1.0 + b * 1.0 + c * 0.0
  const y = a * -1.0 + b * -1.0 + c * 1.0

  return vec2f(x, y)
}) as any)

export const pointInitModeGaussian = pointInitModeFn(((_index: number) => {
  'use gpu'
  const u1 = random() + f32(1e-6)
  const u2 = random()

  const sigma = f32(0.4)
  const radius = sigma * sqrt(f32(-2.0) * log(u1))
  const theta = u2 * f32(2.0) * PI.$

  return vec2f(radius * cos(theta), radius * sin(theta))
}) as any)

export const pointInitModeAnnulus = pointInitModeFn(((_index: number) => {
  'use gpu'
  const inner = f32(0.4)
  const outer = f32(1.0)

  const r = sqrt(random() * (outer * outer - inner * inner) + inner * inner)
  const theta = random() * 2.0 * PI.$

  return vec2f(r * cos(theta), r * sin(theta))
}) as any)

export const pointInitModeStar = pointInitModeFn(((_index: number) => {
  'use gpu'
  const spikes = f32(5.0)
  const theta = random() * 2.0 * PI.$

  const k = f32(0.5) + f32(0.5) * cos(theta * spikes)

  const r = sqrt(random()) * k
  return vec2f(r * cos(theta), r * sin(theta))
}) as any)

export const pointInitModeHexagon = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r1 = random()
  const r2 = random()

  const sector = f32(floor(random() * 6.0))
  const angle = sector * (PI.$ / 3.0)

  const s = sqrt(r1)
  const a = 1.0 - s
  const b = s * (1.0 - r2)
  const c = s * r2

  const v1 = vec2f(0.0, 0.0)
  const v2 = vec2f(cos(angle), sin(angle))
  const v3 = vec2f(cos(angle + PI.$ / 3.0), sin(angle + PI.$ / 3.0))

  return vec2f(a * v1.x + b * v2.x + c * v3.x, a * v1.y + b * v2.y + c * v3.y)
}) as any)

export const pointInitModeSpiral = pointInitModeFn(((_index: number) => {
  'use gpu'
  const t = random()

  const turns = f32(3.0)
  const theta = t * turns * 2.0 * PI.$

  const r = t

  return vec2f(r * cos(theta), r * sin(theta))
}) as any)

const haltonFn = tgpu.fn([u32, u32], f32)

const halton = haltonFn(((index: number, base: number) => {
  'use gpu'
  let f = f32(1.0)
  let r = f32(0.0)
  let i = index

  while (i > 0) {
    f = f / f32(base)
    r = r + f * f32(i % base)
    i = u32(floor(f32(i) / f32(base)))
  }

  return r
}) as any)

export const pointInitModeHalton = pointInitModeFn(((index: number) => {
  'use gpu'

  const x = halton(index + 1, u32(2))
  const y = halton(index + 1, u32(3))

  return mul(vec2f(x, y), 2.0).sub(1.0)
}) as any)

export const pointInitModePerlin = pointInitModeFn(((_index: number) => {
  'use gpu'
  const xy = mul(vec2f(random(), random()), 2.0).sub(1.0)
  const nx = perlin2d.sample(mul(xy, 0.9))
  return add(xy, nx)
}) as any)

export const pointInitModeUnitDisk = pointInitModeFn(((_index: number) => {
  'use gpu'
  const r = sqrt(random())
  const theta = random() * 2 * PI.$
  return mul(r, vec2f(cos(theta), sin(theta)))
}) as any)

export const pointInitModeToImplFn = {
  pointInitCircle: pointInitModeCircle,
  pointInitSquare: pointInitModeSquare,
  pointInitCross: pointInitModeCross,
  pointInitPlus: pointInitModePlus,
  pointInitTriangle: pointInitModeTriangle,
  pointInitGaussian: pointInitModeGaussian,
  pointInitAnnulus: pointInitModeAnnulus,
  pointInitStar: pointInitModeStar,
  pointInitHexagon: pointInitModeHexagon,
  pointInitSpiral: pointInitModeSpiral,
  pointInitHalton: pointInitModeHalton,
  pointInitPerlin: pointInitModePerlin,
  pointInitUnitDisk: pointInitModeUnitDisk,
  pointInitGaussianDisk: pointInitModeGaussian,
  pointInitUnitSquare: pointInitModeSquare,
  pointInitModeGaussianSquare: pointInitModeGaussian,
  pointInitModeGaussianCircle: pointInitModeGaussian,
}

export type PointInitMode = keyof typeof pointInitModeToImplFn
