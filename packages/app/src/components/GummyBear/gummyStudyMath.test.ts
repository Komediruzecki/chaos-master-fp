/** Independent fixed-time, deformed picking and drag-plane fixtures for the gummy study. */
import { describe, expect, it } from 'vitest'
import { advanceGummyClock, GUMMY_STEP, gummyDemoGrip, gummyDemoPress, gummyDragFrame, gummyDragTarget, gummyJellyCommand, gummyRay, gummyRestBounds, intersectGummyDragPlane, layGummyBearBack, pickGummyVertex, } from './gummyStudyMath'
import type { GummyRay, GummyVec3 } from './gummyStudyMath'

describe('gummy study clock', () => {
  it('advances exact fixed steps and keeps only the remainder', () => {
    const initial = { wall: 0, time: 0, remainder: 0 }
    const first = advanceGummyClock(initial, 0.02, false)
    expect(first.steps).toBe(2)
    expect(first.clock.time).toBeCloseTo(1 / 60)
    expect(first.clock.remainder).toBeCloseTo(1 / 300)
    const next = advanceGummyClock(first.clock, 0.025, false)
    expect(next.steps).toBe(1)
    expect(next.clock.time).toBeCloseTo(0.025)
  })
  it('bounds stalled catchup and prevents resume from simulating the paused interval', () => {
    const caught = advanceGummyClock(
      { wall: 0, time: 1, remainder: 0 },
      12,
      false,
    )
    expect(caught.steps).toBe(8)
    expect(caught.clock.time).toBeCloseTo(1 + 8 * GUMMY_STEP)
    const paused = advanceGummyClock(caught.clock, 100, true)
    expect(paused.steps).toBe(0)
    expect(advanceGummyClock(paused.clock, 100 + GUMMY_STEP, false).steps).toBe(
      1,
    )
  })
  it('initializes without a large first step and rejects nonfinite clocks', () => {
    expect(advanceGummyClock({ time: 0, remainder: 0 }, 123, false).steps).toBe(
      0,
    )
    expect(() =>
      advanceGummyClock({ time: 0, remainder: 0 }, NaN, false),
    ).toThrow(RangeError)
  })
})

describe('gummy pull choreography', () => {
  it('grips, reaches a measured endpoint, then releases instead of moving mesh vertices directly', () => {
    expect(gummyDemoGrip(0.5)).toBeUndefined()
    expect(gummyDemoGrip(1.25)?.target).toEqual([0.64, 1.24, 0.08])
    const held = gummyDemoGrip(4.4)
    expect(held?.center).toEqual([0.64, 1.24, 0.08])
    expect(held?.target[0]).toBeCloseTo(1.59)
    expect(held?.target[1]).toBeCloseTo(1.46)
    expect(held?.target[2]).toBeCloseTo(0.22)
    expect(gummyDemoGrip(5.4)).toBeUndefined()
  })
})

describe('gummy crush choreography', () => {
  it('lowers the plate, holds compression, retracts and leaves settling time', () => {
    expect(gummyDemoPress(0)).toEqual({ height: 1.2, halfExtent: 1.4 })
    expect(gummyDemoPress(0.2).height).toBe(1.2)
    expect(gummyDemoPress(3.35).height).toBeCloseTo(0.675)
    expect(gummyDemoPress(6.5).height).toBe(0.15)
    expect(gummyDemoPress(7).height).toBe(0.15)
    expect(gummyDemoPress(7.75).height).toBeCloseTo(0.675)
    expect(gummyDemoPress(8.45).height).toBe(1.2)
    expect(gummyDemoPress(9.6)).toEqual({ height: 1.2, halfExtent: 1.4 })
  })
  it('has no downward command faster than half a metre per second', () => {
    const dt = 1 / 120
    let previous = gummyDemoPress(0).height
    for (let time = dt; time <= 6.5; time += dt) {
      const height = gummyDemoPress(time).height
      expect((previous - height) / dt).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(height).toBeGreaterThanOrEqual(0.15)
      previous = height
    }
    expect(() => gummyDemoPress(NaN)).toThrow(RangeError)
  })
})

