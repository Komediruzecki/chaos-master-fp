/**
 * What the Symmetry card reads back from a flame, and what it rebuilds when
 * its Folds input changes.
 *
 * The card shows `detectSymmetryType` and `detectSymmetryFolds` over the
 * flame's `_sym__` transforms. Its Folds input (TransformsSection) rounds the
 * value, and when it differs from the shown fold count it runs
 * `flame.applySymmetry` with the new count and the shown type, which deletes
 * every `_sym__` transform and writes a fresh set. So a type the card reads
 * wrongly is a type the fold change writes wrongly.
 *
 * A flame gets its symmetry transforms from one of two writers, in 2D or 3D:
 * `applySymmetryToFlame` (symmetry.ts, behind Flame Clash's C1-C8 buttons)
 * and the `flame.applySymmetry` command (the card itself, and agents). A 3D
 * flame that is saved and loaded again has every 2D-layout affine promoted to
 * the 3D layout (`migrateFlameVariationTypes` in core), so that is a third
 * source.
 */
import '@/commands/builtins'
import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/commands/registry'
import { validateFlame } from '@/flame/schema/flameSchema'
import { deepClone } from '@/utils/clone'
import { applySymmetryToFlame } from './symmetry'
import { detectSymmetryFolds, detectSymmetryType } from './symmetryDetection'
import { extractFlameUniforms3D } from './transformFunction3D'
import type { SymmetryType } from './symmetryDetection'
import type { CommandContext } from '@/commands/types'
import type { FlameDescriptor, TransformId } from '@/flame/schema/flameSchema'

type Dims = 2 | 3
type Source = 'symmetry.ts' | 'command' | 'command, reloaded'

const base2D = validateFlame({
  renderSettings: { dimensions: 2, exposure: 0.25, skipIters: 20 },
  transforms: {
    t1: {
      probability: 1,
      color: { x: 0.2, y: 0 },
      colorSpeed: 0.4,
      visible: true,
      preAffine: { a: 0.5, b: 0, c: 0.1, d: 0, e: 0.5, f: 0 },
      postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
      variations: { v1: { type: 'sphericalVar', weight: 1, visible: true } },
    },
  },
})

const base3D = validateFlame({
  renderSettings: { dimensions: 3, exposure: 0.25, skipIters: 20 },
  transforms: {
    t1: {
      probability: 1,
      color: { x: 0.2, y: 0 },
      colorSpeed: 0.4,
      visible: true,
      preAffine: {
        a: 0.5,
        b: 0,
        c: 0,
        d: 0.1,
        e: 0,
        f: 0.5,
        g: 0,
        h: 0,
        i: 0,
        j: 0,
        k: 0.5,
        l: 0,
      },
      postAffine: {
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
      },
      variations: { v1: { type: 'linear3D', weight: 1, visible: true } },
    },
  },
})

const bases: Record<Dims, FlameDescriptor> = { 2: base2D, 3: base3D }

/** A workspace with the real command registry over one flame. */
function workspace(initial: FlameDescriptor) {
  let flame = deepClone(initial)
  const setFlameDescriptor = ((
    updater: FlameDescriptor | ((draft: FlameDescriptor) => unknown),
  ) => {
    if (typeof updater === 'function') {
      const draft = deepClone(flame)
      const replacement = updater(draft)
      flame = (replacement ?? draft) as FlameDescriptor
    } else {
      flame = deepClone(updater)
    }
  }) as CommandContext['setFlameDescriptor']
  const ctx = {
    flameDescriptor: () => flame,
    setFlameDescriptor,
  } as unknown as CommandContext
  return { ctx, flame: () => flame }
}

/** The `_sym__` transforms, as MainWorkspace's `symTransforms` selects them. */
function symTransforms(flame: FlameDescriptor) {
  return Object.entries(flame.transforms)
    .filter(([tid]) => tid.startsWith('_sym__'))
    .map(([, t]) => t)
}

/** MainWorkspace's `applySymmetry`, which the card calls. */
function applySymmetry(
  ctx: CommandContext,
  n: number,
  type: SymmetryType,
  origin: 'add' | 'type' | 'folds',
) {
  executeCommand('flame.applySymmetry', ctx, n, type, undefined, origin)
}

