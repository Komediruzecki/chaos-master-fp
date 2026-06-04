import { f32, vec2f } from 'typegpu/data'
import { abs, atan2, clamp, cos, cosh, dot, exp, floor, length, log, pow, select, sin, sinh, sqrt, tan, } from 'typegpu/std'
import { random, randomUnitDisk } from '@/shaders/random'
import { EPS, PI } from '../../../constants'
import { simpleVariation } from '../types'

export const waves = simpleVariation('waves', (pos, varInfo) => {
  'use gpu'
  const T = varInfo.affineCoefs
  const xSinArg = pos.y / (T.c * T.c)
  const ySinArg = pos.x / (T.f * T.f)
  const delta = vec2f(T.b * sin(xSinArg), T.e * sin(ySinArg))
  return pos.add(delta).mul(varInfo.weight)
})

export const popcorn = simpleVariation('popcorn', (pos, varInfo) => {
  'use gpu'
  const T = varInfo.affineCoefs
  const tx = clamp(tan(3 * pos.x), -1e8, 1e8)
  const ty = clamp(tan(3 * pos.y), -1e8, 1e8)
  const delta = vec2f(T.c * sin(ty), T.f * sin(tx))
  return pos.add(delta).mul(varInfo.weight)
})

export const rings = simpleVariation('rings', (pos, varInfo) => {
  'use gpu'
  const T = varInfo.affineCoefs
  const c2 = T.c * T.c
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  const factor = ((r + c2) % (2 * c2)) - c2 + r * (1 - c2)
  return vec2f(cos(theta), sin(theta)).mul(factor).mul(varInfo.weight)
})

export const fan = simpleVariation('fan', (pos, varInfo) => {
  'use gpu'
  const T = varInfo.affineCoefs
  const t = PI.$ * T.c * T.c + EPS.$
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)

  const thalf = t / 2
  const trueAngle = theta - thalf
  const falseAngle = theta + thalf
  const modCond = (theta + T.f) % t
  const angle = select(falseAngle, trueAngle, modCond > thalf)
  return vec2f(cos(angle), sin(angle)).mul(r).mul(varInfo.weight)
})

export const linear = simpleVariation('linear', (pos, varInfo) => {
  'use gpu'
  return vec2f(pos).mul(varInfo.weight)
})

export const randomDisk = simpleVariation('randomDisk', (_pos, varInfo) => {
  'use gpu'
  return randomUnitDisk().mul(varInfo.weight)
})

export const gaussian = simpleVariation('gaussian', (_pos, varInfo) => {
  'use gpu'
  const r = random() + random() + random() + random() - 2
  const theta = random() * 2 * PI.$
  return vec2f(cos(theta), sin(theta)).mul(r).mul(varInfo.weight)
})

export const sinusoidal = simpleVariation('sinusoidal', (pos, varInfo) => {
  'use gpu'
  return vec2f(sin(pos.x), sin(pos.y)).mul(varInfo.weight)
})

export const spherical = simpleVariation('spherical', (pos, varInfo) => {
  'use gpu'
  const r2 = dot(pos, pos) + EPS.$
  return pos.div(r2).mul(varInfo.weight)
})

export const swirl = simpleVariation('swirl', (pos, varInfo) => {
  'use gpu'
  const r2 = dot(pos, pos)
  const s2 = sin(r2)
  const c2 = cos(r2)
  return vec2f(pos.x * s2 - pos.y * c2, pos.x * c2 + pos.y * s2).mul(
    varInfo.weight,
  )
})

export const horseshoe = simpleVariation('horseshoe', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  return vec2f((pos.x - pos.y) * (pos.x + pos.y), 2 * pos.x * pos.y)
    .div(r)
    .mul(varInfo.weight)
})

export const polar = simpleVariation('polar', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(theta / PI.$, r - 1).mul(varInfo.weight)
})

export const handkerchief = simpleVariation('handkerchief', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(sin(theta + r), cos(theta - r))
    .mul(r)
    .mul(varInfo.weight)
})

