/** Small rigid-contact math helpers; quaternions use xyzw order. */
import type { ContactQuaternion as Q, ContactVector as V, } from './rookContactTypes'

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V, scale: number): V => [
  a[0] * scale,
  a[1] * scale,
  a[2] * scale,
]
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export function rotate(v: V, q: Q): V {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]),
    ty = 2 * (q[2] * v[0] - q[0] * v[2]),
    tz = 2 * (q[0] * v[1] - q[1] * v[0])
  return [
    v[0] + q[3] * tx + q[1] * tz - q[2] * ty,
    v[1] + q[3] * ty + q[2] * tx - q[0] * tz,
    v[2] + q[3] * tz + q[0] * ty - q[1] * tx,
  ]
}
export function turn(q: Q, angular: V, dt: number): Q {
  const [x, y, z] = mul(angular, dt / 2)
  const result: Q = [
    q[0] + x * q[3] + y * q[2] - z * q[1],
    q[1] + y * q[3] + z * q[0] - x * q[2],
    q[2] + z * q[3] + x * q[1] - y * q[0],
    q[3] - x * q[0] - y * q[1] - z * q[2],
  ]
  const length = Math.hypot(...result)
  return result.map((n) => n / length) as Q
}
export function cap(v: V, limit: number): V {
  const length = Math.hypot(...v)
  return length > limit ? mul(v, limit / length) : v
}
