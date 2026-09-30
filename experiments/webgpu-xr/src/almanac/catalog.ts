// World identities keep the book, supported fractal recipes and original motifs separate.
import { BENCH_RECIPES } from '../bench/recipes'
import type { BenchSettings } from '../bench/settings'

export interface SpecimenDescriptor {
  kind: 'bench-recipe'
  version: 1
  recipeId: (typeof BENCH_RECIPES)[number]['id']
  seed: number
  palette: BenchSettings['palette']
  rings: boolean
}

export interface MotifNote {
  midi: number
  beat: number
  duration: number
}

export interface AlmanacMotif {
  id: string
  tonic: string
  mode: string
  tempo: number
  timbre: 'glass' | 'reed'
  notes: readonly MotifNote[]
}

export interface AlmanacWorld {
  id: string
  name: string
  tonic: string
  mode: string
  summary: string
  status: 'study' | 'preview'
  specimen?: SpecimenDescriptor
  motif?: AlmanacMotif
}

function phrase(pitches: readonly number[]): readonly MotifNote[] {
  return pitches.map((midi, beat) => ({
    midi,
    beat,
    duration: beat === pitches.length - 1 ? 1.6 : 0.7,
  }))
}

export const ALMANAC_WORLDS: readonly AlmanacWorld[] = [
  {
    id: 'glasswake',
    name: 'Glasswake',
    tonic: 'C',
    mode: 'Ionian',
    summary:
      'Aureole folds into six bright petals. Hear a glass motif climb towards its upper C.',
    status: 'study',
    specimen: {
      kind: 'bench-recipe',
      version: 1,
      recipeId: 'rosette',
      seed: 73129,
      palette: 'lagoon',
      rings: true,
    },
    motif: {
      id: 'glasswake-first-light',
      tonic: 'C',
      mode: 'Ionian',
      tempo: 84,
      timbre: 'glass',
      notes: phrase([60, 64, 67, 71, 72, 67, 64, 60]),
    },
  },
  {
    id: 'tideweave',
    name: 'Tideweave',
    tonic: 'D',
    mode: 'Dorian',
    summary:
      'Thicket branches into a folded frond. A reed motif reaches for Dorian’s raised sixth. The form is still a study.',
    status: 'study',
    specimen: {
      kind: 'bench-recipe',
      version: 1,
      recipeId: 'branching',
      seed: 73129,
      palette: 'lagoon',
      rings: true,
    },
    motif: {
      id: 'tideweave-rising-sixth',
      tonic: 'D',
      mode: 'Dorian',
      tempo: 88,
      timbre: 'reed',
      notes: phrase([62, 65, 67, 69, 71, 72, 69, 62]),
    },
  },
  {
    id: 'ember-relay',
    name: 'Ember Relay',
    tonic: 'G',
    mode: 'Mixolydian',
    summary:
      'Rhythmic sparks pass between orbiting stones. Its orb and motif are still to be made.',
    status: 'preview',
  },
  {
    id: 'mirror-archive',
    name: 'Mirror Archive',
    tonic: 'A',
    mode: 'Aeolian',
    summary:
      'Reflections hold fragments of a melody. Its orb and motif are still to be made.',
    status: 'preview',
  },
  {
    id: 'lattice-gardens',
    name: 'Lattice Gardens',
    tonic: 'F',
    mode: 'Lydian',
    summary:
      'Branching lattices reach towards a raised fourth. Its orb and motif are still to be made.',
    status: 'preview',
  },
  {
    id: 'hush-vault',
    name: 'Hush Vault',
    tonic: 'E',
    mode: 'Phrygian',
    summary:
      'A close second note hangs over a chamber of glass. Its orb and motif are still to be made.',
    status: 'preview',
  },
  {
    id: 'broken-crown',
    name: 'Broken Crown',
    tonic: 'B',
    mode: 'Locrian',
    summary:
      'An unfinished ring surrounds a shifting centre. Its orb and motif are still to be made.',
    status: 'preview',
  },
]

// This adapter covers the three bounded bench recipes. It does not ingest an editor FlameDescriptor.
export function settingsForWorld(
  world: AlmanacWorld,
): Partial<BenchSettings> | undefined {
  const specimen = world.specimen
  if (
    world.status !== 'study' ||
    !specimen ||
    specimen.kind !== 'bench-recipe' ||
    specimen.version !== 1
  )
    return undefined
  const recipe = BENCH_RECIPES.find(
    (candidate) => candidate.id === specimen.recipeId,
  )
  if (!recipe) return undefined
  return {
    recipe: recipe.index,
    seed: specimen.seed,
    palette: specimen.palette,
    rings: specimen.rings,
    rotation: false,
    source: 'compute',
    depthProbe: 'off',
    stars: false,
  }
}