/** The Folds input's `onInput` in TransformsSection. */
function scrubFolds(ws: ReturnType<typeof workspace>, value: number) {
  const syms = symTransforms(ws.flame())
  const newN = Math.max(2, Math.round(value))
  if (newN !== detectSymmetryFolds(syms)) {
    applySymmetry(ws.ctx, newN, detectSymmetryType(syms), 'folds')
  }
}

/** A saved flame loaded again: JSON out, then the schema's own load path. */
function reload(flame: FlameDescriptor): FlameDescriptor {
  return validateFlame(JSON.parse(JSON.stringify(flame)))
}

function build(
  dims: Dims,
  type: SymmetryType,
  folds: number,
  source: Source,
): FlameDescriptor {
  if (source === 'symmetry.ts') {
    return applySymmetryToFlame(bases[dims], folds, type)
  }
  const ws = workspace(bases[dims])
  applySymmetry(ws.ctx, folds, type, 'add')
  return source === 'command' ? ws.flame() : reload(ws.flame())
}

/**
 * The `_sym__` transforms whose preAffine flips orientation as the renderer
 * applies it (a negative determinant): the mirrors, counted without the
 * detector. A 3D flame goes through `extractFlameUniforms3D`, which reads
 * either key layout; a 2D flame's affine is `x' = a x + b y + c`,
 * `y' = d x + e y + f`.
 */
function renderedMirrors(flame: FlameDescriptor): number {
  const ids = Object.keys(flame.transforms).filter((tid) =>
    tid.startsWith('_sym__'),
  )
  if (flame.renderSettings.dimensions === 3) {
    const uniforms = extractFlameUniforms3D(flame) as Record<
      string,
      { preAffine: Record<string, number> }
    >
    return ids.filter((tid) => {
      const { a, b, c, e, f, g, i, j, k } = uniforms[`flame${tid}`]!.preAffine
      const det =
        a! * (f! * k! - g! * j!) -
        b! * (e! * k! - g! * i!) +
        c! * (e! * j! - f! * i!)
      return det < 0
    }).length
  }
  return ids.filter((tid) => {
    const { a, b, d, e } = flame.transforms[tid as TransformId]!.preAffine
    return a * e - b * d < 0
  }).length
}

function describeCard(flame: FlameDescriptor) {
  const syms = symTransforms(flame)
  return `${detectSymmetryType(syms)} ${detectSymmetryFolds(syms)} (${syms.length} transforms, ${renderedMirrors(flame)} mirror)`
}

const SOURCES: Source[] = ['symmetry.ts', 'command', 'command, reloaded']
const TYPES: SymmetryType[] = ['rotational', 'dihedral']

describe('the Symmetry card across a fold change, 4 to 6', () => {
  it('pins what the card reads before and after, per writer', () => {
    const rows: string[] = []
    for (const dims of [2, 3] as const) {
      for (const type of TYPES) {
        for (const source of SOURCES) {
          const ws = workspace(build(dims, type, 4, source))
          const before = describeCard(ws.flame())
          scrubFolds(ws, 6)
          rows.push(
            `${dims}D ${type} by ${source}: ${before} -> ${describeCard(ws.flame())}`,
          )
        }
      }
    }
    expect(rows).toEqual([
      '2D rotational by symmetry.ts: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '2D rotational by command: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '2D rotational by command, reloaded: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '2D dihedral by symmetry.ts: dihedral 4 (4 transforms, 1 mirror) -> dihedral 6 (6 transforms, 1 mirror)',
      '2D dihedral by command: dihedral 4 (4 transforms, 1 mirror) -> dihedral 6 (6 transforms, 1 mirror)',
      '2D dihedral by command, reloaded: dihedral 4 (4 transforms, 1 mirror) -> dihedral 6 (6 transforms, 1 mirror)',
      '3D rotational by symmetry.ts: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '3D rotational by command: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '3D rotational by command, reloaded: rotational 4 (3 transforms, 0 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '3D dihedral by symmetry.ts: rotational 5 (4 transforms, 1 mirror) -> rotational 6 (5 transforms, 0 mirror)',
      '3D dihedral by command: dihedral 4 (4 transforms, 1 mirror) -> dihedral 6 (6 transforms, 1 mirror)',
      '3D dihedral by command, reloaded: rotational 5 (4 transforms, 1 mirror) -> rotational 6 (5 transforms, 0 mirror)',
    ])
  })
})
