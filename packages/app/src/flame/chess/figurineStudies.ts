/**
 * Native affine chess studies with different local self-similar structures.
 * Fixed walk groups isolate each component's chaos game: Menger third-cubes,
 * Sierpinski tetrahedra and a sheared branching tree never clone a whole figure.
 * Coordinates are metres, Y is up, and the three new studies span Y=0..1.8.
 * Exact shared attractor points align the bishop and knight components. These ideal IFS
 * contacts have zero thickness; material and fracture meshes need an explicit
 * finite epsilon thickness, and are not implied by this point-cloud recipe.
 */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import { buildStructuralPawnFlame } from './structuralPawnFlame'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'
import type { PawnSide } from './pawnFlame'

export type FigurineStudyId =
  | 'lattice-pawn'
  | 'menger-rook'
  | 'sierpinski-bishop'
  | 'branching-knight'

export type FigurineStudy = {
  id: FigurineStudyId
  name: string
  piece: 'pawn' | 'rook' | 'bishop' | 'knight'
  family: string
  description: string
  fractureHint: string
}

export const FIGURINE_STUDIES: readonly FigurineStudy[] = Object.freeze([
  {
    id: 'lattice-pawn',
    name: 'Crystal lattice pawn',
    piece: 'pawn',
    family: 'Icosahedral Sierpinski lattice',
    description:
      'Twenty porous tetrahedral facets form a round head above a branching stem and Menger foot.',
    fractureHint:
      'A fracture could follow the head facets, then release smaller tetrahedral cells from each fragment.',
  },
  {
    id: 'menger-rook',
    name: 'Menger rook',
    piece: 'rook',
    family: 'Menger sponge',
    description:
      'Square windows recur through the tower, broad pedestal and crown, with four raised lattice battlements.',
    fractureHint:
      'A fracture could split along the square windows and expose smaller third-cube cavities inside each block.',
  },
  {
    id: 'sierpinski-bishop',
    name: 'Sierpinski bishop',
    piece: 'bishop',
    family: 'Tetrahedral Sierpinski gasket',
    description:
      'A pointed tetrahedral mitre rises above a tapering triangular stem and six-part porous pedestal.',
    fractureHint:
      'A fracture could separate the four tetrahedral branches of the mitre, preserving their repeated central gaps.',
  },
  {
    id: 'branching-knight',
    name: 'Branching knight',
    piece: 'knight',
    family: 'Contracting branching tree',
    description:
      'A leaning recursive neck carries a faceted horse head, projecting lattice muzzle and two pointed ears.',
    fractureHint:
      'A fracture could break the neck at branch junctions, with shorter twigs peeling away before the head falls.',
  },
])

type Point = readonly [number, number, number]
type NativeTransform = FlameDescriptor3D['transforms'][TransformId]
type Affine = NativeTransform['postAffine']
type Builder = ReturnType<typeof createBuilder>

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

function toward(vertex: Point, scale: number): Affine {
  return {
    ...IDENTITY,
    a: scale,
    f: scale,
    k: scale,
    d: (1 - scale) * vertex[0],
    h: (1 - scale) * vertex[1],
    l: (1 - scale) * vertex[2],
  }
}

function createBuilder(study: FigurineStudy, side: PawnSide) {
  const transforms: Record<string, NativeTransform> = {}
  const color =
    side === 'light' ? { x: -0.025, y: -0.065 } : { x: 0.105, y: 0.095 }
  const add = (group: string, affine: Affine, probability: number) => {
    const id = `${group}_${Object.keys(transforms).length}`
    transforms[id] = {
      walkGroup: group,
      preAffine: { ...IDENTITY },
      postAffine: affine,
      probability,
      color: { ...color },
      colorSpeed: 0.4,
      visible: true,
      variations: { [LINEAR]: { type: 'linear3D', weight: 1, visible: true } },
    }
  }
  const corners = (
    group: string,
    vertices: readonly Point[],
    scale: number,
    mass: number,
  ) => {
    for (const vertex of vertices)
      add(group, toward(vertex, scale), mass / vertices.length)
  }
  const finish = (): FlameDescriptor =>
    validateFlame({
      version: latestSchemaVersion,
      metadata: {
        name: `${side === 'light' ? 'Frost' : 'Ember'} ${study.name.toLowerCase()}`,
        author: 'Lumen Apeiron',
        description: `${study.family}. ${study.description}`,
      },
      renderSettings: {
        ...renderSettingsDefault,
        dimensions: 3,
        pointInitMode: 'pointInitUnitBall',
        drawMode: 'light',
        exposure:
          (side === 'light' ? 0.25 : -0.25) +
          (study.id === 'menger-rook' ? 0.4 : 0),
        skipIters: 32,
        vibrancy: 0.75,
        contrast: 1.1,
        lightPower: 0.3,
        highlightPower: 0.65,
        depthColorPower: 0.12,
        backgroundColor: [0.008, 0.012, 0.025],
        camera3D: {
          theta: study.id === 'menger-rook' ? 0 : 0.45,
          phi: study.id === 'menger-rook' ? 1.46 : 1.25,
          radius: 4,
          target: [0, 0.9, 0],
          fov: 45,
          roll: 0,
        },
      },
      transforms,
    })
  return { add, corners, finish }
}