describe('continuous jelly benchmark commands', () => {
  const laid = {
    min: [-0.7, 0.02, -0.35] as GummyVec3,
    max: [0.7, 0.87, 0.5] as GummyVec3,
  }
  it('uses exact fixed-tick phases and a rest-relative squeeze with a three-second hold', () => {
    const cases = [
      [0, 'settling', 1.12],
      [120, 'loading', 1.12],
      [240, 'loading', 0.825],
      [360, 'holding', 0.53],
      [719, 'holding', 0.53],
      [720, 'releasing', 0.53],
      [810, 'releasing', 0.825],
      [900, 'recovering', 1.12],
      [1440, 'complete', 1.12],
    ] as const
    for (const [tick, phase, height] of cases) {
      const command = gummyJellyCommand(tick, 'squeeze', laid)
      expect(command.phase).toBe(phase)
      expect(command.press?.height).toBeCloseTo(height, 12)
      expect(command.press?.halfExtent).toBe(1.4)
      expect(command.grip).toBeUndefined()
    }
    expect(laid).toEqual({ min: [-0.7, 0.02, -0.35], max: [0.7, 0.87, 0.5] })
  })
  it('holds a quarter-height stretch then removes the grip to allow solver-driven recoil', () => {
    const upright = {
      min: [-0.7, 0, -0.4] as GummyVec3,
      max: [0.7, 2.5, 0.4] as GummyVec3,
    }
    const preload = gummyJellyCommand(0, 'stretch', upright)
    expect(preload.phase).toBe('settling')
    expect(preload.grip?.target).toEqual(preload.grip?.center)
    expect(preload.grip?.radius).toBe(0.65)
    const start = gummyJellyCommand(120, 'stretch', upright)
    expect(start.grip?.center).toEqual([0, 1.95, 0])
    expect(start.grip?.target).toEqual(start.grip?.center)
    expect(
      gummyJellyCommand(240, 'stretch', upright).grip?.target[1],
    ).toBeCloseTo(2.2625)
    expect(
      gummyJellyCommand(360, 'stretch', upright).grip?.target[1],
    ).toBeCloseTo(2.575)
    expect(gummyJellyCommand(719, 'stretch', upright).phase).toBe('holding')
    expect(gummyJellyCommand(720, 'stretch', upright)).toEqual({
      phase: 'recovering',
    })
    expect(gummyJellyCommand(1440, 'stretch', upright)).toEqual({
      phase: 'complete',
    })
  })
  it('derives finite bounds without altering masses and rejects invalid ticks or flat poses', () => {
    const positions = new Float32Array([1, 3, -1, 2, -2, 1, 4, 3])
    const saved = positions.slice()
    expect(gummyRestBounds(positions)).toEqual({
      min: [-2, 1, -1],
      max: [1, 3, 4],
    })
    expect(positions).toEqual(saved)
    expect(() => gummyRestBounds(new Float32Array(3))).toThrow(RangeError)
    expect(() => gummyRestBounds(new Float32Array([0, NaN, 0, 1]))).toThrow(
      RangeError,
    )
    expect(() => gummyRestBounds(new Float32Array([0, 1, 0, 1]))).toThrow(
      RangeError,
    )
    for (const tick of [-1, 1.5, NaN])
      expect(() => gummyJellyCommand(tick, 'squeeze', laid)).toThrow(RangeError)
  })
})