export const heart = simpleVariation('heart', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(sin(theta * r), -cos(theta * r))
    .mul(r)
    .mul(varInfo.weight)
})

export const disc = simpleVariation('disc', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  const thOverPi = theta / PI.$
  return vec2f(sin(PI.$ * r), cos(PI.$ * r))
    .mul(thOverPi)
    .mul(varInfo.weight)
})

export const spiral = simpleVariation('spiral', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(cos(theta) + sin(r), sin(theta) - cos(r))
    .div(r)
    .mul(varInfo.weight)
})

export const hyperbolic = simpleVariation('hyperbolic', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(sin(theta) / r, r * cos(theta)).mul(varInfo.weight)
})

export const diamond = simpleVariation('diamond', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  return vec2f(sin(theta) * cos(r), cos(theta) * sin(r)).mul(varInfo.weight)
})

export const exVar = simpleVariation('exVar', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  const p0 = sin(theta + r)
  const p1 = cos(theta - r)
  const p03 = p0 * p0 * p0
  const p13 = p1 * p1 * p1
  return vec2f(p03 + p13, p03 - p13)
    .mul(r)
    .mul(varInfo.weight)
})

export const julia = simpleVariation('julia', (pos, varInfo) => {
  'use gpu'
  const sqrtr = sqrt(length(pos))
  const theta = atan2(pos.y, pos.x)
  const omega = f32(select(0, PI.$, random() > 0.5))
  const angle = theta / 2.0 + omega
  return vec2f(cos(angle), sin(angle)).mul(sqrtr).mul(varInfo.weight)
})

export const bent = simpleVariation('bent', (pos, varInfo) => {
  'use gpu'
  const fx = select(pos.x, 2.0 * pos.x, pos.x < 0)
  const fy = select(pos.y, pos.y / 2.0, pos.y < 0)
  return vec2f(fx, fy).mul(varInfo.weight)
})

export const fisheye = simpleVariation('fisheye', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const factor = 2 / (r + 1)
  return pos.yx.mul(factor).mul(varInfo.weight)
})

export const eyefish = simpleVariation('eyefish', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const factor = 2 / (r + 1)
  return pos.mul(factor).mul(varInfo.weight)
})

export const exponential = simpleVariation('exponential', (pos, varInfo) => {
  'use gpu'
  const factor = exp(pos.x - 1)
  const piY = PI.$ * pos.y
  return vec2f(cos(piY), sin(piY)).mul(factor).mul(varInfo.weight)
})

export const power = simpleVariation('power', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const theta = atan2(pos.y, pos.x)
  const sinTheta = sin(theta)
  const factor = pow(r, sinTheta)
  return vec2f(cos(theta), sinTheta).mul(factor).mul(varInfo.weight)
})

export const cosine = simpleVariation('cosine', (pos, varInfo) => {
  'use gpu'
  const piX = PI.$ * pos.x
  return vec2f(cos(piX) * cosh(pos.y), -sin(piX) * sinh(pos.y)).mul(
    varInfo.weight,
  )
})

export const bubble = simpleVariation('bubble', (pos, varInfo) => {
  'use gpu'
  const r = length(pos)
  const r2 = r * r
  const factor = 4 / (r2 + 4)
  return vec2f(pos.x, pos.y).mul(factor).mul(varInfo.weight)
})

export const cylinder = simpleVariation('cylinder', (pos, varInfo) => {
  'use gpu'
  return vec2f(sin(pos.x), pos.y).mul(varInfo.weight)
})

export const noise = simpleVariation('noise', (pos, varInfo) => {
  'use gpu'
  const rand = random()
  const angle = 2 * PI.$ * random()
  return vec2f(pos.x * cos(angle), pos.y * sin(angle))
    .mul(rand)
    .mul(varInfo.weight)
})

export const blurVar = simpleVariation(
  'blurVar',
  (_pos, varInfo) => {
    'use gpu'
    const rand = random()
    const angle = 2 * PI.$ * random()
    return vec2f(cos(angle), sin(angle)).mul(rand).mul(varInfo.weight)
  },
  'blur',
)

