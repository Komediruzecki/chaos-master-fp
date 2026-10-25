/** Particle handle timing and deformed-world picking must retain material identity. */
import { describe, expect, it } from 'vitest'
import { PARTICLE_PULL_HANDLE, particleGripControls, particleStudyCommand, pickParticleGrip, } from './particleStudyMath'

describe('particleGripControls', () => {
  it('retains the calibrated defaults and uses finite fallback values for both materials', () => {
    for (const warm of [false, true]) {
      const expected = { radius: warm ? 0.22 : 0.28, maxPull: 1.8 }
      for (const invalid of [undefined, NaN, Infinity, -Infinity])
        expect(particleGripControls(invalid, invalid, warm)).toEqual(expected)
    }
  })

  it('bounds manual radius and reach independently without changing fixed choreography', () => {
    expect(particleGripControls(-5, -5, true)).toEqual({
      radius: 0.08,
      maxPull: 0.2,
    })
    expect(particleGripControls(5, 5, true)).toEqual({
      radius: 0.4,
      maxPull: 1.8,
    })
    expect(particleGripControls(0.15, 0.7, false)).toEqual({
      radius: 0.15,
      maxPull: 0.7,
    })
    expect(particleStudyCommand(600).grip?.radius).toBe(0.28)
    expect(particleStudyCommand(600).grip?.target[0]).toBeCloseTo(1.84)
  })
})

describe('particleStudyCommand', () => {
  it('preloads, pulls over four seconds, holds and completely releases at exact ticks', () => {
    expect(particleStudyCommand(0)).toEqual({
      phase: 'settling',
      grip: {
        center: [0.64, 1.24, 0.08],
        target: [0.64, 1.24, 0.08],
        radius: 0.28,
      },
    })
    expect(particleStudyCommand(119).phase).toBe('settling')
    expect(particleStudyCommand(120).phase).toBe('loading')
    expect(particleStudyCommand(120).grip?.target).toEqual([0.64, 1.24, 0.08])
    const middle = particleStudyCommand(360)
    expect(middle.phase).toBe('loading')
    expect(middle.grip?.target).toEqual([1.24, 1.3, 0.12])
    const held = particleStudyCommand(600)
    expect(held.phase).toBe('holding')
    expect(held.grip?.target[0]).toBeCloseTo(1.84, 12)
    expect(held.grip?.target[1]).toBeCloseTo(1.36, 12)
    expect(held.grip?.target[2]).toBeCloseTo(0.16, 12)
    expect(particleStudyCommand(839)).toEqual(held)
    expect(particleStudyCommand(840)).toEqual({ phase: 'recovering' })
    expect(particleStudyCommand(1439)).toEqual({ phase: 'recovering' })
    expect(particleStudyCommand(1440)).toEqual({ phase: 'complete' })
  })

  it('rejects invalid ticks and returns fresh command vectors', () => {
    for (const value of [-1, 1.5, NaN, Infinity])
      expect(() => particleStudyCommand(value)).toThrow(RangeError)
    const command = particleStudyCommand(120)
    command.grip!.center[0] = 9
    command.grip!.target[0] = 9
    expect(PARTICLE_PULL_HANDLE.center).toEqual([0.64, 1.24, 0.08])
    expect(particleStudyCommand(120).grip?.target).toEqual([0.64, 1.24, 0.08])
  })
})

describe('pickParticleGrip', () => {
  it('hits the current body and selects the matching rest-space particle', () => {
    const current = new Float32Array([2, 1, 0, 0, 2, 1, 0, 1, 2, 1, -1, 1])
    const rest = new Float32Array([-5, 0, 0, 0, 0.5, 1, 0, 1, 0.5, 1, -1, 1])
    expect(
      pickParticleGrip(
        { origin: [2, 1, 4], direction: [0, 0, -1] },
        current,
        rest,
        0.1,
      ),
    ).toEqual({
      point: [2, 1, 0],
      grip: { center: [0.5, 1, 0], target: [2, 1, 0], radius: 0.28 },
    })
    expect(
      pickParticleGrip(
        { origin: [0.5, 1, 4], direction: [0, 0, -1] },
        current,
        rest,
        0.1,
      ),
    ).toBeUndefined()
  })

  it('rejects incompatible particle layouts', () => {
    const ray = {
      origin: [0, 0, 4] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    }
    expect(() =>
      pickParticleGrip(ray, new Float32Array(4), new Float32Array(8), 0.1),
    ).toThrow(RangeError)
    expect(() =>
      pickParticleGrip(ray, new Float32Array(3), new Float32Array(3), 0.1),
    ).toThrow(RangeError)
  })
  it('selects a local current-space patch when grabbing separated warm jelly', () => {
    const current = new Float32Array([2, 1, 0, 1])
    const rest = new Float32Array([0.5, 2, 0, 1])
    expect(
      pickParticleGrip(
        { origin: [2, 1, 4], direction: [0, 0, -1] },
        current,
        rest,
        0.1,
        'current',
      ),
    ).toEqual({
      point: [2, 1, 0],
      grip: { center: [2, 1, 0], target: [2, 1, 0], radius: 0.22 },
    })
  })
})
