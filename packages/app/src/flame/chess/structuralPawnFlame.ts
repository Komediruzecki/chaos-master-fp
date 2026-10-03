/**
 * A pawn made from structural fractals: twenty Sierpinski tetrahedral facets
 * form an icosahedral head, a Menger plate forms the foot, a Cantor lattice
 * forms the collar, and a cone-invariant branch IFS forms the tapering shaft.
 * Each local component has its own fixed walker group, so no map can turn the
 * entire pawn into repeated miniature pieces. Every variation is linear3D.
 */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import { normalizePawnRecipe, PAWN_BASE_RADIUS, PAWN_HEIGHT } from './pawnFlame'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'
import type { PawnRecipe } from './pawnFlame'

export const DEFAULT_STRUCTURAL_PAWN_RECIPE: Readonly<PawnRecipe> =
  Object.freeze({
    branchCount: 6,
    openness: 0.55,
    twist: 0.18,
    side: 'light',
  })

export const STRUCTURAL_PAWN_GROUPS = Object.freeze({
  foot: 'foot',
  shaft: 'shaft',
  collar: 'collar',
  headPrefix: 'head_',
})

type Point = readonly [number, number, number]
type StructuralTransform = FlameDescriptor3D['transforms'][TransformId] & {
  walkGroup: string
}
type Affine3 = StructuralTransform['postAffine']

const LINEAR = 'linear' as VariationId
const IDENTITY: Affine3 = {
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
const HEAD_RADIUS = 0.34
const HEAD_CENTRE = PAWN_HEIGHT - HEAD_RADIUS
const SHAFT_FOOT = 0.22
const SHAFT_HEIGHT = 0.96
const SHAFT_RADIUS = 0.3

/** Faces of the twelve golden-ratio vertices below, checked by supporting planes. */
const ICOSA_FACES = [
  [0, 1, 2],
  [0, 1, 7],
  [0, 2, 6],
  [0, 6, 8],
  [0, 7, 8],
  [1, 2, 5],
  [1, 3, 5],
  [1, 3, 7],
  [2, 4, 5],
  [2, 4, 6],
  [3, 5, 9],
  [3, 7, 11],
  [3, 9, 11],
  [4, 5, 9],
  [4, 6, 10],
  [4, 9, 10],
  [6, 8, 10],
  [7, 8, 11],
  [8, 10, 11],
  [9, 10, 11],
] as const

function icosaVertices(yaw: number): Point[] {
  const phi = (1 + Math.sqrt(5)) / 2
  const radius = Math.hypot(1, phi)
  const vertices: Point[] = []
  // Rotate one vertex onto the vertical pole, preserving the 1.8-unit height.
  const poleCos = 1 / radius
  const poleSin = phi / radius
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const [x, y, z] of [
        [0, a, b * phi],
        [a, b * phi, 0],
        [a * phi, 0, b],
      ]) {
        const yy = poleCos * y! + poleSin * z!
        const zz = -poleSin * y! + poleCos * z!
        vertices.push([
          ((cy * x! + sy * zz) / radius) * HEAD_RADIUS,
          HEAD_CENTRE + (yy / radius) * HEAD_RADIUS,
          ((-sy * x! + cy * zz) / radius) * HEAD_RADIUS,
        ])
      }
    }
  }
  return vertices
}

/** A local corner contraction, expressed directly in the component's world frame. */
function toward(point: Point, scale: number): Affine3 {
  return {
    ...IDENTITY,
    a: scale,
    f: scale,
    k: scale,
    d: (1 - scale) * point[0],
    h: (1 - scale) * point[1],
    l: (1 - scale) * point[2],
  }
}

/**
 * The local cone is 0<=y<=1, hypot(x,z)<=1-y. These branch maps keep it
 * invariant, then the frame puts its broad foot at .22 and its tip at 1.18.
 * Yaw rotates every recursive step, including the trunk, within that cone.
 */
function shaftMap(
  c: number,
  spread: number,
  rise: number,
  lift: number,
  yaw: number,
): Affine3 {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const shear = (SHAFT_RADIUS * spread) / SHAFT_HEIGHT
  const offset = SHAFT_RADIUS * spread * (1 + SHAFT_FOOT / SHAFT_HEIGHT)
  return {
    a: c * cy,
    b: shear === 0 ? 0 : -shear * cy,
    c: c * sy,
    d: offset === 0 ? 0 : offset * cy,
    e: 0,
    f: rise,
    g: 0,
    h: SHAFT_FOOT * (1 - rise) + SHAFT_HEIGHT * lift,
    i: -c * sy,
    j: shear === 0 ? 0 : shear * sy,
    k: c * cy,
    l: offset === 0 ? 0 : -offset * sy,
  }
}

