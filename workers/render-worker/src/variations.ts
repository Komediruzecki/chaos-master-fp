/**
 * Pure TypeScript variation functions — ported from TGSL/WGSL.
 * Each takes [x, y], params object, and returns [x, y].
 */

import type { Xoroshiro64 } from './rng.ts'
import type { AffineCoefs, VariationParams } from './types.ts'

const { PI, sin, cos, atan2, sqrt, exp, log, pow, abs, tan, cosh, sinh } = Math

// ---- helpers ----

function dot(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1]
}

function len(v: [number, number]): number {
  return sqrt(v[0] * v[0] + v[1] * v[1])
}

const EPS = 1e-10

// ---- variation type ----

export type VariationFn = (
  pos: [number, number],
  coefs: AffineCoefs,
  weight: number,
  params: Record<string, number> | undefined,
  rng: Xoroshiro64,
) => [number, number]

// ---- simple variations ----

function waves(
  pos: [number, number],
  coefs: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const xArg = pos[1] / (coefs.c * coefs.c)
  const yArg = pos[0] / (coefs.f * coefs.f)
  return [pos[0] + coefs.b * sin(xArg), pos[1] + coefs.e * sin(yArg)]
}

function popcorn(
  pos: [number, number],
  coefs: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [
    pos[0] + coefs.c * sin(tan(3 * pos[1])),
    pos[1] + coefs.f * sin(tan(3 * pos[0])),
  ]
}

function rings(
  pos: [number, number],
  coefs: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const c2 = coefs.c * coefs.c
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  const factor = ((r + c2) % (2 * c2)) - c2 + r * (1 - c2)
  return [cos(theta) * factor, sin(theta) * factor]
}

function fan(
  pos: [number, number],
  coefs: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const t = PI * coefs.c * coefs.c
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  const thalf = t / 2
  const modCond = (theta + coefs.f) % t
  const angle = modCond > thalf ? theta - thalf : theta + thalf
  return [cos(angle) * r, sin(angle) * r]
}

function linear(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [pos[0], pos[1]]
}

function randomDisk(
  _pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  return rng.unitDisk()
}

function gaussian(
  _pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const r = rng.next() + rng.next() + rng.next() + rng.next() - 2
  const theta = rng.next() * 2 * PI
  return [cos(theta) * r, sin(theta) * r]
}

function sinusoidal(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [sin(pos[0]), sin(pos[1])]
}

function spherical(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r2 = dot(pos, pos)
  return [pos[0] / r2, pos[1] / r2]
}

function swirl(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r2 = dot(pos, pos)
  const s2 = sin(r2)
  const c2 = cos(r2)
  return [pos[0] * s2 - pos[1] * c2, pos[0] * c2 + pos[1] * s2]
}

function horseshoe(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  return [(pos[0] - pos[1]) * (pos[0] + pos[1]) / r, (2 * pos[0] * pos[1]) / r]
}

function polar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [theta / PI, r - 1]
}

function handkerchief(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [sin(theta + r) * r, cos(theta - r) * r]
}

function heart(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [sin(theta * r) * r, -cos(theta * r) * r]
}

function disc(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  const thOverPi = theta / PI
  return [sin(PI * r) * thOverPi, cos(PI * r) * thOverPi]
}

function spiral(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [(cos(theta) + sin(r)) / r, (sin(theta) - cos(r)) / r]
}

function hyperbolic(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [sin(theta) / r, r * cos(theta)]
}

function diamond(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  return [sin(theta) * cos(r), cos(theta) * sin(r)]
}

function exVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  const p0 = sin(theta + r)
  const p1 = cos(theta - r)
  const p03 = p0 * p0 * p0
  const p13 = p1 * p1 * p1
  return [(p03 + p13) * r, (p03 - p13) * r]
}

function julia(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const sqrtr = sqrt(len(pos))
  const theta = atan2(pos[1], pos[0])
  const omega = rng.next() > 0.5 ? PI : 0
  const angle = theta / 2 + omega
  return [cos(angle) * sqrtr, sin(angle) * sqrtr]
}