export const tangentVar = simpleVariation('tangentVar', (pos, varInfo) => {
  'use gpu'
  return vec2f(sin(pos.x) / cos(pos.y), tan(pos.y)).mul(varInfo.weight)
})

export const squareVar = simpleVariation('squareVar', (_pos, varInfo) => {
  'use gpu'
  const randX = random()
  const randY = random()
  return vec2f(randX - 0.5, randY - 0.5).mul(varInfo.weight)
})

export const raysVar = simpleVariation('raysVar', (pos, varInfo) => {
  'use gpu'
  const weight = varInfo.weight
  const rand = random()
  const r = length(pos)
  const angle = rand * PI.$ * weight
  const fact = (weight * tan(angle)) / (r * r)
  return vec2f(cos(pos.x), sin(pos.y)).mul(fact)
})

export const bladeVar = simpleVariation('bladeVar', (pos, varInfo) => {
  'use gpu'
  const weight = varInfo.weight
  const rand = random()
  const r = length(pos)
  const angle = rand * r * weight
  return vec2f(cos(angle) + sin(angle), cos(angle) - sin(angle)).mul(pos.x)
})

export const secantVar = simpleVariation('secantVar', (pos, varInfo) => {
  'use gpu'
  const weight = varInfo.weight
  const r = length(pos)
  const angle = weight * r
  return vec2f(pos.x, 1 / (weight * cos(angle)))
})

export const twintrianVar = simpleVariation('twintrianVar', (pos, varInfo) => {
  'use gpu'
  const weight = varInfo.weight
  const r = length(pos)
  const angle = random() * r * weight
  const sinAngle = sin(angle)
  const t = log(sinAngle * sinAngle) / log(10) + cos(angle)
  return vec2f(t, t - PI.$ * sinAngle).mul(pos.x)
})

export const crossVar = simpleVariation('crossVar', (pos, varInfo) => {
  'use gpu'
  const squareDiff = pos.x * pos.x - pos.y * pos.y
  const fact = sqrt(1 / (squareDiff * squareDiff))
  return vec2f(pos.x, pos.y).mul(fact).mul(varInfo.weight)
})

export const idiscVar = simpleVariation('idiscVar', (pos, varInfo) => {
  'use gpu'
  const M_1_PI_F = 0.31830988618379
  const a = PI.$ / (length(pos) + 1.0)
  const theta = atan2(pos.y, pos.x)
  const r = theta * M_1_PI_F
  const s = sin(a)
  const c = cos(a)

  return vec2f(r * c, r * s).mul(varInfo.weight)
})

export const butterflyVar = simpleVariation('butterflyVar', (pos, varInfo) => {
  'use gpu'
  const y2 = pos.y * 2
  const wx = 4 / sqrt(3 * PI.$)
  const denominator = dot(vec2f(pos.x, y2), vec2f(pos.x, y2))
  const r = wx * sqrt(abs(pos.y * pos.x) / (denominator + 1e-10))

  return vec2f(r * pos.x, r * y2).mul(varInfo.weight)
})

export const unpolarVar = simpleVariation('unpolarVar', (pos, varInfo) => {
  'use gpu'
  // TODO: consider moving weight calculation inside variations, as they differ in some cases,
  // not all need weight calculation
  // const vvar_2 = (varInfo.weight * 0.5) / PI.$
  const vvar_2 = 0.5 / PI.$

  const r = exp(pos.y)
  const s = sin(pos.x)
  const c = cos(pos.x)

  const newX = vvar_2 * r * s
  const newY = vvar_2 * r * c

  return vec2f(newX, newY).mul(varInfo.weight)
})

export const squarizeVar = simpleVariation('squarizeVar', (pos, varInfo) => {
  'use gpu'
  const s = length(pos)
  let a = atan2(pos.y, pos.x)
  if (a < 0.0) {
    a += 2.0 * PI.$
  }
  const p = 4.0 * s * a * (1.0 / PI.$)

  let newX = f32(0.0)
  let newY = f32(0.0)

  if (p <= 1.0 * s) {
    newX = s
    newY = p
  } else if (p <= 3.0 * s) {
    newX = 2.0 * s - p
    newY = s
  } else if (p <= 5.0 * s) {
    newX = -s
    newY = 4.0 * s - p
  } else if (p <= 7.0 * s) {
    newX = -(6.0 * s - p)
    newY = -s
  } else {
    newX = s
    newY = -(8.0 * s - p)
  }

  return vec2f(newX, newY).mul(varInfo.weight)
})

