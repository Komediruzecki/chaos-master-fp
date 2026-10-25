/**
 * A native 3D condensation IFS: bounded ball distributions form a readable pawn,
 * and contractive lattice maps repeat that whole form as smaller filigree.
 * The scaffold gives the head a round outline and the foot continuous contact;
 * recursion adds structure without breaking the familiar silhouette into islands.
 *
 * The recursive maps are p -> s R_y(twist) (p-centre) + anchor, s in [0.035,0.1].
 * Scaffold maps ignore the previous position via native blur3D (a unit ball).
 * Both families stay within |xz| <= 0.64, 0 <= y <= 1.8 under mixed composition.
 */
import { latestSchemaVersion, renderSettingsDefault, validateFlame, } from '../schema/flameSchema'
import type { FlameDescriptor, FlameDescriptor3D, TransformId, VariationId, } from '../schema/flameSchema'

export type PawnSide = 'light' | 'dark'

/** Twist is a recursive rotation in radians; openness separates smaller copies. */
export type PawnRecipe = {
  branchCount: number
  openness: number
  twist: number
  side: PawnSide
}

export const DEFAULT_PAWN_RECIPE: Readonly<PawnRecipe> = Object.freeze({
  branchCount: 6,
  openness: 0.375,
  twist: 0.18,
  side: 'light',
})

export const PAWN_RECIPE_LIMITS = Object.freeze({
  branchCount: Object.freeze({ min: 3, max: 8, step: 1 }),
  openness: Object.freeze({ min: 0, max: 1, step: 0.025 }),
  twist: Object.freeze({ min: -Math.PI, max: Math.PI, step: 0.05 }),
})

/** World units, with the foot on y=0 and the head's top on y=PAWN_HEIGHT. */
export const PAWN_HEIGHT = 1.8
export const PAWN_BASE_RADIUS = 0.64

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

/** Keeps interactive and saved recipes finite; continuous controls retain precision. */
export function normalizePawnRecipe(
  input: Partial<PawnRecipe> = {},
): PawnRecipe {
  return {
    branchCount: Math.round(
      bounded(
        input.branchCount,
        DEFAULT_PAWN_RECIPE.branchCount,
        PAWN_RECIPE_LIMITS.branchCount.min,
        PAWN_RECIPE_LIMITS.branchCount.max,
      ),
    ),
    openness: bounded(
      input.openness,
      DEFAULT_PAWN_RECIPE.openness,
      PAWN_RECIPE_LIMITS.openness.min,
      PAWN_RECIPE_LIMITS.openness.max,
    ),
    twist: bounded(
      input.twist,
      DEFAULT_PAWN_RECIPE.twist,
      PAWN_RECIPE_LIMITS.twist.min,
      PAWN_RECIPE_LIMITS.twist.max,
    ),
    side: input.side === 'dark' ? 'dark' : 'light',
  }
}

type Anchor = { x: number; y: number; z: number }
type PawnTransform = FlameDescriptor3D['transforms'][TransformId]

const LINEAR = 'linear' as VariationId
const BODY = 'body' as VariationId
const HEAD_RADIUS = 0.34
const HEAD_CENTRE = PAWN_HEIGHT - HEAD_RADIUS
const HEAD_LATTICE_RADIUS = 0.22
const STEM_RADIUS = 0.15
const STEM_RINGS = 5
const HEAD_LATITUDES = 4
const SCAFFOLD_SHARE = 0.72