function boxVertices(centre: Point, half: Point, menger = false): Point[] {
  const result: Point[] = []
  const cells = menger ? [-1, 0, 1] : [-1, 1]
  for (const x of cells)
    for (const y of cells)
      for (const z of cells) {
        if (menger && [x, y, z].filter((v) => v === 0).length >= 2) continue
        result.push([
          centre[0] + x * half[0],
          centre[1] + y * half[1],
          centre[2] + z * half[2],
        ])
      }
  return result
}

function octaVertices(centre: Point, half: Point): Point[] {
  return [
    [centre[0] - half[0], centre[1], centre[2]],
    [centre[0] + half[0], centre[1], centre[2]],
    [centre[0], centre[1] - half[1], centre[2]],
    [centre[0], centre[1] + half[1], centre[2]],
    [centre[0], centre[1], centre[2] - half[2]],
    [centre[0], centre[1], centre[2] + half[2]],
  ]
}

function rook(builder: Builder) {
  builder.corners(
    'rook_foot',
    boxVertices([0, 0.11, 0], [0.64, 0.11, 0.64], true),
    1 / 3,
    0.2,
  )
  builder.corners(
    'rook_tower',
    boxVertices([0, 0.84, 0], [0.34, 0.64, 0.34], true),
    1 / 3,
    0.42,
  )
  builder.corners(
    'rook_crown',
    boxVertices([0, 1.49, 0], [0.49, 0.17, 0.49], true),
    1 / 3,
    0.18,
  )
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      builder.corners(
        `rook_battlement_${x < 0 ? 'west' : 'east'}_${z < 0 ? 'back' : 'front'}`,
        boxVertices([x * 0.35, 1.66, z * 0.35], [0.13, 0.14, 0.13]),
        0.44,
        0.05,
      )
    }
}

function bishop(builder: Builder) {
  for (let n = 0; n < 6; n++) {
    const a = (n * Math.PI) / 3
    const b = ((n + 1) * Math.PI) / 3
    builder.corners(
      `bishop_foot_${n}`,
      [
        [0, 0.22, 0],
        [0, 0, 0],
        [0.62 * Math.cos(a), 0, 0.62 * Math.sin(a)],
        [0.62 * Math.cos(b), 0, 0.62 * Math.sin(b)],
      ],
      0.5,
      0.24 / 6,
    )
  }
  builder.corners(
    'bishop_stem',
    [
      [0, 1.13, 0],
      [-0.26, 0.2, -0.15],
      [0.26, 0.2, -0.15],
      [0, 0.22, 0],
    ],
    0.5,
    0.3,
  )
  builder.corners(
    'bishop_collar',
    octaVertices([0, 1.03, 0], [0.24, 0.1, 0.24]),
    0.48,
    0.1,
  )
  builder.corners(
    'bishop_mitre',
    [
      [0, 1.8, 0],
      [-0.29, 1.12, -0.16],
      [0.29, 1.12, -0.16],
      [0, 1.13, 0],
    ],
    0.5,
    0.36,
  )
}

/**
 * Conjugate a neck map through G(x,y,z)=(.38x+.32y-.17,1.1y+.18,.28z).
 * Its local invariant box is x,z in [-1,1], y in [0,1]. Branches rotate within
 * that box before the frame leans the neck forward; every world map remains
 * strictly contractive in the ordinary Euclidean metric.
 */