/** A fresh native 3D flame with 23 independent local groups and at most 126 maps. */
export function buildStructuralPawnFlame(
  input: Partial<PawnRecipe> = {},
): FlameDescriptor {
  const recipe = normalizePawnRecipe({
    ...DEFAULT_STRUCTURAL_PAWN_RECIPE,
    ...input,
  })
  const transforms: Record<string, StructuralTransform> = {}
  const colour =
    recipe.side === 'light' ? { x: -0.025, y: -0.065 } : { x: 0.105, y: 0.095 }
  const add = (
    id: string,
    group: string,
    affine: Affine3,
    probability: number,
  ) => {
    transforms[id] = {
      walkGroup: group,
      probability,
      preAffine: { ...IDENTITY },
      postAffine: affine,
      color: { ...colour },
      colorSpeed: 0.4,
      visible: true,
      variations: { [LINEAR]: { type: 'linear3D', weight: 1, visible: true } },
    }
  }

  // Each tetrahedron recurs on its four own vertices; the shared outer faces
  // remain faceted while the deleted central cells recur at every scale.
  const head = icosaVertices(recipe.twist)
  const headScale = 0.5 - 0.035 * recipe.openness
  for (const [face, indices] of ICOSA_FACES.entries()) {
    const group = `${STRUCTURAL_PAWN_GROUPS.headPrefix}${String(face).padStart(2, '0')}`
    const vertices: Point[] = [
      [0, HEAD_CENTRE, 0],
      ...indices.map((n) => head[n]!),
    ]
    for (const [n, vertex] of vertices.entries())
      add(`crystal_${group}_${n}`, group, toward(vertex, headScale), 0.4 / 80)
  }

  // Menger's twenty retained third-cubes: omit the centre and six face centres.
  const halfWidth = PAWN_BASE_RADIUS / Math.sqrt(2)
  const footScale = 1 / 3 - 0.02 * recipe.openness
  let footIndex = 0
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if ([x, y, z].filter((v) => v === 0).length >= 2) continue
        add(
          `crystal_foot_${footIndex++}`,
          STRUCTURAL_PAWN_GROUPS.foot,
          toward([x * halfWidth, 0.11 + y * 0.11, z * halfWidth], footScale),
          0.24 / 20,
        )
      }
    }
  }

  // Eight corner cubes make a porous three-dimensional flange, not a flat decal.
  const collarScale = 0.45 - 0.04 * recipe.openness
  const collarWidth = 0.23 / Math.sqrt(2)
  let collarIndex = 0
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        add(
          `crystal_collar_${collarIndex++}`,
          STRUCTURAL_PAWN_GROUPS.collar,
          toward(
            [x * collarWidth, 1.105 + y * 0.055, z * collarWidth],
            collarScale,
          ),
          0.06 / 8,
        )
      }

  const shaft = STRUCTURAL_PAWN_GROUPS.shaft
  add(
    'crystal_shaft_trunk',
    shaft,
    shaftMap(0.62 - 0.04 * recipe.openness, 0, 0.68, 0.32, recipe.twist),
    0.3 * 0.42,
  )
  add(
    'crystal_shaft_heel',
    shaft,
    shaftMap(0.58 - 0.06 * recipe.openness, 0, 0.12, 0, -recipe.twist),
    0.3 * 0.1,
  )
  for (let n = 0; n < recipe.branchCount; n++) {
    const yaw = (n / recipe.branchCount) * 2 * Math.PI
    add(
      `crystal_shaft_branch_${n}`,
      shaft,
      shaftMap(
        0.34 - 0.07 * recipe.openness,
        0.27 + 0.08 * recipe.openness,
        0.55,
        0.1,
        yaw + recipe.twist,
      ),
      (0.3 * 0.3) / recipe.branchCount,
    )
    add(
      `crystal_shaft_twig_${n}`,
      shaft,
      shaftMap(
        0.3 - 0.05 * recipe.openness,
        0.17 + 0.08 * recipe.openness,
        0.65,
        0.15,
        yaw + Math.PI / recipe.branchCount - recipe.twist,
      ),
      (0.3 * 0.18) / recipe.branchCount,
    )
  }

  return validateFlame({
    version: latestSchemaVersion,
    metadata: {
      name: `${recipe.side === 'light' ? 'Frost' : 'Ember'} crystal lattice pawn`,
      author: 'Lumen Apeiron',
      description:
        'A structural 3D IFS: Sierpinski icosahedral facets, Menger foot, Cantor collar and recursively branching shaft.',
    },
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      pointInitMode: 'pointInitUnitBall',
      drawMode: 'light',
      exposure: recipe.side === 'light' ? 0.25 : -0.25,
      skipIters: 32,
      vibrancy: 0.75,
      contrast: 1.1,
      lightPower: 0.3,
      highlightPower: 0.65,
      depthColorPower: 0.12,
      backgroundColor: [0.008, 0.012, 0.025],
      camera3D: {
        theta: 0.45,
        phi: 1.25,
        radius: 3.6,
        target: [0, PAWN_HEIGHT / 2, 0],
        fov: 45,
        roll: 0,
      },
    },
    transforms,
  })
}
