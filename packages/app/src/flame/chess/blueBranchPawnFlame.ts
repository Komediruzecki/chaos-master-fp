/**
 * A glass-sized pawn core grown by three anatomical families of affine branch IFSs.
 * Rotated recursive tree maps preserve a ball for the crown, dyadic affine
 * recurrences trace three bowed stalks, and spatial fern maps articulate roots. Gaps are
 * part of the attractors, rather than a blurred envelope or cloned chess pieces.
 * The contractive-IFS invariant-set construction follows Hutchinson (1981),
 * https://maths-people.anu.edu.au/~john/Assets/Research%20Papers/fractals_self-similarity.pdf
 * These spatial branch maps are authored here, rather than the planar fern's maps.
 */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import { normalizePawnRecipe } from './pawnFlame'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'
import type { PawnRecipe, PawnSide } from './pawnFlame'

export const DEFAULT_BLUE_BRANCH_PAWN_RECIPE: Readonly<PawnRecipe> =
  Object.freeze({
    branchCount: 5,
    openness: 0.65,
    twist: 0.28,
    side: 'light',
  })

/** Fixed-lightness structural point colour for the board and portable GLBs. */
export const BLUE_BRANCH_PAWN_POINT_LIGHTNESS = 0.65

export const BLUE_BRANCH_PAWN_BOUNDS = Object.freeze({
  shaftFoot: 0.2,
  shaftTip: 1.145,
  shaftRadius: 0.13,
  headCentre: 1.455,
  headRadius: 0.31,
  footRadius: 0.55,
  footHeight: 0.2,
})

type Point = readonly [number, number, number]
type Map = FlameDescriptor3D['transforms'][TransformId]
type Affine = Map['postAffine']
type Colour = Map['color']
type Matrix = readonly [Point, Point, Point]
export type BlueBranchFrondFrame = {
  group: string
  origin: Point
  scales: Point
  lean: number
  yaw: number
}
/** Rotated bowed-stalk boxes share both exact endpoints at the foot and crown. */
export function blueBranchStalkFrames(twist: number): BlueBranchFrondFrame[] {
  return Array.from({ length: 3 }, (_, n) => ({
    group: `blue_stalk_${n}`,
    origin: [0, BLUE_BRANCH_PAWN_BOUNDS.shaftFoot, 0],
    scales: [
      BLUE_BRANCH_PAWN_BOUNDS.shaftRadius,
      BLUE_BRANCH_PAWN_BOUNDS.shaftTip - BLUE_BRANCH_PAWN_BOUNDS.shaftFoot,
      BLUE_BRANCH_PAWN_BOUNDS.shaftRadius,
    ],
    lean: 0,
    yaw: (n * 2 * Math.PI) / 3 + twist,
  }))
}

export function blueBranchRootFrames(twist: number): BlueBranchFrondFrame[] {
  return Array.from({ length: 4 }, (_, n) => ({
    group: `blue_root_frond_${n}`,
    origin: [0, 0.11, 0],
    scales: [[0.1, 0.09, 0.095, 0.1][n]!, [0.49, 0.41, 0.46, 0.5][n]!, 0.12],
    lean: [1.5, 1.48, 1.6, 1.48][n]!,
    yaw: (n * Math.PI) / 2 + [0.2, -0.1, 0.13, -0.25][n]! - twist,
  }))
}
const LINEAR = 'linear' as VariationId
const IDENTITY: Affine = {
  a: 1,
  b: 0,
  c: 0,
  d: 0,
  e: 0,
  f: 1,
  g: 0,
  h: 0,
  i: 0,
  j: 0,
  k: 1,
  l: 0,
}

/**
 * R sends the local Y axis along a branch. A=R diag(t,r,t), b=j eY+r R eY
 * preserves the ball when |t|<=r and |j|+2r<=1. The lower endpoint maps to
 * junction j eY on the axial subsystem; the upper endpoint maps to the tip.
 * A diagonal frame conjugation preserves the same local contraction metric.
 */
