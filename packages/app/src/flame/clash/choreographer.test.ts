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

  it('enters as flat cards and inflates, then takes the team colours', () => {
    const start = boutFrame(0, full)
    expect(start.a.morph).toBe(0)
    expect(start.a.tint).toBe(0)
    const settled = boutFrame(2.4, full)
    expect(settled.a.morph).toBeGreaterThan(0.99)
    expect(settled.b.tint).toBeCloseTo(DEFAULT_TINT, 9)
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

  it('devours through the loser borrowing the winner maps', () => {
    const devour = boutFrame(wallTime(9.2), { ...full, winner: 'B' })
    expect(devour.beat).toBe('devour')
    expect(devour.leakA).toBeGreaterThan(0.6)
    expect(devour.split).toBeLessThan(0.2)
    expect(devour.a.placement.scale).toBeLessThan(0.9)
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

  it('keeps the fighters on their marks, unsquashed and unflashed', () => {
    for (const f of frames) {
      expect(f.a.placement).toEqual(frames[0]!.a.placement)
      expect(f.b.placement).toEqual(frames[0]!.b.placement)
      expect(f.exposure).toBe(1)
    }
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
