/**
 * Five authored 3D flame worlds for the desktop observatory. They use the
 * studio's existing IFS variations with rotated and translated branches.
 * A shell alone loses fine structure; repeated contractions and inversions
 * make the visible folds. These are point attractors, not surface textures.
 */
import { defineExample3D, tid, vid } from '@/flame/examples/util'
import type { Palette } from '@/flame/colorMap'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { TransformVariationType3D } from '@/flame/variations3D'

export type OrbPresetId = 'sol' | 'verdant' | 'ember' | 'tide' | 'irchiinnuss'

export interface OrbPreset {
  id: OrbPresetId
  name: string
  subtitle: string
  description: string
  accent: string
  recipe: readonly string[]
  flame: FlameDescriptor
  palette: Palette
}

type Color = readonly [number, number]
type Variation = readonly [TransformVariationType3D, number]
type Point = readonly [number, number, number]
type Pattern = 'curl' | 'fold' | 'inversion' | 'shells' | 'julia'

interface OrbRecipe {
  id: OrbPresetId
  name: string
  subtitle: string
  description: string
  accent: string
  colors: readonly [Color, Color, Color]
  pattern: Pattern
  exposure?: number
}

function affine(scale: number, angle = 0, offset: Point = [0, 0, 0]) {
  return {
    a: scale * Math.cos(angle),
    b: -scale * Math.sin(angle),
    c: 0,
    d: offset[0],
    e: scale * Math.sin(angle),
    f: scale * Math.cos(angle),
    g: 0,
    h: offset[1],
    i: 0,
    j: 0,
    k: scale,
    l: offset[2],
  }
}

function createOrb(recipe: OrbRecipe): OrbPreset {
  const rotations = [0, 2.1, 4.2, 1.6, 3.8]
  const shifts: readonly Point[] = [
    [0.55, 0.15, 0.15],
    [-0.4, 0.4, -0.2],
    [-0.2, -0.5, 0.2],
    [0.25, -0.2, -0.5],
  ]
  const formulas = new Set<string>()

  function transform(
    id: string,
    probability: number,
    variations: readonly Variation[],
    preAffine: ReturnType<typeof affine>,
    postAffine: ReturnType<typeof affine>,
    colorIndex: number,
  ) {
    const color = recipe.colors[colorIndex % 3]!
    for (const [type] of variations) formulas.add(type)
    return [
      tid(`orb_${recipe.id}_${id}`),
      {
        probability,
        preAffine,
        postAffine,
        color: { x: color[0], y: color[1] },
        colorSpeed: 0.5,
        variations: Object.fromEntries(
          variations.map(([type, weight], index) => [
            vid(`orb_${recipe.id}_${id}_${index}`),
            { type, weight },
          ]),
        ),
      },
    ] as const
  }

  const pattern = recipe.pattern
  const branches = pattern === 'curl' || pattern === 'julia' ? 3 : 4
  const shellProbability =
    pattern === 'shells' ? 0 : branches === 3 ? 0.2 : 0.25
  const entries =
    shellProbability === 0
      ? []
      : [
          transform(
            'shell',
            shellProbability,
            [['sphere3D', 1]],
            affine(1, branches === 4 ? 0.4 : 0),
            affine(1),
            0,
          ),
        ]
  const variations: Record<Pattern, readonly Variation[]> = {
    fold: [
      ['linear3D', 0.7],
      ['swirl3D', 0.3],
    ],
    inversion: [
      ['spherical3D', 0.55],
      ['swirl3D', 0.25],
    ],
    shells: [
      ['sphere3D', 0.68],
      ['sinusoidal3D', 0.32],
    ],
    curl: [
      ['curl3D', 0.8],
      ['swirl3D', 0.2],
    ],
    julia: [
      ['julia3D', 0.75],
      ['spherical3D', 0.15],
    ],
  }
  const preScale = {
    fold: 0.68,
    inversion: 1.5,
    shells: 0.7,
    curl: 0.85,
    julia: 0.85,
  }
  const postScale = {
    fold: 1,
    inversion: 0.8,
    shells: 1,
    curl: 0.9,
    julia: 0.9,
  }
  for (let index = 0; index < branches; index++) {
    entries.push(
      transform(
        `branch_${index}`,
        (1 - shellProbability) / branches,
        variations[pattern],
        affine(preScale[pattern], rotations[index], shifts[index]),
        affine(postScale[pattern], rotations[index + 1]),
        pattern === 'shells' ? index : index + 1,
      ),
    )
  }
  const transforms = Object.fromEntries(entries)
  const palette: Palette = {
    id: `explore-${recipe.id}`,
    name: recipe.name,
    source: 'builtin',
    entries: recipe.colors.map(([a, b], index) => ({
      id: `orb-${recipe.id}-${index}`,
      position: index / 2,
      a,
      b,
    })),
  }
  const flame = defineExample3D({
    metadata: { name: recipe.name, description: recipe.description },
    renderSettings: {
      dimensions: 3,
      backgroundColor: [0, 0, 0],
      exposure: recipe.exposure ?? 0.05,
      skipIters: 25,
      plotsPerChain: 16,
      drawMode: 'light',
      colorInitMode: 'colorInitZero',
      pointInitMode: 'pointInitUnitBall',
      vibrancy: 1,
      contrast: 2,
      gamma: 2.2,
      highlightPower: 0.8,
      depthColorPower: 0.12,
      lightDirection: [-0.5, 0.4, -0.8],
      lightPower: 0,
      densityEstimationQuality: 1,
      estimatorCurve: 0.85,
      paletteSpeed: 0.25,
      camera: { zoom: 1, position: [0, 0] },
      camera3D: {
        theta: 0.6,
        phi: 1.35,
        radius: 3.25,
        target: [0, 0, 0],
        fov: 52,
      },
    },
    transforms,
  })
  return {
    id: recipe.id,
    name: recipe.name,
    subtitle: recipe.subtitle,
    description: recipe.description,
    accent: recipe.accent,
    recipe: [...formulas],
    flame,
    palette,
  }
}