function treeMap(
  centre: Point,
  scales: Point,
  polar: number,
  yaw: number,
  transverse: number,
  roll = 0,
  down = false,
  long = 0.5,
  junction = 0,
): Affine {
  const st = Math.sin(polar),
    ct = Math.cos(polar)
  const ca = Math.cos(yaw),
    sa = Math.sin(yaw)
  const u: Point = [ct * ca, -st, ct * sa]
  const v: Point = [st * ca, ct, st * sa]
  const w: Point = [-sa, 0, ca]
  const cr = Math.cos(roll),
    sr = Math.sin(roll)
  const columns = [
    u.map((value, n) => transverse * (cr * value + sr * w[n]!)),
    v.map((value) => long * value),
    w.map((value, n) => transverse * (cr * value - sr * u[n]!)),
  ]
  const rows = [0, 1, 2].map((row) =>
    columns.map((column, n) => (scales[row]! * column[row]!) / scales[n]!),
  )
  const offset = [0, 1, 2].map(
    (row) =>
      centre[row]! +
      scales[row]! *
        ((down ? -long : long) * v[row]! + (row === 1 ? junction : 0)) -
      rows[row]!.reduce((sum, value, n) => sum + value * centre[n]!, 0),
  )
  return {
    a: rows[0]![0]!,
    b: rows[0]![1]!,
    c: rows[0]![2]!,
    d: offset[0]!,
    e: rows[1]![0]!,
    f: rows[1]![1]!,
    g: rows[1]![2]!,
    h: offset[1]!,
    i: rows[2]![0]!,
    j: rows[2]![1]!,
    k: rows[2]![2]!,
    l: offset[2]!,
  }
}

/** Bounded 3D fern: x in [-1,1], y in [0,1], z in [-.3,.3]. */
const FERN_MAPS: readonly {
  name: string
  matrix: Matrix
  shift: Point
  probability: number
}[] = [
  {
    name: 'stem',
    matrix: [
      [0.015, 0, 0],
      [0, 0.2, 0],
      [0, 0, 0.05],
    ],
    shift: [0, 0, 0],
    probability: 0.035,
  },
  {
    name: 'continuation',
    matrix: [
      [0.84, 0, 0.09],
      [0, 0.84, 0],
      [-0.06, 0, 0.78],
    ],
    shift: [0, 0.16, 0],
    probability: 0.675,
  },
  {
    name: 'left',
    matrix: [
      [0.22, -0.55, 0],
      [0.15, 0.27, 0],
      [0.1, 0.06, 0.25],
    ],
    shift: [0, 0.2, 0],
    probability: 0.145,
  },
  {
    name: 'right',
    matrix: [
      [-0.23, 0.58, 0],
      [0.14, 0.28, 0],
      [-0.11, 0.06, 0.25],
    ],
    shift: [0, 0.17, 0],
    probability: 0.145,
  },
]

/** F A F^-1, F(p)=origin+R diag(scales)p; conjugates the whole recurrence. */
function fernMap(frame: BlueBranchFrondFrame, a: Matrix, shift: Point): Affine {
  const c = Math.cos(frame.lean),
    s = Math.sin(frame.lean)
  const cy = Math.cos(frame.yaw),
    sy = Math.sin(frame.yaw)
  const basis: Point[] = [
    [c * cy, -s, c * sy],
    [s * cy, c, s * sy],
    [-sy, 0, cy],
  ]
  const rows = [0, 1, 2].map((r) =>
    [0, 1, 2].map((column) => {
      let value = 0
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          value +=
            (basis[j]![r]! *
              frame.scales[j]! *
              a[j]![k]! *
              basis[k]![column]!) /
            frame.scales[k]!
      return value
    }),
  )
  const offset = [0, 1, 2].map(
    (r) =>
      frame.origin[r]! +
      basis.reduce(
        (sum, axis, n) => sum + axis[r]! * frame.scales[n]! * shift[n]!,
        0,
      ) -
      rows[r]!.reduce((sum, value, n) => sum + value * frame.origin[n]!, 0),
  )
  return {
    a: rows[0]![0]!,
    b: rows[0]![1]!,
    c: rows[0]![2]!,
    d: offset[0]!,
    e: rows[1]![0]!,
    f: rows[1]![1]!,
    g: rows[1]![2]!,
    h: offset[1]!,
    i: rows[2]![0]!,
    j: rows[2]![1]!,
    k: rows[2]![2]!,
    l: offset[2]!,
  }
}

