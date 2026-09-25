/**
 * The affine terms an agent can keyframe, and what each one is.
 *
 * A 2D affine is `{ a b c / d e f }`: x' = a x + b y + c, y' = d x + e y + f.
 * A 3D affine is `{ a b c d / e f g h / i j k l }`: x' = a x + b y + c z + d,
 * and so on. The same letter is a different term in each: `d` is y-from-x in
 * 2D and the x translation in 3D. A transform keeps its own layout (a 3D
 * flame can still hold 2D-layout affines, which the 3D renderer maps), so the
 * catalog lists each affine's own terms and says what each one is.
 *
 * What a term is gets read off the renderer's own affine functions, not
 * copied: set that one term to 1, push the point (2, 3, 5) through, and see
 * which output moves and by how much.
 */
import '@/commands/builtins'
import { vec2f, vec3f } from 'typegpu/data'
import { describe, expect, it } from 'vitest'
import { preflightReplayCommand } from '@/commands/registry'
import { transformAffine } from '@/flame/affineTranform'
import { transformAffine3D } from '@/flame/affineTransform3D'
import { validateFlame } from '@/flame/schema/flameSchema'
import { applyTracksToFlame } from '@/utils/timeline'
import { buildAnimatableCatalog, buildTimelineSnapshot, } from './animatablePaths'
import type { CatalogEntry } from './animatablePaths'

type Layout = '2D' | '3D'
const KEYS: Record<Layout, string[]> = {
  '2D': ['a', 'b', 'c', 'd', 'e', 'f'],
  '3D': ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'],
}

/** What one term does, as the renderer applies it: `x from y`, `z translation`. */
function termMeaning(layout: Layout, key: string): string {
  const unit = Object.fromEntries(
    KEYS[layout].map((k) => [k, k === key ? 1 : 0]),
  )
  type Out = { x: number; y: number; z?: number }
  const out =
    layout === '3D'
      ? (transformAffine3D(unit as never, vec3f(2, 3, 5)) as unknown as Out)
      : (transformAffine(unit as never, vec2f(2, 3)) as unknown as Out)
  const components: Record<string, number> =
    out.z === undefined
      ? { x: out.x, y: out.y }
      : { x: out.x, y: out.y, z: out.z }
  const rows = Object.entries(components).filter(([, value]) => value !== 0)
  expect(rows).toHaveLength(1)
  const [row, value] = rows[0]!
  const from = { 1: 'translation', 2: 'x', 3: 'y', 5: 'z' }[value]
  return from === 'translation' ? `${row} translation` : `${row} from ${from}`
}

const affine3D = (seed: number) =>
  Object.fromEntries(KEYS['3D'].map((k, index) => [k, seed + index / 100]))
const affine2D = (seed: number) =>
  Object.fromEntries(KEYS['2D'].map((k, index) => [k, seed + index / 100]))

function flame(dims: 2 | 3, finalTransform?: Record<string, number>) {
  const affine = dims === 3 ? affine3D : affine2D
  return validateFlame({
    renderSettings: { dimensions: dims, exposure: 0.25, skipIters: 20 },
    transforms: {
      t1: {
        probability: 1,
        color: { x: 0.2, y: 0 },
        colorSpeed: 0.4,
        visible: true,
        preAffine: affine(0.1),
        postAffine: affine(0.5),
        variations: {
          v1: {
            type: dims === 3 ? 'linear3D' : 'linearVar',
            weight: 1,
            visible: true,
          },
        },
      },
    },
    ...(finalTransform ? { finalTransform } : {}),
  })
}

/** The one transform these flames have (transform ids are branded). */
const t1 = (f: ReturnType<typeof flame>) => Object.values(f.transforms)[0]!

function affineEntries(catalog: CatalogEntry[], prefix: string) {
  return catalog
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({
      key: entry.path.slice(prefix.length),
      current: entry.current,
      description: entry.description,
    }))
}

function expected(layout: Layout, affine: Record<string, number> | undefined) {
  return KEYS[layout].map((key) => ({
    key,
    current: affine?.[key],
    description: termMeaning(layout, key),
  }))
}

