/**
 * The scripted bout: its clocks, its beats, what each beat does to the fight
 * uniforms, the outcome for either winner, and what reduced motion keeps.
 */
import { describe, expect, it } from 'vitest'
import { beatCaption, BOUT_SECONDS, boutCues, boutFrame, HIT_STOPS, orbitCamera, storyTime, wallTime, } from './choreographer'
import { DEFAULT_TINT } from './tint'
import type { BoutFrame, BoutOptions } from './choreographer'

const sweep = (options: BoutOptions, step = 1 / 60) => {
  const frames: BoutFrame[] = []
  for (let wall = 0; wall <= BOUT_SECONDS + 0.5; wall += step) {
    frames.push(boutFrame(wall, options))
  }
  return frames
}
const full: BoutOptions = { winner: 'A', reducedMotion: false }
const calm: BoutOptions = { winner: 'A', reducedMotion: true }

describe('the clocks', () => {
  it('holds story time still through each hit-stop', () => {
    for (const stop of HIT_STOPS) {
      const start = wallTime(stop.at)
      expect(storyTime(start)).toBeCloseTo(stop.at, 12)
      expect(storyTime(start + stop.hold * 0.5)).toBeCloseTo(stop.at, 12)
    }
  })

  it('never runs story time backwards and ends the bout at 12 s', () => {
    let last = -1
    for (let wall = 0; wall <= BOUT_SECONDS; wall += 0.001) {
      const story = storyTime(wall)
      expect(story).toBeGreaterThanOrEqual(last)
      last = story
    }
    const holds = HIT_STOPS.reduce((sum, stop) => sum + stop.hold, 0)
    expect(storyTime(BOUT_SECONDS)).toBeCloseTo(BOUT_SECONDS - holds, 9)
  })

  it('maps a story moment to the wall time that shows it', () => {
    for (const story of [0, 1, 3.15, 5, 9.95, 11]) {
      expect(storyTime(wallTime(story))).toBeCloseTo(story, 9)
    }
  })

  it('lists its cues in order, the last at the end', () => {
    const cues = boutCues('B')
    expect(cues.map((c) => c.kind)).toEqual([
      'intro',
      'impact',
      'clash',
      'devour',
      'swallow',
      'victory',
      'end',
    ])
    const walls = cues.map((c) => c.wall)
    expect([...walls].sort((x, y) => x - y)).toEqual(walls)
    expect(cues.at(-1)?.wall).toBe(BOUT_SECONDS)
    expect(cues.find((c) => c.kind === 'impact')?.by).toBe('B')
  })
})