const IDENTITY = {
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

function ring(count: number, radius: number, y: number): Anchor[] {
  return Array.from({ length: count }, (_, n) => {
    const angle = (n / count) * 2 * Math.PI
    return { x: radius * Math.cos(angle), y, z: radius * Math.sin(angle) }
  })
}

function pawnAnchors(branchCount: number) {
  const base = [
    ...ring(branchCount, 0.5, 0.1),
    ...ring(branchCount, 0.32, 0.22),
    { x: 0, y: 0.1, z: 0 },
  ]
  const stem = Array.from({ length: STEM_RINGS }, (_, n) => {
    const t = n / (STEM_RINGS - 1)
    // A flared heel narrows through the shaft, then meets the head's underside.
    const radius = STEM_RADIUS * (0.75 + 0.5 * (1 - t) ** 2 + 0.18 * t ** 3)
    return ring(branchCount, radius * 0.65, 0.3 + t * 0.78)
  }).flat()
  const head = [
    { x: 0, y: HEAD_CENTRE - HEAD_LATTICE_RADIUS, z: 0 },
    ...Array.from({ length: HEAD_LATITUDES }, (_, n) => {
      const latitude = ((n + 1) / (HEAD_LATITUDES + 1)) * Math.PI
      return ring(
        branchCount,
        HEAD_LATTICE_RADIUS * Math.sin(latitude),
        HEAD_CENTRE + HEAD_LATTICE_RADIUS * Math.cos(latitude),
      )
    }).flat(),
    { x: 0, y: HEAD_CENTRE + HEAD_LATTICE_RADIUS, z: 0 },
  ]
  return [
    { name: 'base', anchors: base, share: 0.28 },
    { name: 'stem', anchors: stem, share: 0.3 },
    { name: 'head', anchors: head, share: 0.42 },
  ] as const
}

/** Overlapping ellipsoids make one continuous foot and a flared, tapered shaft. */
function scaffold() {
  return [
    {
      name: 'foot',
      y: 0.035,
      radius: PAWN_BASE_RADIUS,
      height: 0.035,
      share: 0.26 * 0.45,
    },
    { name: 'bevel', y: 0.13, radius: 0.56, height: 0.11, share: 0.26 * 0.35 },
    { name: 'heel', y: 0.25, radius: 0.32, height: 0.13, share: 0.26 * 0.2 },
    ...Array.from({ length: STEM_RINGS }, (_, n) => ({
      name: `shaft_${n}`,
      y: 0.32 + n * 0.21,
      radius: [0.21, 0.17, 0.14, 0.125, 0.155][n]!,
      height: n === 0 ? 0.2 : 0.19,
      share: (0.28 * 0.8) / STEM_RINGS,
    })),
    {
      name: 'collar',
      y: 1.105,
      radius: 0.23,
      height: 0.055,
      share: 0.28 * 0.2,
    },
    {
      name: 'ball',
      y: HEAD_CENTRE,
      radius: HEAD_RADIUS,
      height: HEAD_RADIUS,
      share: 0.46,
    },
  ]
}

/**
 * A fresh standard flame descriptor that the native 3D renderer and editor can
 * open directly. The recipe has at most 101 maps, below the renderer's 128 limit.
 */
export function buildPawnFlame(
  input: Partial<PawnRecipe> = {},
): FlameDescriptor {
  const recipe = normalizePawnRecipe(input)
  const scale = 0.1 - 0.065 * recipe.openness
  const c = scale * Math.cos(recipe.twist)
  const s = scale * Math.sin(recipe.twist)
  const transforms: Record<string, PawnTransform> = {}
  const colour =
    recipe.side === 'light' ? { x: -0.025, y: -0.065 } : { x: 0.105, y: 0.095 }
  for (const volume of scaffold()) {
    transforms[`pawn_scaffold_${volume.name}`] = {
      probability: volume.share * SCAFFOLD_SHARE,
      preAffine: { ...IDENTITY },
      postAffine: {
        ...IDENTITY,
        a: volume.radius,
        f: volume.height,
        k: volume.radius,
        h: volume.y,
      },
      color: { ...colour },
      colorSpeed: 0.4,
      visible: true,
      variations: {
        [BODY]: { type: 'blur3D', weight: 1, visible: true },
      },
    }
  }
  for (const component of pawnAnchors(recipe.branchCount)) {
    for (const [n, anchor] of component.anchors.entries()) {
      transforms[`pawn_${component.name}_${n}`] = {
        probability:
          ((1 - SCAFFOLD_SHARE) * component.share) / component.anchors.length,
        preAffine: { ...IDENTITY, h: -PAWN_HEIGHT / 2 },
        postAffine: {
          a: c,
          b: 0,
          c: s,
          d: anchor.x,
          e: 0,
          f: scale,
          g: 0,
          h: anchor.y,
          i: -s,
          j: 0,
          k: c,
          l: anchor.z,
        },
        color: { ...colour },
        colorSpeed: 0.4,
        visible: true,
        variations: {
          [LINEAR]: { type: 'linear3D', weight: 1, visible: true },
        },
      }
    }
  }
  return validateFlame({
    version: latestSchemaVersion,
    metadata: {
      name: `${recipe.side === 'light' ? 'Light' : 'Dark'} fractal pawn`,
      author: 'Lumen Apeiron',
      description:
        'A native condensation IFS with a spherical head, tapered shaft and recursively repeated filigree.',
    },
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      pointInitMode: 'pointInitUnitBall',
      drawMode: 'light',
      exposure: recipe.side === 'light' ? 0.25 : -0.25,
      skipIters: 24,
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