export const sinusoidalVar = simpleVariation(
  'sinusoidalVar',
  (pos, varInfo) => {
    'use gpu'
    return vec2f(sin(pos.x), sin(pos.y)).mul(varInfo.weight)
  },
)

export const scryVar = simpleVariation('scryVar', (pos, varInfo) => {
  'use gpu'
  const t = dot(pos, pos)
  // Java: d = (sqrt(t) * (t + 1.0 / pAmount));
  // Note: We protect against division by zero if weight is 0
  const weight = select(varInfo.weight, EPS.$, varInfo.weight === 0.0)
  const d = sqrt(t) * (t + 1.0 / weight)

  if (d === 0.0) {
    // Java returns without modifying pVarTP (effectively adding 0)
    return vec2f(0.0, 0.0)
  }

  const r = 1.0 / d
  const newX = pos.x * r
  const newY = pos.y * r

  return vec2f(newX, newY)
})

export const tanhVar = simpleVariation('tanhVar', (pos, varInfo) => {
  'use gpu'
  const tanhsin = sin(2.0 * pos.y)
  const tanhcos = cos(2.0 * pos.y)
  const tanhsinh = sinh(2.0 * pos.x)
  const tanhcosh = cosh(2.0 * pos.x)

  const d = tanhcos + tanhcosh

  if (d === 0.0) {
    return vec2f(0.0, 0.0).mul(varInfo.weight)
  }

  const tanhden = 1.0 / d
  const newX = tanhden * tanhsinh
  const newY = tanhden * tanhsin

  return vec2f(newX, newY).mul(varInfo.weight)
})

export const twoFaceVar = simpleVariation('twoFaceVar', (pos, varInfo) => {
  'use gpu'
  // TODO: refactor when weight calculation becomes per variation
  let factor = f32(1.0) // This represents 'r' normalized by weight
  if (pos.x > 0.0) {
    const denom = pos.x * pos.x + pos.y * pos.y
    factor /= denom
  }

  const newX = factor * pos.x
  const newY = factor * pos.y

  return vec2f(newX, newY).mul(varInfo.weight)
})

export const pyramidVar = simpleVariation('pyramidVar', (pos, varInfo) => {
  'use gpu'
  const x = pos.x * pos.x * pos.x
  const y = pos.y * pos.y * pos.y

  const div = abs(x) + abs(y) + 0.000000001
  const r = 1.0 / div

  const newX = x * r
  const newY = y * r

  return vec2f(newX, newY).mul(varInfo.weight)
})

export const fociVar = simpleVariation('fociVar', (pos, varInfo) => {
  'use gpu'
  const expx = exp(pos.x) * 0.5
  const expnx = 0.25 / (expx + EPS.$)
  const denom = expx + expnx - cos(pos.y)
  const safe = select(denom, EPS.$, abs(denom) < EPS.$)
  const tmp = 1.0 / safe
  return vec2f((expx - expnx) * tmp, sin(pos.y) * tmp).mul(varInfo.weight)
})

export const deltaAVar = simpleVariation('deltaAVar', (pos, varInfo) => {
  'use gpu'
  const ratio =
    sqrt(pos.y * pos.y + (pos.x + 1.0) * (pos.x + 1.0)) /
    sqrt(pos.y * pos.y + (pos.x - 1.0) * (pos.x - 1.0))
  const avga = (atan2(pos.y, pos.x - 1.0) - atan2(pos.y, pos.x + 1.0)) * 0.5
  return vec2f(cos(avga), sin(avga)).mul(ratio).mul(varInfo.weight)
})

export const flipyVar = simpleVariation('flipyVar', (pos, varInfo) => {
  'use gpu'
  return vec2f(pos.x, select(-pos.y, pos.y, pos.x > 0.0)).mul(varInfo.weight)
})