/** Exact 3D bowed curve, retained as a subset of each recursive branch stalk. */
export function blueBranchBackbonePoint(t: number): Point {
  return [2.6 * t * (1 - t), t, 1.5 * t * (1 - t) * (2 * t - 1)]
}

function branchColours(side: PawnSide): {
  blue: Colour
  cyan: Colour
  amber: Colour
} {
  return {
    blue: side === 'light' ? { x: 0.02, y: -0.22 } : { x: 0.13, y: 0.1 },
    cyan: side === 'light' ? { x: -0.1, y: -0.085 } : { x: 0.105, y: 0.14 },
    amber: side === 'light' ? { x: 0.085, y: 0.11 } : { x: -0.045, y: -0.1 },
  }
}

/**
 * Side changes colours; branchCount sets dyadic fork count per stalk, openness
 * narrows fine fork cross-sections, and twist rotates the common branch frames.
 * Attractors are point sets: positive-thickness material bonds are not claimed.
 */
export function buildBlueBranchPawnFlame(
  input: PawnSide | Partial<PawnRecipe> = {},
): FlameDescriptor {
  const raw = typeof input === 'string' ? { side: input } : input
  const finite = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? value : fallback
  const recipe = normalizePawnRecipe({
    ...DEFAULT_BLUE_BRANCH_PAWN_RECIPE,
    ...raw,
    branchCount: finite(
      raw.branchCount,
      DEFAULT_BLUE_BRANCH_PAWN_RECIPE.branchCount,
    ),
    openness: finite(raw.openness, DEFAULT_BLUE_BRANCH_PAWN_RECIPE.openness),
    twist: finite(raw.twist, DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist),
  })
  const transforms: Record<string, Map> = {}
  const { blue, cyan, amber } = branchColours(recipe.side)
  const add = (
    id: string,
    group: string,
    affine: Affine,
    probability: number,
    colour: Colour,
    speed = 0.62,
  ) => {
    transforms[id] = {
      walkGroup: group,
      probability,
      preAffine: { ...IDENTITY },
      postAffine: affine,
      color: { ...colour },
      colorSpeed: speed,
      visible: true,
      variations: { [LINEAR]: { type: 'linear3D', weight: 1, visible: true } },
    }
  }
  const { footRadius, footHeight } = BLUE_BRANCH_PAWN_BOUNDS
  const head: Point = [0, BLUE_BRANCH_PAWN_BOUNDS.headCentre, 0]
  const ball: Point = [
    BLUE_BRANCH_PAWN_BOUNDS.headRadius,
    BLUE_BRANCH_PAWN_BOUNDS.headRadius,
    BLUE_BRANCH_PAWN_BOUNDS.headRadius,
  ]
  add(
    'blue_head_lower_axis',
    'blue_head',
    treeMap(head, ball, 0, 0, 0.1, 0, true),
    0.44 * 0.28,
    blue,
  )
  add(
    'blue_head_upper_axis',
    'blue_head',
    treeMap(head, ball, 0, 0, 0.1),
    0.44 * 0.18,
    blue,
  )
  const crown = [
    { r: 0.475, j: -0.04, polar: 1.35, yaw: 0.1, roll: 0.18, mass: 0.16 },
    {
      r: 0.46,
      j: -0.07,
      polar: 1.28,
      yaw: Math.PI + 0.18,
      roll: -0.3,
      mass: 0.16,
    },
    { r: 0.39, j: 0.2, polar: 0.22, yaw: -0.2, roll: 0.25, mass: 0.12 },
    {
      r: 0.36,
      j: -0.25,
      polar: 1.1,
      yaw: Math.PI / 2 + 0.32,
      roll: 0.33,
      mass: 0.05,
    },
    {
      r: 0.35,
      j: 0.1,
      polar: 1.8,
      yaw: -Math.PI / 2 - 0.1,
      roll: -0.5,
      mass: 0.05,
    },
  ]
  for (const [n, branch] of crown.entries()) {
    add(
      `blue_head_branch_${n}`,
      'blue_head',
      treeMap(
        head,
        ball,
        branch.polar,
        branch.yaw + recipe.twist,
        branch.r,
        branch.roll + recipe.twist * 0.25,
        false,
        branch.r,
        branch.j,
      ),
      0.44 * branch.mass,
      n === 4 ? amber : cyan,
      n === 4 ? 0.85 : 0.68,
    )
  }

  const a = 2.6,
    b = 1.5,
    bend = (0.375 * b) / a
  for (const [n, frame] of blueBranchStalkFrames(recipe.twist).entries()) {
    // f0(P(t))=P(t/2), f1(P(t))=P((t+1)/2), with no CPU curve scaffold.
    add(
      `${frame.group}_lower_curve`,
      frame.group,
      fernMap(
        frame,
        [
          [0.25, a / 4, 0],
          [0, 0.5, 0],
          [-bend, 0, 0.125],
        ],
        [0, 0, 0],
      ),
      (0.36 / 3) * 0.32,
      blue,
      0.76,
    )
    add(
      `${frame.group}_upper_curve`,
      frame.group,
      fernMap(
        frame,
        [
          [0.25, -a / 4, 0],
          [0, 0.5, 0],
          [bend, 0, 0.125],
        ],
        [a / 4, 0.5, 0],
      ),
      (0.36 / 3) * 0.32,
      n === 1 ? cyan : blue,
      0.76,
    )
    const nodes = [0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875, 0.4375]
    for (let fork = 0; fork < recipe.branchCount; fork++) {
      const t = nodes[fork]!
      const fineScale = 1.1 - 0.25 * recipe.openness
      const q = (fork === 1 ? 0.1 : 0.16) * fineScale
      const slope = fork === 1 ? -0.64 : -0.46
      const anchor = blueBranchBackbonePoint(t)
      const depth = (anchor[2] > 0 ? -1 : 1) * (fork === 1 ? 0.36 : 0.34)
      add(
        `${frame.group}_fork_${fork}`,
        frame.group,
        fernMap(
          frame,
          [
            [q, slope, 0],
            [0, Math.min(0.24, 0.99 - t), 0],
            [0, depth, 0.18 * fineScale],
          ],
          anchor,
        ),
        ((0.36 / 3) * 0.36) / recipe.branchCount,
        n === 2 && fork === 1 ? amber : cyan,
        0.8,
      )
    }
  }

  const foot: Point = [0, footHeight / 2, 0]
  const roots: Point = [footRadius, footHeight / 2, footRadius]
  add(
    'blue_roots_lower_axis',
    'blue_root_spine',
    treeMap(foot, roots, 0, 0, 0.12, 0, true),
    0.2 * 0.03,
    blue,
  )
  add(
    'blue_roots_upper_axis',
    'blue_root_spine',
    treeMap(foot, roots, 0, 0, 0.12),
    0.2 * 0.03,
    blue,
  )
  for (const frame of blueBranchRootFrames(recipe.twist))
    for (const map of FERN_MAPS)
      add(
        `${frame.group}_${map.name}`,
        frame.group,
        fernMap(frame, map.matrix, map.shift),
        ((0.2 * 0.94) / 4) * map.probability,
        map.name === 'left' || map.name === 'right' ? cyan : blue,
        0.74,
      )

  return validateFlame({
    version: latestSchemaVersion,
    metadata: {
      name: `${recipe.side === 'light' ? 'Frost' : 'Ember'} branching pawn`,
      author: 'Lumen Apeiron',
      description:
        'A hollow glass-sized core of a round recursively branching tree, three bowed affine-IFS stalks with dyadic forks, and sparse spatial fern roots. Native affine IFS with independently bounded components.',
    },
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      pointInitMode: 'pointInitUnitBall',
      colorInitMode: 'colorInitZero',
      drawMode: 'light',
      skipIters: 40,
      exposure: -1.1,
      vibrancy: 1.0,
      contrast: 0.95,
      lightPower: 0,
      highlightPower: 0,
      depthColorPower: 0,
      densityEstimationQuality: 1,
      estimatorCurve: 0.5,
      backgroundColor: [0.006, 0.009, 0.021],
      camera3D: {
        theta: 0.35,
        phi: 1.42,
        radius: 3.5,
        target: [0, 0.88, 0],
        fov: 45,
        roll: 0,
      },
    },
    transforms,
  })
}
