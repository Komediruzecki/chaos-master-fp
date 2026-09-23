/**
 * Floating point with a separate integer exponent ("floatexp"), in JS.
 *
 * A double runs out of exponent at 2^±1023. The quantities a deep zoom
 * multiplies together — the bilinear-approximation coefficients, their
 * validity radii, a reference orbit passing near zero — go far past that, so
 * they are held as a double mantissa times `2^e` with `e` an ordinary number.
 * The GPU uses the same layout with f32 mantissas; `toGpu` does that rounding.
 *
 * Complex values share one exponent between the two parts: the larger part's
 * mantissa sits in [0.5, 1), and the smaller one is whatever it has to be.
 */

export interface ComplexFE {
  readonly re: number
  readonly im: number
  readonly e: number
}

export interface RealFE {
  readonly m: number
  readonly e: number
}

/** Exponent used for an exact zero, low enough to lose every comparison. */
export const ZERO_EXPONENT = -0x40000000

export const COMPLEX_ZERO: ComplexFE = { re: 0, im: 0, e: ZERO_EXPONENT }
export const REAL_ZERO: RealFE = { m: 0, e: ZERO_EXPONENT }

/** `x * 2^k` without overflowing on the way when `k` is large. */
export function scalePow2(x: number, k: number): number {
  if (k > 1000) return x * 2 ** 1000 * 2 ** (k - 1000)
  if (k < -1000) return x * 2 ** -1000 * 2 ** (k + 1000)
  return x * 2 ** k
}

/** The `k` with `|x| * 2^-k` in [0.5, 1), for finite non-zero `x`. */
export function exponentOf(x: number): number {
  const a = Math.abs(x)
  let k = Math.floor(Math.log2(a)) + 1
  const m = scalePow2(a, -k)
  if (m >= 1) k += 1
  else if (m < 0.5) k -= 1
  return k
}

export function complexFE(re: number, im: number, e = 0): ComplexFE {
  const a = Math.max(Math.abs(re), Math.abs(im))
  if (a === 0 || !Number.isFinite(a)) return COMPLEX_ZERO
  const k = exponentOf(a)
  return { re: scalePow2(re, -k), im: scalePow2(im, -k), e: e + k }
}

export function realFE(m: number, e = 0): RealFE {
  if (m === 0 || !Number.isFinite(m)) return REAL_ZERO
  const k = exponentOf(m)
  return { m: scalePow2(m, -k), e: e + k }
}

export function isZero(x: ComplexFE | RealFE): boolean {
  return 'm' in x ? x.m === 0 : x.re === 0 && x.im === 0
}

export function mulComplex(a: ComplexFE, b: ComplexFE): ComplexFE {
  return complexFE(
    a.re * b.re - a.im * b.im,
    a.re * b.im + a.im * b.re,
    a.e + b.e,
  )
}

export function addComplex(a: ComplexFE, b: ComplexFE): ComplexFE {
  if (isZero(a)) return b
  if (isZero(b)) return a
  const e = Math.max(a.e, b.e)
  return complexFE(
    scalePow2(a.re, a.e - e) + scalePow2(b.re, b.e - e),
    scalePow2(a.im, a.e - e) + scalePow2(b.im, b.e - e),
    e,
  )
}

/** `a * s` for a plain double `s`. */
export function scaleComplex(a: ComplexFE, s: number): ComplexFE {
  return complexFE(a.re * s, a.im * s, a.e)
}

export function absComplex(a: ComplexFE): RealFE {
  return realFE(Math.hypot(a.re, a.im), a.e)
}

export function mulReal(a: RealFE, b: RealFE): RealFE {
  return realFE(a.m * b.m, a.e + b.e)
}

export function divReal(a: RealFE, b: RealFE): RealFE {
  if (b.m === 0) throw new RangeError('floatexp division by zero')
  return realFE(a.m / b.m, a.e - b.e)
}

export function subReal(a: RealFE, b: RealFE): RealFE {
  if (b.m === 0) return a
  if (a.m === 0) return realFE(-b.m, b.e)
  const e = Math.max(a.e, b.e)
  return realFE(scalePow2(a.m, a.e - e) - scalePow2(b.m, b.e - e), e)
}

export function compareReal(a: RealFE, b: RealFE): number {
  if (a.m === 0 || b.m === 0 || Math.sign(a.m) !== Math.sign(b.m)) {
    return Math.sign(a.m - b.m)
  }
  const d = subReal(a, b)
  return Math.sign(d.m)
}

export function minReal(a: RealFE, b: RealFE): RealFE {
  return compareReal(a, b) <= 0 ? a : b
}

/** log2 of a positive value; -Infinity for zero or negative. */
export function log2Real(a: RealFE): number {
  return a.m > 0 ? a.e + Math.log2(a.m) : Number.NEGATIVE_INFINITY
}

/** The nearest double, or 0 / ±Infinity outside double range. */
export function realToNumber(a: RealFE): number {
  return a.m === 0 ? 0 : scalePow2(a.m, a.e)
}