describe('a bout', () => {
  it('is the same frame for the same time', () => {
    expect(boutFrame(4.321, full)).toEqual(boutFrame(4.321, full))
  })

  it('plays its beats in order', () => {
    const beats = sweep(full).map((f) => f.beat)
    const order = beats.filter((b, n) => b !== beats[n - 1])
    expect(order).toEqual(['intro', 'strike', 'clash', 'devour', 'victory'])
  })

  it('stays inside the ranges the renderer takes', () => {
    for (const options of [full, calm, { ...full, winner: 'B' as const }]) {
      for (const f of sweep(options, 1 / 30)) {
        for (const value of [f.split, f.leakA, f.leakB]) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
        for (const p of [f.a, f.b]) {
          expect(p.placement.scale).toBeGreaterThan(0)
          expect(p.placement.squash).toBeGreaterThan(0)
          expect(Number.isFinite(p.placement.position[0])).toBe(true)
        }
        expect(f.exposure).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('walks on in its own colours, takes its team colour, then inflates', () => {
    const start = boutFrame(0, full)
    expect(start.a.morph).toBe(0)
    expect(start.a.tint).toBe(0)
    const marked = boutFrame(1.4, full)
    expect(marked.b.tint).toBeCloseTo(DEFAULT_TINT, 9)
    expect(marked.b.morph).toBeLessThan(0.95)
    const settled = boutFrame(2.4, full)
    expect(settled.a.morph).toBeGreaterThan(0.99)
  })

  it('turns both fighters while the flat cards inflate', () => {
    const before = boutFrame(0.5, full)
    const during = boutFrame(1.7, full)
    for (const side of ['a', 'b'] as const) {
      const turned = during[side].placement.yaw - before[side].placement.yaw
      expect(Math.abs(turned)).toBeGreaterThan(0.6)
    }
  })

  it('lands the hit as a leak from the attacker, with a flash and a squash', () => {
    const impact = boutFrame(wallTime(HIT_STOPS[0].at) + 0.01, full)
    expect(impact.leakA).toBeGreaterThan(0.25)
    expect(impact.leakB).toBe(0)
    expect(impact.exposure).toBeGreaterThan(1.5)
    expect(impact.b.placement.squash).toBeLessThan(0.75)
    const before = boutFrame(2.5, full)
    expect(before.leakA).toBe(0)
  })

  it('stops the dash at contact and knocks back only after the hit-stop', () => {
    const start = wallTime(HIT_STOPS[0].at)
    const impact = boutFrame(start + 0.01, full)
    const gap = (f: BoutFrame) =>
      f.b.placement.position[0] - f.a.placement.position[0]
    expect(gap(impact)).toBeCloseTo(1.1, 9)
    const after = boutFrame(start + HIT_STOPS[0].hold + 0.25, full)
    expect(gap(after)).toBeGreaterThan(gap(impact) + 0.2)
  })

  it('holds the whole impact frame still through the hit-stop', () => {
    const start = wallTime(HIT_STOPS[0].at)
    const a = boutFrame(start + 0.005, full)
    const b = boutFrame(start + 0.08, full)
    expect(b.a.placement).toEqual(a.a.placement)
    expect(b.leakA).toBe(a.leakA)
    expect(b.camera.target).not.toEqual(a.camera.target)
  })

  it('ends with the winner holding every walker', () => {
    expect(boutFrame(BOUT_SECONDS, full).split).toBe(1)
    const bWins = boutFrame(BOUT_SECONDS, { ...full, winner: 'B' })
    expect(bWins.split).toBe(0)
    expect(boutFrame(BOUT_SECONDS, full).done).toBe(true)
  })

  it('throws both beams to one contact point, driven towards the loser', () => {
    const mid = boutFrame(wallTime(6.5), full)
    expect(mid.beat).toBe('clash')
    expect(mid.a.beam.amount).toBe(1)
    expect(mid.b.beam.amount).toBe(1)
    expect(mid.a.beam.to).toBe(mid.b.beam.to)
    expect(mid.a.beam.to).toBeGreaterThan(mid.a.placement.position[0])
    expect(mid.a.beam.to).toBeLessThan(mid.b.placement.position[0])
    // Towards B, the loser, at +x.
    const early = boutFrame(wallTime(5.9), full)
    const late = boutFrame(wallTime(8.0), full)
    expect(late.a.beam.to - early.a.beam.to).toBeGreaterThan(0.3)
    // A little colour crosses both ways too.
    expect(mid.leakA).toBeGreaterThan(0)
    expect(mid.leakB).toBe(mid.leakA)
    expect(boutFrame(wallTime(4.9), full).a.beam.amount).toBe(0)
  })

  it('keeps the loser in sight while it is drawn in, then swallows it', () => {
    const drawn = boutFrame(wallTime(9.5), { ...full, winner: 'B' })
    expect(drawn.beat).toBe('devour')
    // A, the loser, borrows the winner's maps, keeps a share to be seen by,
    // and streams into the winner.
    expect(drawn.leakA).toBeGreaterThan(0.3)
    expect(drawn.split).toBeGreaterThan(0.3)
    expect(drawn.a.placement.scale).toBeLessThan(0.9)
    expect(drawn.a.beam.amount).toBe(1)
    expect(drawn.a.beam.to).toBe(drawn.b.placement.position[0])
    const gulped = boutFrame(wallTime(10.35), { ...full, winner: 'B' })
    expect(gulped.split).toBe(0)
    expect(gulped.b.placement.squash).toBeGreaterThan(1)
  })

  it('keeps both fighters whole in a 16:9 frame from the beam clash to the gulp', () => {
    // The script frames a fighter of scale 1 as 1.3 either side of its
    // centre on the fight line: its framing holds the half-height to 1, and
    // most flames are a little wider than tall.
    for (const winner of ['A', 'B'] as const) {
      for (let story = 5.0; story <= 9.9; story += 0.05) {
        const f = boutFrame(wallTime(story), { ...full, winner })
        const shown = Math.max(
          f.camera.halfHeight * (16 / 9),
          f.camera.halfWidth,
        )
        for (const side of ['a', 'b'] as const) {
          const p = f[side].placement
          const reach =
            Math.abs(p.position[0] - f.camera.target[0]) + 1.3 * p.scale
          expect(reach, `${side} at ${story.toFixed(2)}`).toBeLessThanOrEqual(
            shown + 1e-9,
          )
        }
      }
    }
  })

  it('mirrors the script for the other winner', () => {
    const t = wallTime(3.0)
    const a = boutFrame(t, full)
    const b = boutFrame(t, { ...full, winner: 'B' })
    expect(b.b.placement.position[0]).toBeCloseTo(-a.a.placement.position[0], 9)
    expect(b.leakB).toBeCloseTo(a.leakA, 12)
  })
})

describe('reduced motion', () => {
  const frames = sweep(calm, 1 / 30)

  it('never moves the camera', () => {
    for (const f of frames) expect(f.camera).toEqual(frames[0]!.camera)
  })

  it('never squashes, spins or flashes past x1.15', () => {
    for (const f of frames) {
      for (const side of ['a', 'b'] as const) {
        const p = f[side].placement
        expect(p.squash).toBe(1)
        expect(p.lean).toBe(0)
        expect(p.scale).toBe(1)
        expect(p.yaw).toBe(frames[0]![side].placement.yaw)
      }
      expect(f.exposure).toBeLessThanOrEqual(1.15 + 1e-12)
    }
    expect(Math.max(...frames.map((f) => f.exposure))).toBeGreaterThan(1.1)
  })

  it('moves a fighter within a beat by a short slide at most', () => {
    // At most 0.2 of the separation; beats change by cuts.
    const slide = 0.2 * 2 * 1.45
    let start = frames[0]!
    for (const f of frames) {
      if (f.beat !== start.beat) start = f
      for (const side of ['a', 'b'] as const) {
        const moved =
          f[side].placement.position[0] - start[side].placement.position[0]
        expect(Math.abs(moved)).toBeLessThanOrEqual(slide + 1e-9)
      }
    }
  })

  it('cuts the two together in the middle for the Devour', () => {
    const f = (story: number) => boutFrame(wallTime(story), calm)
    // A, the winner, on the left; B stands at its clash mark until the cut.
    expect(f(8.1).b.placement.position[0]).toBeCloseTo(1.25, 9)
    for (const story of [8.25, 9.0, 10.3]) {
      const gap =
        f(story).b.placement.position[0] - f(story).a.placement.position[0]
      expect(gap).toBeCloseTo(1.1, 9)
      expect(f(story).a.placement.position[0]).toBeCloseTo(-0.55, 9)
    }
  })

  it('cuts the victor to the centre', () => {
    expect(frames.at(-1)?.a.placement.position).toEqual([0, 0, 0])
  })

  it('still tells the whole story', () => {
    const order = frames
      .map((f) => f.beat)
      .filter((b, n, all) => b !== all[n - 1])
    expect(order).toEqual(['intro', 'strike', 'clash', 'devour', 'victory'])
    expect(frames.some((f) => f.leakA > 0.1)).toBe(true)
    expect(frames.at(-1)?.split).toBe(1)
  })
})

describe('orbitCamera', () => {
  const camera = boutFrame(0, full).camera
  const holds = (aspect: number) => {
    const { radius, fov } = orbitCamera(camera, aspect)
    const halfHeight = radius * Math.tan((fov * Math.PI) / 360)
    return { halfHeight, halfWidth: halfHeight * aspect }
  }

  it.each([16 / 9, 1, 9 / 19.5])('holds the arena in a %f canvas', (aspect) => {
    const shown = holds(aspect)
    expect(shown.halfHeight).toBeGreaterThanOrEqual(camera.halfHeight - 1e-9)
    expect(shown.halfWidth).toBeGreaterThanOrEqual(camera.halfWidth - 1e-9)
  })

  it('survives a canvas with no size yet', () => {
    expect(Number.isFinite(orbitCamera(camera, 0).radius)).toBe(true)
  })
})

describe('beatCaption', () => {
  const names = { A: 'Spiral Galaxy', B: 'Neon' }

  it('names who acts in each beat', () => {
    expect(beatCaption('intro', names, 'A')).toBe('Spiral Galaxy vs Neon')
    expect(beatCaption('strike', names, 'B')).toBe('Neon strikes')
    expect(beatCaption('devour', names, 'A')).toBe('Spiral Galaxy devours Neon')
    expect(beatCaption('victory', names, 'B')).toBe('Neon wins')
  })
})