describe('the catalog lists each affine in its own layout', () => {
  it('a 3D flame: pre- and postAffine a-l, each named for its row or translation', () => {
    const f = flame(3)
    const catalog = buildAnimatableCatalog(f)
    for (const matrix of ['preAffine', 'postAffine'] as const) {
      expect(affineEntries(catalog, `transform.t1.${matrix}.`)).toEqual(
        expected('3D', t1(f)[matrix] as Record<string, number>),
      )
    }
  })

  it('a 2D flame: pre- and postAffine a-f, each named', () => {
    const f = flame(2)
    const catalog = buildAnimatableCatalog(f)
    for (const matrix of ['preAffine', 'postAffine'] as const) {
      expect(affineEntries(catalog, `transform.t1.${matrix}.`)).toEqual(
        expected('2D', t1(f)[matrix] as Record<string, number>),
      )
    }
  })

  it('a 2D flame switched to 3D keeps 2D-layout affines, and the catalog says so', () => {
    // flame.updateRenderSettings replaces renderSettings only; the transforms
    // keep their layout, and the 3D renderer maps a 2D-layout affine.
    const f = structuredClone(flame(2))
    f.renderSettings.dimensions = 3
    const catalog = buildAnimatableCatalog(f)
    expect(affineEntries(catalog, 'transform.t1.preAffine.')).toEqual(
      expected('2D', t1(f).preAffine as Record<string, number>),
    )
  })

  it('the final transform: a-l on a 3D flame, a-f on a 2D one, named', () => {
    const f3 = flame(3, affine3D(0.7))
    expect(
      affineEntries(buildAnimatableCatalog(f3), 'finalTransform.'),
    ).toEqual(expected('3D', f3.finalTransform as Record<string, number>))
    const f2 = flame(2, affine2D(0.7))
    expect(
      affineEntries(buildAnimatableCatalog(f2), 'finalTransform.'),
    ).toEqual(expected('2D', f2.finalTransform as Record<string, number>))
  })

  it('a 3D flame without a final transform gets the 3D one the timeline creates', () => {
    const f = flame(3)
    expect(
      affineEntries(buildAnimatableCatalog(f), 'finalTransform.').map(
        (entry) => [entry.key, entry.description],
      ),
    ).toEqual(KEYS['3D'].map((key) => [key, termMeaning('3D', key)]))
  })
})

const track = (path: string, from: number, to: number) => ({
  path,
  keyframes: [
    { frame: 0, value: from },
    { frame: 30, value: to },
  ],
})

describe('agents can keyframe the 3D terms, and the timeline drives them', () => {
  const paths3D = [
    'transform.t1.preAffine.l',
    'transform.t1.postAffine.g',
    'finalTransform.k',
  ]

  it('accepts g-l on a 3D flame and applies them at the frame', () => {
    const f = flame(3, affine3D(0.7))
    const built = buildTimelineSnapshot(
      { durationFrames: 30, tracks: paths3D.map((p) => track(p, 0, 2)) },
      buildAnimatableCatalog(f),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // A recorded take replays the same snapshot through timeline.loadTimeline.
    expect(
      preflightReplayCommand('timeline.loadTimeline', [built.snapshot]),
    ).toBeUndefined()
    const posed = structuredClone(f)
    applyTracksToFlame(built.snapshot.tracks, posed, 15)
    expect([
      (t1(posed).preAffine as Record<string, number>).l,
      (t1(posed).postAffine as Record<string, number>).g,
      (posed.finalTransform as Record<string, number>).k,
    ]).toEqual([1, 1, 1])
  })

  it('refuses g-l on a 2D-layout affine and says why, not "Unknown path"', () => {
    const f = flame(2)
    const built = buildTimelineSnapshot(
      {
        durationFrames: 30,
        tracks: [track('transform.t1.preAffine.g', 0, 1)],
      },
      buildAnimatableCatalog(f),
    )
    expect(built.ok).toBe(false)
    const error = built.ok ? '' : built.error
    expect(error).not.toContain('Unknown path')
    expect(error).toContain('2D layout')
    expect(error).toContain('a-f')
  })
})
