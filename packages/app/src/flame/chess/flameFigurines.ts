/**
 * Experimental chess flames: nonlinear recurrences grow woven stems, curled
 * crowns, split flame heads and flowing fins. Every part is a native chaos
 * game in its own coordinate frame, never a clone of the complete figurine.
 * These coloured point attractors describe shape, not solid physical material.
 */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'
import type { PawnSide } from './pawnFlame'

export type FlameFigurineId = 'aurora-queen' | 'ember-bishop' | 'tidal-knight'
export type FlameFigurine = {
  id: FlameFigurineId
  name: string
  piece: 'queen' | 'bishop' | 'knight'
  family: string
  description: string
  fractureHint: string
}

export const FLAME_FIGURINES: readonly FlameFigurine[] = Object.freeze([
  {
    id: 'aurora-queen',
    name: 'Aurora queen',
    piece: 'queen',
    family: 'Woven sinusoidal flame and curled corolla',
    description:
      'Indigo coral roots support two turquoise woven currents and a gold crown of curled flame petals.',
    fractureHint:
      'A future fracture could unravel the woven stem into strands, then peel apart the curled crown.',
  },
  {
    id: 'ember-bishop',
    name: 'Ember bishop',
    piece: 'bishop',
    family: 'Barnsley fern mantle and split curl flame',
    description:
      'A plum rosette carries an orange fern of repeated branching fronds and a split gold flame mitre.',
    fractureHint:
      'A future fracture could separate the fern at branch junctions and divide the curled mitre along its cleft.',
  },
  {
    id: 'tidal-knight',
    name: 'Tidal knight',
    piece: 'knight',
    family: 'Swirling current and curl-grown fins',
    description:
      'Cyan roots rise into a deep blue flowing neck, with violet fins and a curled horse head reaching forward.',
    fractureHint:
      'A future fracture could strip the fins into ribbons before the neck separates into shorter currents.',
  },
])

type Point = readonly [number, number, number]
type Matrix = readonly [Point, Point, Point]
type Transform = FlameDescriptor3D['transforms'][TransformId]
type Affine = Transform['preAffine']
type Kind = 'linear3D' | 'sinusoidal3D' | 'swirl3D' | 'curl3D'
type Mix = readonly (readonly [Kind, number])[]
type Frame = { centre: Point; matrix: Matrix; inverse: Matrix }
type LocalMap = {
  pre: Matrix
  shift: Point
  post: Matrix
  offset: Point
  mix: Mix
  mass: number
}
type Builder = ReturnType<typeof createBuilder>

