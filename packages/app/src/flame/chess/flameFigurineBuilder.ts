/** Coordinate frames and native transform assembly for nonlinear chess figurines. */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'
import type { FlameFigurine } from './flameFigurineCatalog'
import type { PawnSide } from './pawnFlame'

export type Point = readonly [number, number, number]
export type Matrix = readonly [Point, Point, Point]
type Transform = FlameDescriptor3D['transforms'][TransformId]
type Affine = Transform['preAffine']
type Kind = 'linear3D' | 'sinusoidal3D' | 'swirl3D' | 'curl3D'
type Mix = readonly (readonly [Kind, number])[]
export type Frame = { centre: Point; matrix: Matrix; inverse: Matrix }
type LocalMap = {
  pre: Matrix
  shift: Point
  post: Matrix
  offset: Point
  mix: Mix
  mass: number
}
export type Builder = ReturnType<typeof createBuilder>

export const IDENTITY: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const COLOURS = {
  'aurora-queen': [
    [0.095, -0.17],
    [-0.16, -0.045],
    [0.045, 0.16],
  ],
  'ember-bishop': [
    [0.15, -0.09],
    [0.19, 0.09],
    [0.055, 0.18],
  ],
  'tidal-knight': [
    [-0.14, -0.065],
    [0.015, -0.18],
    [0.17, -0.13],
  ],
} as const

export function mul(a: Matrix, b: Matrix): Matrix {
  return a.map((row) =>
    [0, 1, 2].map((column) =>
      row.reduce((sum, value, n) => sum + value * b[n]![column]!, 0),
    ),
  ) as unknown as Matrix
}

function act(a: Matrix, point: Point): Point {
  return a.map((row) =>
    row.reduce((sum, value, n) => sum + value * point[n]!, 0),
  ) as unknown as Point
}

function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function negative(a: Point): Point {
  return [-a[0], -a[1], -a[2]]
}

export function scale(amount: number): Matrix {
  return [
    [amount, 0, 0],
    [0, amount, 0],
    [0, 0, amount],
  ]
}

export function rotate(angle: number): Matrix {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ]
}

export function rotateDepth(angle: number): Matrix {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ]
}

function affine(matrix: Matrix, offset: Point): Affine {
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

/** Rotated component frame; inverse uses its true authored axis scales. */
export function frame(
  centre: Point,
  sizes: Point,
  lean = 0,
  horizontal = false,
): Frame {
  const permutation: Matrix = horizontal
    ? [
        [1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
      ]
    : IDENTITY
  const axes = mul(rotate(lean), permutation)
  const matrix = mul(
    [
      [sizes[0], 0, 0],
      [0, sizes[1], 0],
      [0, 0, sizes[2]],
    ],
    axes,
  )
  const inverse = mul(
    axes[0].map((_, n) => axes.map((row) => row[n]!)) as unknown as Matrix,
    [
      [1 / sizes[0], 0, 0],
      [0, 1 / sizes[1], 0],
      [0, 0, 1 / sizes[2]],
    ],
  )
  return { centre, matrix, inverse }
}

export function createBuilder(study: FlameFigurine, side: PawnSide) {
  const transforms: Record<string, Transform> = {}
  let count = 0
  const addMap = (
    group: string,
    component: Frame,
    map: LocalMap,
    hue: number,
  ) => {
    const pre = mul(map.pre, component.inverse)
    const post = mul(component.matrix, map.post)
    const colour = COLOURS[study.id][hue]!
    transforms[`${group}_${count++}`] = {
      walkGroup: group,
      visible: true,
      probability: map.mass,
      preAffine: affine(
        pre,
        add(map.shift, negative(act(pre, component.centre))),
      ),
      postAffine: affine(
        post,
        add(component.centre, act(component.matrix, map.offset)),
      ),
      color: {
        x: side === 'light' ? colour[0] : -colour[0],
        y: side === 'light' ? colour[1] : -colour[1],
      },
      colorSpeed: 0.85,
      variations: Object.fromEntries(
        map.mix.map(([type, weight], n) => [
          `flow_${n}` as VariationId,
          { type, weight, visible: true },
        ]),
      ),
    }
  }
  const finish = (): FlameDescriptor =>
    validateFlame({
      version: latestSchemaVersion,
      metadata: {
        name: `${study.name}${side === 'dark' ? ' alternate' : ''}`,
        author: 'Lumen Apeiron',
        description: study.description,
      },
      renderSettings: {
        ...renderSettingsDefault,
        dimensions: 3,
        pointInitMode: 'pointInitUnitBall',
        drawMode: 'light',
        colorInitMode: 'colorInitZero',
        skipIters: 48,
        exposure: study.id === 'aurora-queen' ? -0.85 : -0.55,
        contrast: 1.15,
        vibrancy: 1.25,
        lightPower: 0,
        highlightPower: 0.06,
        depthColorPower: 0,
        densityEstimationQuality: 1,
        estimatorCurve: 0.5,
        backgroundColor: [0.006, 0.009, 0.018],
        paletteMode: 0,
        camera3D: {
          theta: study.id === 'tidal-knight' ? 0.2 : 0.45,
          phi: 1.32,
          radius: 4,
          target: [0, 0.92, 0],
          fov: 45,
          roll: 0,
        },
      },
      transforms,
    })
  return { addMap, finish }
}