function neckMap(local: Affine): Affine {
  const sx = 0.38,
    shear = 0.32,
    sy = 1.1,
    sz = 0.28
  const a = local.a + (shear / sx) * local.e
  const b =
    (sx / sy) * local.b +
    (shear / sy) * (local.f - local.a) -
    ((shear * shear) / (sx * sy)) * local.e
  const c = (sx * local.c + shear * local.g) / sz
  const e = (sy / sx) * local.e
  const f = local.f - (shear / sx) * local.e
  const g = (sy / sz) * local.g
  const i = (sz / sx) * local.i
  const j = (sz / sy) * local.j - ((sz * shear) / (sx * sy)) * local.i
  const k = local.k
  const origin: Point = [-0.17, 0.18, 0]
  return {
    a,
    b,
    c,
    e,
    f,
    g,
    i,
    j,
    k,
    d:
      origin[0] +
      sx * local.d +
      shear * local.h -
      a * origin[0] -
      b * origin[1],
    h: origin[1] + sy * local.h - e * origin[0] - f * origin[1],
    l: sz * local.l - i * origin[0] - j * origin[1],
  }
}

function knight(builder: Builder) {
  const foot: Point[] = [
    [0, 0, 0],
    [-0.17, 0.18, 0],
  ]
  for (let n = 0; n < 6; n++)
    foot.push([
      0.58 * Math.cos((n * Math.PI) / 3),
      n % 2 === 0 ? 0 : 0.18,
      0.58 * Math.sin((n * Math.PI) / 3),
    ])
  builder.corners('knight_foot', foot, 0.42, 0.18)
  builder.add(
    'knight_neck',
    neckMap({ ...IDENTITY, a: 0.12, f: 0.45, k: 0.12 }),
    0.4 * 0.15,
  )
  builder.add(
    'knight_neck',
    neckMap({ ...IDENTITY, a: 0.52, f: 0.64, k: 0.52, h: 0.36 }),
    0.4 * 0.2,
  )
  for (const direction of [-1, 1])
    for (const depth of [-1, 1]) {
      const angle = direction * 0.45
      builder.add(
        'knight_neck',
        neckMap({
          ...IDENTITY,
          a: 0.38 * Math.cos(angle),
          b: -0.38 * Math.sin(angle),
          d: direction * 0.44,
          e: 0.38 * Math.sin(angle),
          f: 0.38 * Math.cos(angle),
          h: 0.38,
          k: 0.34,
          l: depth * 0.25,
        }),
        (0.4 * 0.65) / 4,
      )
    }
  const head = octaVertices([0.19, 1.44, 0], [0.23, 0.24, 0.21])
  // The trunk's limiting tip is an actual head anchor, not a point in its void.
  head[2] = [0.15, 1.28, 0]
  builder.corners('knight_head', head, 0.49, 0.18)
  const muzzle = boxVertices([0.51, 1.335, 0], [0.23, 0.095, 0.16])
  muzzle[2] = [0.42, 1.44, 0]
  builder.corners('knight_muzzle', muzzle, 0.44, 0.16)
  for (const side of [-1, 1])
    builder.corners(
      `knight_ear_${side < 0 ? 'back' : 'front'}`,
      [
        [0.07, 1.8, side * 0.11],
        [-0.02, 1.54, side * 0.17],
        [0.2, 1.54, side * 0.17],
        // Image of the head's side anchor under its top contraction (.49).
        [0.19, 1.5624, side * 0.1029],
      ],
      0.5,
      0.04,
    )
}

/** Fresh descriptor; the preserved structural pawn keeps its original recipe. */
export function buildFigurineStudy(
  id: FigurineStudyId,
  side: PawnSide = 'light',
): FlameDescriptor {
  if (id === 'lattice-pawn') return buildStructuralPawnFlame({ side })
  const study = FIGURINE_STUDIES.find((entry) => entry.id === id)
  if (!study) throw new Error(`Unknown figurine study: ${id}`)
  const builder = createBuilder(study, side)
  if (id === 'menger-rook') rook(builder)
  else if (id === 'sierpinski-bishop') bishop(builder)
  else knight(builder)
  return builder.finish()
}