const IDENTITY: Matrix = [
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

function mul(a: Matrix, b: Matrix): Matrix {
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

function scale(amount: number): Matrix {
  return [
    [amount, 0, 0],
    [0, amount, 0],
    [0, 0, amount],
  ]
}

function rotate(angle: number): Matrix {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ]
}

function rotateDepth(angle: number): Matrix {
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
function frame(
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

function createBuilder(study: FlameFigurine, side: PawnSide) {
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

/** Warped radial recurrence, not a polygon/cube gasket. */
function roots(
  b: Builder,
  group: string,
  f: Frame,
  mass: number,
  hue: number,
  lobes: number,
  phase: number,
) {
  for (let n = 0; n < lobes; n++) {
    const angle = (n / lobes) * 2 * Math.PI + phase
    b.addMap(
      group,
      f,
      {
        pre: mul(
          scale(0.83),
          mul(rotate(angle * 0.17), rotateDepth(0.18 * Math.sin(angle))),
        ),
        shift: [0.14 * Math.cos(angle), 0.14 * Math.sin(angle), 0.08],
        post: mul(scale(0.7), rotate(angle)),
        offset: [
          0.28 * Math.cos(angle),
          0.28 * Math.sin(angle),
          0.06 * Math.sin(3 * angle),
        ],
        mix: [
          ['sinusoidal3D', 0.42],
          ['swirl3D', 0.4],
          ['linear3D', 0.18],
        ],
        mass: (mass * 0.94) / lobes,
      },
      hue,
    )
  }
  // Exact lower limiting point in the local ball of radius two grounds the roots.
  b.addMap(
    group,
    f,
    {
      pre: IDENTITY,
      shift: [0, 0, 0],
      post: scale(0.45),
      offset: [0, 0, -1.1],
      mix: [['linear3D', 1]],
      mass: mass * 0.06,
    },
    hue,
  )
}

/** Long nonlinear streams grow several curved branches within one local game. */
function stream(
  b: Builder,
  group: string,
  f: Frame,
  mass: number,
  hue: number,
  bend: number,
  style: 'current' | 'curl' | 'weave' = 'current',
) {
  const offsets: Point[] = [
    [-0.22, -0.54, -0.16],
    [0.22, 0.54, 0.16],
    [-0.31, 0.03, 0.25],
    [0.31, -0.03, -0.25],
    [0.08, -0.26, 0.34],
    [-0.08, 0.26, -0.34],
  ]
  for (const [n, offset] of offsets.entries()) {
    b.addMap(
      group,
      f,
      {
        pre: mul(
          scale(style === 'weave' ? 0.86 : 0.8),
          mul(
            rotate(bend + (n - 2.5) * 0.08),
            rotateDepth(
              (n % 2 === 0 ? -1 : 1) * (style === 'weave' ? 0.12 : 0.32),
            ),
          ),
        ),
        shift: [0.14, -0.08, 0.1],
        post: mul(
          scale(style === 'weave' ? 0.69 : 0.76),
          mul(rotate(-bend * 0.45), rotateDepth((n % 2 === 0 ? 1 : -1) * 0.18)),
        ),
        offset,
        mix:
          style === 'weave'
            ? [
                ['swirl3D', 0.5],
                ['sinusoidal3D', 0.45],
                ['linear3D', 0.05],
              ]
            : style === 'curl'
              ? [
                  ['curl3D', 0.2],
                  ['swirl3D', 0.45],
                  ['sinusoidal3D', 0.15],
                  ['linear3D', 0.2],
                ]
              : [
                  ['swirl3D', 0.42],
                  ['sinusoidal3D', 0.28],
                  ['linear3D', 0.3],
                ],
        mass: mass / offsets.length,
      },
      hue,
    )
  }
}

function aurora(b: Builder) {
  roots(
    b,
    'aurora_roots',
    frame([0, 0.12, 0], [0.64, 0.06, 0.64], 0, true),
    0.2,
    0,
    7,
    0.18,
  )
  stream(
    b,
    'aurora_weave_left',
    frame([-0.065, 0.77, 0], [0.23, 0.59, 0.21], -0.16),
    0.22,
    1,
    0.34,
    'weave',
  )
  stream(
    b,
    'aurora_weave_right',
    frame([0.065, 0.77, 0], [0.23, 0.59, 0.21], 0.16),
    0.22,
    1,
    -0.34,
    'weave',
  )
  for (let n = 0; n < 5; n++) {
    const angle = (n / 5) * 2 * Math.PI
    b.addMap(
      'aurora_corolla',
      frame([0, 1.25, 0], [0.36, 0.28, 0.34]),
      {
        pre: mul(
          scale(0.78),
          mul(rotate(angle * 0.25), rotateDepth(angle * 0.25)),
        ),
        shift: [-0.42, 0.12, 0.1],
        post: mul(
          scale(0.54),
          mul(rotate(angle - Math.PI / 2), rotateDepth(angle * 0.2)),
        ),
        offset: [
          0.5 * Math.cos(angle),
          0.48 + 0.12 * Math.sin(angle),
          0.42 * Math.sin(angle),
        ],
        mix: [
          ['curl3D', 0.4],
          ['swirl3D', 0.3],
          ['sinusoidal3D', 0.1],
          ['linear3D', 0.2],
        ],
        mass: 0.3 / 5,
      },
      2,
    )
  }
  stream(
    b,
    'aurora_crest',
    frame([0, 1.69, 0], [0.065, 0.16, 0.065]),
    0.06,
    2,
    0.28,
    'curl',
  )
}

function ember(b: Builder) {
  roots(
    b,
    'ember_roots',
    frame([0, 0.12, 0], [0.6, 0.06, 0.6], 0, true),
    0.18,
    0,
    5,
    0.36,
  )
  // Barnsley's fern conjugated from x/2.5, y/5-1, then grown in a 3D frame.
  // Each side frond recursively contains smaller opposed fronds. Depth shear
  // separates them in Z; a small sinusoidal warp bends the affine skeleton.
  const fern: { matrix: Matrix; offset: Point; probability: number }[] = [
    {
      matrix: [
        [0, 0, 0],
        [0, 0.16, 0],
        [0, 0, 0.2],
      ],
      offset: [0, -0.84, 0],
      probability: 0.01,
    },
    {
      matrix: [
        [0.85, 0.08, 0],
        [-0.02, 0.85, 0],
        [0.04, 0.04, 0.6],
      ],
      offset: [0.08, 0.17, 0],
      probability: 0.85,
    },
    {
      matrix: [
        [0.2, -0.52, 0],
        [0.115, 0.22, 0],
        [0.12, 0.1, 0.4],
      ],
      offset: [-0.52, -0.46, 0.12],
      probability: 0.07,
    },
    {
      matrix: [
        [-0.15, 0.56, 0],
        [0.13, 0.24, 0],
        [-0.12, 0.1, 0.4],
      ],
      offset: [0.56, -0.672, -0.12],
      probability: 0.07,
    },
  ]
  for (const map of fern)
    b.addMap(
      'ember_mantle',
      frame([0, 0.74, 0], [0.34, 0.65, 0.3]),
      {
        pre: map.matrix,
        shift: map.offset,
        post: IDENTITY,
        offset: [0, 0, 0],
        mix: [
          ['linear3D', 0.94],
          ['sinusoidal3D', 0.06],
        ],
        mass: 0.36 * map.probability,
      },
      1,
    )
  roots(
    b,
    'ember_orbit',
    frame([0, 1.08, 0], [0.28, 0.025, 0.28], 0, true),
    0.08,
    1,
    9,
    0,
  )
  stream(
    b,
    'ember_mitre_left',
    frame([-0.13, 1.39, 0], [0.21, 0.4, 0.23], -0.4),
    0.19,
    2,
    0.56,
    'curl',
  )
  stream(
    b,
    'ember_mitre_right',
    frame([0.13, 1.39, 0], [0.21, 0.4, 0.23], 0.4),
    0.19,
    2,
    -0.56,
  )
}

function tidal(b: Builder) {
  roots(
    b,
    'tidal_roots',
    frame([0, 0.12, 0], [0.62, 0.06, 0.62], 0, true),
    0.17,
    0,
    8,
    -0.1,
  )
  stream(
    b,
    'tidal_current',
    frame([-0.04, 0.78, 0], [0.37, 0.64, 0.33], 0.28),
    0.31,
    1,
    -0.5,
  )
  stream(
    b,
    'tidal_mane',
    frame([-0.16, 1.08, -0.015], [0.27, 0.42, 0.33], -0.32),
    0.15,
    2,
    0.72,
    'curl',
  )
  stream(
    b,
    'tidal_head',
    frame([0.2, 1.37, 0], [0.34, 0.29, 0.27], -0.45),
    0.2,
    0,
    0.28,
    'curl',
  )
  stream(
    b,
    'tidal_muzzle',
    frame([0.42, 1.28, 0], [0.29, 0.18, 0.24], -0.2),
    0.09,
    0,
    -0.34,
    'curl',
  )
  stream(
    b,
    'tidal_fin_back',
    frame([0.035, 1.68, -0.11], [0.065, 0.18, 0.07], -0.3),
    0.04,
    2,
    0.4,
  )
  stream(
    b,
    'tidal_fin_front',
    frame([0.11, 1.67, 0.11], [0.065, 0.18, 0.07], 0.1),
    0.04,
    2,
    -0.4,
    'curl',
  )
}

/** Independent fresh native flame; side changes hues without changing the form. */
export function buildFlameFigurine(
  id: FlameFigurineId,
  side: PawnSide = 'light',
): FlameDescriptor {
  const study = FLAME_FIGURINES.find((entry) => entry.id === id)
  if (!study) throw new Error(`Unknown flame figurine: ${id}`)
  const b = createBuilder(study, side)
  if (id === 'aurora-queen') aurora(b)
  else if (id === 'ember-bishop') ember(b)
  else tidal(b)
  return b.finish()
}