function bent(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [
    pos[0] < 0 ? 2 * pos[0] : pos[0],
    pos[1] < 0 ? pos[1] / 2 : pos[1],
  ]
}

function fisheye(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const factor = 2 / (r + 1)
  return [pos[1] * factor, pos[0] * factor]
}

function eyefish(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const factor = 2 / (r + 1)
  return [pos[0] * factor, pos[1] * factor]
}

function exponential(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const factor = exp(pos[0] - 1)
  const piY = PI * pos[1]
  return [cos(piY) * factor, sin(piY) * factor]
}

function power(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const theta = atan2(pos[1], pos[0])
  const sinTheta = sin(theta)
  const factor = pow(r, sinTheta)
  return [cos(theta) * factor, sinTheta * factor]
}

function cosine(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const piX = PI * pos[0]
  return [cos(piX) * cosh(pos[1]), -sin(piX) * sinh(pos[1])]
}

function bubble(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r2 = dot(pos, pos)
  const factor = 4 / (r2 + 4)
  return [pos[0] * factor, pos[1] * factor]
}

function cylinder(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [sin(pos[0]), pos[1]]
}

function noise(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const rand = rng.next()
  const angle = 2 * PI * rng.next()
  return [pos[0] * cos(angle) * rand, pos[1] * sin(angle) * rand]
}

function blurVar(
  _pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const rand = rng.next()
  const angle = 2 * PI * rng.next()
  return [cos(angle) * rand, sin(angle) * rand]
}

function archVar(
  _pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const angle = rng.next() * PI * weight
  return [sin(angle), (sin(angle) * sin(angle)) / cos(angle)]
}

function tangentVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [sin(pos[0]) / cos(pos[1]), tan(pos[1])]
}

function squareVar(
  _pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  return [rng.next() - 0.5, rng.next() - 0.5]
}

function raysVar(
  pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const rand = rng.next()
  const r = len(pos)
  const angle = rand * PI * weight
  const fact = (weight * tan(angle)) / (r * r)
  return [cos(pos[0]) * fact, sin(pos[1]) * fact]
}

function bladeVar(
  pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const rand = rng.next()
  const r = len(pos)
  const angle = rand * r * weight
  return [pos[0] * (cos(angle) + sin(angle)), pos[0] * (cos(angle) - sin(angle))]
}

function secantVar(
  pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const angle = weight * r
  return [pos[0], 1 / (weight * cos(angle))]
}

function twintrianVar(
  pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  rng: Xoroshiro64,
): [number, number] {
  const r = len(pos)
  const angle = rng.next() * r * weight
  const sinAngle = sin(angle)
  const t = log(sinAngle * sinAngle) / log(10) + cos(angle)
  return [pos[0] * t, pos[0] * (t - PI * sinAngle)]
}

function crossVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const squareDiff = pos[0] * pos[0] - pos[1] * pos[1]
  const fact = sqrt(1 / (squareDiff * squareDiff))
  return [pos[0] * fact, pos[1] * fact]
}

function idiscVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const M_1_PI_F = 0.31830988618379
  const a = PI / (len(pos) + 1)
  const theta = atan2(pos[1], pos[0])
  const r = theta * M_1_PI_F
  const s = sin(a)
  const c = cos(a)
  return [r * c, r * s]
}

function butterflyVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const y2 = pos[1] * 2
  const wx = 4 / sqrt(3 * PI)
  const denominator = dot([pos[0], y2], [pos[0], y2])
  const r = wx * sqrt(abs(pos[1] * pos[0]) / (denominator + 1e-10))
  return [r * pos[0], r * y2]
}

function unpolarVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const vvar_2 = 0.5 / PI
  const r = exp(pos[1])
  const s = sin(pos[0])
  const c = cos(pos[0])
  return [vvar_2 * r * s, vvar_2 * r * c]
}

function squarizeVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const s = len(pos)
  let a = atan2(pos[1], pos[0])
  if (a < 0) a += 2 * PI
  const p = 4 * s * a * (1 / PI)
  let nx: number, ny: number
  if (p <= 1 * s) { nx = s; ny = p }
  else if (p <= 3 * s) { nx = 2 * s - p; ny = s }
  else if (p <= 5 * s) { nx = -s; ny = 4 * s - p }
  else if (p <= 7 * s) { nx = -(6 * s - p); ny = -s }
  else { nx = s; ny = -(8 * s - p) }
  return [nx, ny]
}

function sinusoidalVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  return [sin(pos[0]), sin(pos[1])]
}

function scryVar(
  pos: [number, number],
  _c: AffineCoefs,
  weight: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const t = dot(pos, pos)
  const safeWeight = weight === 0 ? EPS : weight
  const d = sqrt(t) * (t + 1 / safeWeight)
  if (d === 0) return [0, 0]
  const r = 1 / d
  return [pos[0] * r, pos[1] * r]
}

function tanhVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const tanhsin = sin(2 * pos[1])
  const tanhcos = cos(2 * pos[1])
  const tanhsinh = sinh(2 * pos[0])
  const tanhcosh = cosh(2 * pos[0])
  const d = tanhcos + tanhcosh
  if (d === 0) return [0, 0]
  const tanhden = 1 / d
  return [tanhden * tanhsinh, tanhden * tanhsin]
}

function twoFaceVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  let factor = 1.0
  if (pos[0] > 0) {
    const denom = pos[0] * pos[0] + pos[1] * pos[1]
    factor /= denom
  }
  return [factor * pos[0], factor * pos[1]]
}

function pyramidVar(
  pos: [number, number],
  _c: AffineCoefs,
  _w: number,
  _p: Record<string, number> | undefined,
  _r: Xoroshiro64,
): [number, number] {
  const x = pos[0] * pos[0] * pos[0]
  const y = pos[1] * pos[1] * pos[1]
  const div = abs(x) + abs(y) + 1e-9
  const r = 1 / div
  return [x * r, y * r]
}

// ---- Combined variation map ----

export const SIMPLE_VARIATIONS: Record<string, VariationFn> = {
  waves,
  popcorn,
  rings,
  fan,
  linear,
  randomDisk,
  gaussian,
  sinusoidal,
  spherical,
  swirl,
  horseshoe,
  polar,
  handkerchief,
  heart,
  disc,
  spiral,
  hyperbolic,
  diamond,
  exVar,
  julia,
  bent,
  fisheye,
  eyefish,
  exponential,
  power,
  cosine,
  bubble,
  cylinder,
  noise,
  blurVar,
  archVar,
  tangentVar,
  squareVar,
  raysVar,
  bladeVar,
  secantVar,
  twintrianVar,
  crossVar,
  idiscVar,
  butterflyVar,
  unpolarVar,
  squarizeVar,
  sinusoidalVar,
  scryVar,
  tanhVar,
  twoFaceVar,
  pyramidVar,
}

// ---- affine transform ----

export function transformAffine(
  pos: [number, number],
  coefs: AffineCoefs,
): [number, number] {
  return [
    coefs.a * pos[0] + coefs.b * pos[1] + coefs.c,
    coefs.d * pos[0] + coefs.e * pos[1] + coefs.f,
  ]
}

// ---- transform application (preAffine + variations + postAffine) ----

export function applyTransform(
  pos: [number, number],
  variations: VariationParams[],
  preAffine: AffineCoefs,
  postAffine: AffineCoefs,
  rng: Xoroshiro64,
): [number, number] {
  // Pre-affine
  const p = transformAffine(pos, preAffine)

  // Apply weighted variations
  const result: [number, number] = [0, 0]
  for (const v of variations) {
    const fn = SIMPLE_VARIATIONS[v.name]
    if (!fn) continue
    const offset = fn(p, preAffine, v.weight, v.params, rng)
    result[0] += offset[0] * v.weight
    result[1] += offset[1] * v.weight
  }

  // Post-affine
  return transformAffine(result, postAffine)
}