describe('laid-back crush rest pose', () => {
  it('preserves signed volume, distances and inverse masses while resting above the floor', () => {
    const original = new Float32Array([
      0, 0, -0.35, 1, 1, 0, -0.35, 2, 0, 1, -0.35, 3, 0, 0, 0.65, 4,
    ])
    const saved = original.slice()
    const laid = layGummyBearBack(original)
    const edge = (id: number): GummyVec3 => [
      laid[id * 4]! - laid[0]!,
      laid[id * 4 + 1]! - laid[1]!,
      laid[id * 4 + 2]! - laid[2]!,
    ]
    const a = edge(1),
      b = edge(2),
      c = edge(3)
    const signedVolume =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
    expect(signedVolume).toBeCloseTo(1 / 6)
    expect(Math.hypot(...edge(1))).toBeCloseTo(1)
    expect(Math.hypot(...edge(2))).toBeCloseTo(1)
    expect(Math.hypot(...edge(3))).toBeCloseTo(1)
    expect(Math.min(laid[1]!, laid[5]!, laid[9]!, laid[13]!)).toBeCloseTo(0.01)
    expect([laid[3], laid[7], laid[11], laid[15]]).toEqual([1, 2, 3, 4])
    expect(original).toEqual(saved)
    expect(() => layGummyBearBack(new Float32Array(3))).toThrow(RangeError)
  })
})

describe('gummy picking', () => {
  it('unprojects WebGPU depth zero to one, with a normalized ray', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect(gummyRay(0.3, -0.2, identity)).toEqual({
      origin: [0.3, -0.2, 0],
      direction: [0, 0, 1],
    })
  })
  it('picks the nearest movable CURRENT position rather than a rest mesh or a pinned point', () => {
    const positions = new Float32Array([
      0, 0, 1, 0, 0, 0, 3, 1, 0, 0, 2, 1, 0.4, 0, 0.5, 1,
    ])
    const ray = {
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
    }
    expect(pickGummyVertex(ray, positions)).toEqual([0, 0, 2])
    positions[8] = 0.5
    expect(pickGummyVertex(ray, positions)).toEqual([0, 0, 3])
  })
  it('keeps drag depth and rejects parallel or rear-facing intersections', () => {
    expect(
      intersectGummyDragPlane(
        { origin: [0, 0, 0], direction: [0, 0, 1] },
        [1, 2, 3],
        [0, 0, 1],
      ),
    ).toEqual([0, 0, 3])
    expect(
      intersectGummyDragPlane(
        { origin: [0, 0, 0], direction: [1, 0, 0] },
        [0, 0, 3],
        [0, 0, 1],
      ),
    ).toBeUndefined()
    expect(
      intersectGummyDragPlane(
        { origin: [0, 0, 0], direction: [0, 0, -1] },
        [0, 0, 3],
        [0, 0, 1],
      ),
    ).toBeUndefined()
  })
  it('keeps an off-ray selected vertex stationary until the pointer actually moves', () => {
    const ray: GummyRay = { origin: [0, 0, 0], direction: [0, 0, 1] }
    const frame = gummyDragFrame(ray, [0.08, 0.03, 2])!
    expect(gummyDragTarget(ray, frame)).toEqual([0.08, 0.03, 2])
    const moved: GummyRay = { origin: [0.2, -0.1, 0], direction: [0, 0, 1] }
    const target = gummyDragTarget(moved, frame)!
    expect(target[0]).toBeCloseTo(0.28)
    expect(target[1]).toBeCloseTo(-0.07)
    expect(target[2]).toBe(2)
  })
  it('preserves an oblique view offset and declines invalid drag rays', () => {
    const ray: GummyRay = { origin: [0, 0, 0], direction: [0.6, 0, 0.8] }
    const frame = gummyDragFrame(ray, [1, 0.07, 2])!
    const target = gummyDragTarget(ray, frame)!
    expect(target[0]).toBeCloseTo(1)
    expect(target[1]).toBeCloseTo(0.07)
    expect(target[2]).toBeCloseTo(2)
    expect(
      gummyDragTarget({ origin: [0, 0, 0], direction: [0, 1, 0] }, frame),
    ).toBeUndefined()
    expect(
      gummyDragFrame({ origin: [0, 0, 0], direction: [0, 0, -1] }, [0, 0, 2]),
    ).toBeUndefined()
  })
})
