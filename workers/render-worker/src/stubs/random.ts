/* eslint-disable */
/**
 * Server-side stub for @/shaders/random.
 *
 * random() and setSeed() use the WGSL string API to write proper
 * WGSL that references the randomState private var. The original
 * 'use gpu' functions use randomState.$ patterns the extractor
 * can't handle, so raw WGSL is used instead.
 */

import { tgpu } from 'typegpu'
import { f32, u32, vec2f, vec2u, vec3f } from 'typegpu/data'
import { acos, cos, mul, pow, sin, sqrt } from 'typegpu/std'
import { PI } from '@/flame/constants'

export const randomState = tgpu.privateVar(vec2u, vec2u(0, 0))

export const setSeed = tgpu.fn([vec2u], u32) /* wgsl */ `
  (seed: vec2u) -> u32 {
    randomState = seed;
    return 0u;
  }
`

// xoroshiro64++ RNG with next() and rotl() inlined.
// Returns f32 in [0, 1).
export const random = tgpu.fn([], f32) /* wgsl */ `
  () -> f32 {
    let s0 = randomState[0];
    var s1 = randomState[1];
    s1 = s1 ^ s0;
    randomState[0] = ((s0 << 26u) | (s0 >> 6u)) ^ s1 ^ (s1 << 9u);
    randomState[1] = (s1 << 13u) | (s1 >> 19u);
    let a = randomState.x;
    return bitcast<f32>((a & 0x007fffffu) | 0x3f800000u) - 1.0;
  }
`

export const hash = tgpu.fn(
  [u32],
  u32,
)((i: any) => {
  let x = i ^ (i >> 17)
  x *= u32(0xed5ad4bb)
  x ^= x >> 11
  x *= u32(0xac4c1b51)
  x ^= x >> 15
  x *= u32(0x31848bab)
  x ^= x >> 14
  return x
})

export const randomUnitDisk = tgpu.fn(
  [],
  vec2f,
)((() => {
  'use gpu'
  const r = sqrt(random())
  const theta = random() * 2 * PI.$
  return mul(r, vec2f(cos(theta), sin(theta)))
}) as any)

export const randomUnitSquare = tgpu.fn(
  [],
  vec2f,
)((() => {
  'use gpu'
  return vec2f(random(), random()).sub(vec2f(0.5, 0.5)).mul(2)
}) as any)

export const randomUnitSphere = tgpu.fn(
  [],
  vec3f,
)((() => {
  'use gpu'
  const theta = random() * 2 * PI.$
  const phi = acos(2 * random() - 1)
  return mul(
    sqrt(1),
    vec3f(sin(phi) * cos(theta), sin(phi) * sin(theta), cos(phi)),
  )
}) as any)

export const randomUnitBall = tgpu.fn(
  [],
  vec3f,
)((() => {
  'use gpu'
  const theta = random() * 2 * PI.$
  const phi = acos(2 * random() - 1)
  const r = pow(random(), 1.0 / 3.0)
  return mul(r, vec3f(sin(phi) * cos(theta), sin(phi) * sin(theta), cos(phi)))
}) as any)
