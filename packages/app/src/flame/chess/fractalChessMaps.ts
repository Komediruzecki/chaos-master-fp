/** Small native IFS construction helpers for the independent chess art collection. */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import { sampleFlameFigurineCloud } from './flameFigurineCloud'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'

export type Point3 = readonly [number, number, number]
export type Matrix3 = readonly [Point3, Point3, Point3]
export type ArtVariation = 'linear3D' | 'sinusoidal3D' | 'swirl3D' | 'curl3D'
export type ArtMap = {
  matrix: Matrix3
  offset: Point3
  weight?: number
  colour?: number
  mix?: readonly (readonly [ArtVariation, number])[]
}
export const unitMatrix: Matrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
export function diagonal(x: number, y = x, z = x): Matrix3 {
  return [
    [x, 0, 0],
    [0, y, 0],
    [0, 0, z],
  ]
}
export function product(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map((row) =>
    [0, 1, 2].map((i) => row.reduce((sum, v, n) => sum + v * b[n]![i]!, 0)),
  ) as unknown as Matrix3
}
export function rotation(angle: number, axis: 'x' | 'y' | 'z' = 'z'): Matrix3 {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  if (axis === 'x')
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ]
  if (axis === 'y')
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c],
    ]
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ]
}
export function affine(matrix: Matrix3, offset: Point3 = [0, 0, 0]) {
  return {
    a: matrix[0][0],
    b: matrix[0][1],
    c: matrix[0][2],
    d: offset[0],
    e: matrix[1][0],
    f: matrix[1][1],
    g: matrix[1][2],
    h: offset[1],
    i: matrix[2][0],
    j: matrix[2][1],
    k: matrix[2][2],
    l: offset[2],
  }
}

/** Each colour belongs to a recurrence, so branches keep colour at every scale. */
export function nativeArtFlame(
  name: string,
  description: string,
  maps: readonly ArtMap[],
  hues: readonly (readonly [number, number])[],
): FlameDescriptor {
  const transforms: FlameDescriptor3D['transforms'] = {}
  maps.forEach((map, i) => {
    const colour = hues[(map.colour ?? i) % hues.length]!
    transforms[`art_${i}` as TransformId] = {
      visible: true,
      probability: map.weight ?? 1,
      preAffine: affine(unitMatrix),
      postAffine: affine(map.matrix, map.offset),
      color: { x: colour[0], y: colour[1] },
      colorSpeed: 0.58,
      variations: Object.fromEntries(
        (map.mix ?? [['linear3D', 1] as const]).map(([type, weight], n) => [
          `v${n}` as VariationId,
          { type, weight, visible: true },
        ]),
      ),
    }
  })
  return validateFlame({
    version: latestSchemaVersion,
    metadata: { name, description, author: 'Lumen Apeiron' },
    transforms,
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      pointInitMode: 'pointInitUnitBall',
      colorInitMode: 'colorInitZero',
      skipIters: 50,
      drawMode: 'light',
      exposure: -0.8,
      contrast: 1.1,
      vibrancy: 1,
      lightPower: 0,
      highlightPower: 0.05,
      depthColorPower: 0,
      backgroundColor: [0.006, 0.012, 0.02],
      camera3D: {
        theta: 0.35,
        phi: 1.23,
        radius: 4.2,
        target: [0, 0.9, 0],
        fov: 45,
        roll: 0,
      },
    },
  })
}

/** A repeatable authored final affine fits new studies only; original recipes are never modified. */
export function fitArtFlame(
  flame: FlameDescriptor,
  width: number,
  height: number,
  depth: number,
): FlameDescriptor {
  const { bounds } = sampleFlameFigurineCloud(flame, {
    count: 4096,
    seed: 0x617274,
    burnIn: 128,
  })
  const sizes = bounds.max.map((v, i) => Math.max(0.001, v - bounds.min[i]!))
  const sx = width / sizes[0]!,
    sy = height / sizes[1]!,
    sz = depth / sizes[2]!
  // A modest safety margin keeps unsampled extremities away from neighbouring squares.
  flame.finalTransform = affine(diagonal(sx * 0.9, sy * 0.9, sz * 0.9), [
    -(bounds.max[0] + bounds.min[0]) * sx * 0.45,
    0.05 - bounds.min[1] * sy * 0.9,
    -(bounds.max[2] + bounds.min[2]) * sz * 0.45,
  ])
  return flame
}