export const flipcircleVar = simpleVariation(
  'flipcircleVar',
  (pos, varInfo) => {
    'use gpu'
    const r2 = pos.x * pos.x + pos.y * pos.y
    const w2 = varInfo.weight * varInfo.weight
    return vec2f(pos.x, select(-pos.y, pos.y, r2 > w2))
  },
)

export const expVar = simpleVariation('expVar', (pos, varInfo) => {
  'use gpu'
  const expe = exp(pos.x)
  return vec2f(cos(pos.y), sin(pos.y)).mul(expe).mul(varInfo.weight)
})

export const loonieVar = simpleVariation('loonieVar', (pos, varInfo) => {
  'use gpu'
  const r2 = dot(pos, pos)
  const w2 = varInfo.weight * varInfo.weight
  const factor = select(
    varInfo.weight,
    varInfo.weight * sqrt(w2 / r2 - 1.0),
    r2 < w2 && r2 !== 0.0,
  )
  return pos.mul(factor)
})

export const gammaVar = simpleVariation('gammaVar', (pos, varInfo) => {
  'use gpu'
  const x = sqrt(dot(pos, pos))
  // Lanczos approximation for lgamma
  const tmp = (x - 0.5) * log(x + 4.5) - (x + 4.5)
  const ser =
    1.0 +
    76.18009173 / x -
    86.50532033 / (x + 1.0) +
    24.01409822 / (x + 2.0) -
    1.231739516 / (x + 3.0) +
    0.00120858003 / (x + 4.0) -
    0.00000536382 / (x + 5.0)
  const lgamma_x = tmp + log(ser * sqrt(2.0 * PI.$))
  return vec2f(lgamma_x, atan2(pos.y, pos.x)).mul(varInfo.weight)
})

export const erfVar = simpleVariation('erfVar', (pos, varInfo) => {
  'use gpu'
  // Abramowitz & Stegun erf approximation
  const ax = abs(pos.x)
  const t = 1.0 / (1.0 + 0.3275911 * ax)
  const erfx =
    1.0 -
    (0.254829592 * t -
      0.284496736 * t * t +
      1.421413741 * t * t * t -
      1.453152027 * t * t * t * t +
      1.061405429 * t * t * t * t * t) *
      exp(-ax * ax)
  const ay = abs(pos.y)
  const ty = 1.0 / (1.0 + 0.3275911 * ay)
  const erfy =
    1.0 -
    (0.254829592 * ty -
      0.284496736 * ty * ty +
      1.421413741 * ty * ty * ty -
      1.453152027 * ty * ty * ty * ty +
      1.061405429 * ty * ty * ty * ty * ty) *
      exp(-ay * ay)
  return vec2f(
    select(erfx, -erfx, pos.x < 0.0),
    select(erfy, -erfy, pos.y < 0.0),
  ).mul(varInfo.weight)
})

export const apollonyVar = simpleVariation('apollonyVar', (pos, varInfo) => {
  'use gpu'
  const r = sqrt(3.0)
  const denom = pow(1.0 + r - pos.x, 2.0) + pos.y * pos.y
  const a0 = (3.0 * (1.0 + r - pos.x)) / denom - (1.0 + r) / (2.0 + r)
  const b0 = (3.0 * pos.y) / denom
  const f1x = a0 / (a0 * a0 + b0 * b0)
  const f1y = -b0 / (a0 * a0 + b0 * b0)

  const branch = f32(floor(3.0 * random()))

  const is0 = abs(branch) < 0.5
  const is1 = abs(branch - 1.0) < 0.5

  const x = select(
    select(-f1x / 2.0 + (f1y * r) / 2.0, -f1x / 2.0 - (f1y * r) / 2.0, is1),
    a0,
    is0,
  )
  const y = select(
    select((-f1x * r) / 2.0 - f1y / 2.0, (f1x * r) / 2.0 - f1y / 2.0, is1),
    b0,
    is0,
  )
  return vec2f(x, y).mul(varInfo.weight)
})
