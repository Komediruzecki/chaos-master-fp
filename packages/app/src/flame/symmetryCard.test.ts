/**
 * The Symmetry card's angle editor, one per rotation transform
 * (TransformsSection): it shows `symmetryRotationAngle` of the preAffine,
 * keys `symmetryRotationTerms` when it is dragged, and writes
 * `symmetryRotationPreAffine` through `flame.setTransformAffine`.
 */
import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/commands/registry'
import { symmetryRotationPreAffine } from './symmetry'
import { affineLayout, symmetryRotationAngle, symmetryRotationTerms, } from './symmetryDetection'
import { build, renderedPreAffine, SOURCES, symIds, workspace, } from './symmetryTestUtils'
import type { Dims, Source, Workspace } from './symmetryTestUtils'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

type Affine = Record<string, number>

const round = (v: number, places = 2) => {
  const r = Math.round(v * 10 ** places) / 10 ** places
  return r === 0 ? 0 : r
}
const degrees = (radians: number) => round((radians * 180) / Math.PI)

function preAffineOf(flame: FlameDescriptor, tid: string): Affine {
  return flame.transforms[tid as keyof typeof flame.transforms]!.preAffine
}

/** The angle editor's `setValue`. */
function dragAngle(ws: Workspace, tid: string, angle: number) {
  executeCommand(
    'flame.setTransformAffine',
    ws.ctx,
    tid,
    'pre',
    symmetryRotationPreAffine(
      angle,
      affineLayout(preAffineOf(ws.flame(), tid)),
    ),
  )
}

/** The rotation transforms of a 4-fold rotational set: 90, 180, 270. */
function rotations(dims: Dims, source: Source) {
  const ws = workspace(build(dims, 'rotational', 4, source))
  return { ws, ids: symIds(ws.flame()) }
}

/** Where the renderer sends the x axis, as `(x, y, z)`. */
function xAxis(flame: FlameDescriptor, tid: string): string {
  const rows = renderedPreAffine(flame, tid)
  return `(${rows.map((row) => round(row[0]!)).join(', ')})`
}

const CASES: { dims: Dims; source: Source }[] = [
  { dims: 2, source: 'symmetry.ts' },
  { dims: 2, source: 'command' },
  ...SOURCES.map((source) => ({ dims: 3 as const, source })),
]

describe('the angle editor on a rotation transform', () => {
  it('pins what it shows, keys and writes, per writer', () => {
    const rows = CASES.map(({ dims, source }) => {
      const { ws, ids } = rotations(dims, source)
      const flame = ws.flame()
      const shown = ids
        .map((tid) => degrees(symmetryRotationAngle(preAffineOf(flame, tid))))
        .join(' ')
      const keys = symmetryRotationTerms(preAffineOf(flame, ids[0]!)).join(' ')
      const before = affineLayout(preAffineOf(flame, ids[0]!))
      dragAngle(ws, ids[0]!, Math.PI / 4)
      const after = ws.flame()
      const afterLayout = affineLayout(preAffineOf(after, ids[0]!))
      const readBack = degrees(
        symmetryRotationAngle(preAffineOf(after, ids[0]!)),
      )
      return `${dims}D by ${source}: shows ${shown}; keys ${keys}; 45 writes ${before} -> ${afterLayout}, sends x to ${xAxis(after, ids[0]!)}, shows ${readBack}`
    })
    expect(rows).toEqual([
      '2D by symmetry.ts: shows 90 180 270; keys a b d e; 45 writes 2D -> 2D, sends x to (0.71, 0.71, 0), shows 45',
      '2D by command: shows 90 180 270; keys a b d e; 45 writes 2D -> 2D, sends x to (0.71, 0.71, 0), shows 45',
      '3D by symmetry.ts: shows 90 180 270; keys a b e f; 45 writes 3D -> 3D, sends x to (0.71, 0.71, 0), shows 45',
      '3D by command: shows 90 180 270; keys a b d e; 45 writes 2D -> 2D, sends x to (0.71, 0.71, 0), shows 45',
      '3D by command, reloaded: shows 90 180 270; keys a b e f; 45 writes 3D -> 3D, sends x to (0.71, 0.71, 0), shows 45',
    ])
  })
})

describe('the angle editor reads, keys and writes the terms of its layout', () => {
  for (const { dims, source } of CASES) {
    it(`${dims}D by ${source}: shows each rotation's own angle, folds 3-8`, () => {
      for (let folds = 3; folds <= 8; folds++) {
        const flame = build(dims, 'rotational', folds, source)
        const shown = symIds(flame).map((tid) =>
          symmetryRotationAngle(preAffineOf(flame, tid)),
        )
        const written = symIds(flame).map(
          (_, index) => (2 * Math.PI * (index + 1)) / folds,
        )
        expect(shown.map((v) => round(v, 9))).toEqual(
          written.map((v) => round(v, 9)),
        )
      }
    })

    it(`${dims}D by ${source}: keys the terms a rotation changes`, () => {
      // The terms that differ between two rotations the writer itself wrote.
      const flame = build(dims, 'rotational', 5, source)
      const [first, second] = symIds(flame).map((tid) =>
        preAffineOf(flame, tid),
      )
      const changed = Object.keys(first!).filter(
        (key) => first![key] !== second![key],
      )
      expect([...symmetryRotationTerms(first!)].sort()).toEqual(changed.sort())
    })

    it(`${dims}D by ${source}: a drag keeps the layout and renders the angle it shows`, () => {
      for (const angle of [0.3, Math.PI / 4, 2, 4, 5.9]) {
        const { ws, ids } = rotations(dims, source)
        const tid = ids[0]!
        const layout = affineLayout(preAffineOf(ws.flame(), tid))
        dragAngle(ws, tid, angle)
        const after = preAffineOf(ws.flame(), tid)
        expect(affineLayout(after)).toBe(layout)
        expect(round(symmetryRotationAngle(after), 9)).toBe(round(angle, 9))
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        expect(
          renderedPreAffine(ws.flame(), tid).map((row) =>
            row.map((v) => round(v, 9)),
          ),
        ).toEqual(
          [
            [cos, -sin, 0, 0],
            [sin, cos, 0, 0],
            [0, 0, 1, 0],
          ].map((row) => row.map((v) => round(v, 9))),
        )
      }
    })
  }
})