export const ORB_PRESETS: readonly OrbPreset[] = [
  createOrb({
    id: 'sol',
    name: 'Sol',
    subtitle: 'A star made of returning light',
    description:
      'Golden currents fold through a luminous shell. Each filament is traced by the same three-dimensional chaos game that powers the studio.',
    accent: '#e8b566',
    colors: [
      [0.2, 0.4],
      [0.5, 0.3],
      [0.05, 0.12],
    ],
    pattern: 'curl',
  }),
  createOrb({
    id: 'verdant',
    name: 'Verdant',
    subtitle: 'An ocean that remembers its shape',
    description:
      'Emerald and ocean-blue branches gather into a living globe. Orbit it to uncover the layers behind its bright atmospheric edge.',
    accent: '#82cdb3',
    colors: [
      [-0.28, -0.4],
      [-0.42, 0.24],
      [0.12, 0.3],
    ],
    pattern: 'fold',
  }),
  createOrb({
    id: 'ember',
    name: 'Ember',
    subtitle: 'A world held together by fire',
    description:
      'Rust, rose and amber gather around branching spherical inversions. The apparent terrain is a cloud of iterated points, with structure on both sides of the globe.',
    accent: '#e18a78',
    colors: [
      [0.48, 0.28],
      [0.35, -0.12],
      [0.18, 0.34],
    ],
    pattern: 'inversion',
    exposure: -0.5,
  }),
  createOrb({
    id: 'tide',
    name: 'Tide',
    subtitle: 'A thousand currents, one blue world',
    description:
      'Cyan threads fold into overlapping blue shells. Different depths overlap as you turn the world, revealing the volume beneath its outline.',
    accent: '#7bbbdc',
    colors: [
      [-0.16, -0.42],
      [-0.32, -0.15],
      [0.07, -0.28],
    ],
    pattern: 'shells',
  }),
  createOrb({
    id: 'irchiinnuss',
    name: 'Irchiinnuss',
    subtitle: 'The other universe is closer than it looks',
    description:
      'Violet, jade and pale gold thread through recursive folds. This world is an original exploratory sketch for the journey beyond the familiar sky.',
    accent: '#b7a0d8',
    colors: [
      [0.3, -0.33],
      [-0.27, 0.12],
      [0.12, 0.3],
    ],
    pattern: 'julia',
    exposure: -1.2,
  }),
]

/** Unknown/empty links open the initial ocean world rather than a blank canvas. */
export function getOrbPreset(id: string): OrbPreset {
  return ORB_PRESETS.find((preset) => preset.id === id) ?? ORB_PRESETS[1]!
}
