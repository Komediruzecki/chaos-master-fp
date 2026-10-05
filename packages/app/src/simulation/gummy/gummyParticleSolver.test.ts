/** Verify live controls reach the production particle uniform and preserve the solver's calibrated defaults. */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GUMMY_PARTICLE_TUNING, GUMMY_PARTICLE_OUTER_DT, gummyParticleViscousSpeedLimit, } from './gummyParticleMath'
import { GummyParticleParameters } from './gummyParticleShaders'
import { createGummyParticleSolver } from './gummyParticleSolver'
import type { d, TgpuRoot } from 'typegpu'
import type { GummyParticleStep } from './gummyParticleSolver'

function setup() {
  const writes: Float32Array[] = []
  const device = {
    createCommandEncoder: () => ({
      clearBuffer: () => {},
      beginComputePass: () => ({ end: () => {} }),
      finish: () => ({}),
    }),
    queue: { submit: vi.fn() },
  }
  const root = {
    device,
    createBuffer(schema: Parameters<typeof d.sizeOf>[0], initial?: unknown) {
      const buffer = {
        destroy: vi.fn(),
        write(data: ArrayBuffer) {
          if (schema === GummyParticleParameters)
            writes.push(new Float32Array(data.slice(0)))
        },
        $usage: () => buffer,
      }
      if (typeof initial === 'function') initial(buffer)
      return buffer
    },
    createBindGroup: () => ({}),
    createComputePipeline: () => {
      const pipeline = {
        with: () => pipeline,
        dispatchWorkgroups: () => {},
      }
      return pipeline
    },
    unwrap: (resource: unknown) => resource,
  }
  const solver = createGummyParticleSolver(
    root as unknown as TgpuRoot,
    device as unknown as GPUDevice,
    { spacing: 0.12 },
  )
  return {
    solver,
    write: (input: Partial<GummyParticleStep> = {}) => {
      expect(
        solver.step(GUMMY_PARTICLE_OUTER_DT, {
          softness: 0.55,
          tearing: true,
          particleMaterial: 'warm',
          ...input,
        }),
      ).toBe(1)
      return writes.at(-1)!
    },
  }
}

describe('particle solver tuning uniforms', () => {
  it('uploads the optional collider and clears it completely for existing study steps', () => {
    const { solver, write } = setup()
    const baseline = write()
    expect([...baseline.slice(44, 52)]).toEqual(Array(8).fill(0))
    const active = write({
      collider: {
        position: [-2.3, 3.1, 0],
        velocity: [0, -2, 0],
        friction: 0.7,
      },
    })
    expect(active[44]).toBeCloseTo(-2.3)
    expect(active[45]).toBeCloseTo(3.1)
    expect([...active.slice(46, 51)]).toEqual([0, 1, 0, -2, 0])
    expect(active[51]).toBeCloseTo(0.7)
    expect(active.slice(0, 44)).toEqual(baseline.slice(0, 44))
    expect(write()).toEqual(baseline)
    solver.destroy()
  })

  it.each(['elastic', 'warm'] as const)(
    'preserves the complete %s uniform when tuning is omitted or reset',
    (particleMaterial) => {
      const { solver, write } = setup()
      const omitted = write({ particleMaterial })
      const explicit = write({
        particleMaterial,
        tuning: DEFAULT_GUMMY_PARTICLE_TUNING,
      })
      expect(explicit).toEqual(omitted)
      expect(omitted[31]).toBeCloseTo(9.81)
      expect(omitted[37]).toBe(particleMaterial === 'warm' ? 2400 : 4000)
      expect(omitted[38]).toBe(particleMaterial === 'warm' ? 90 : 80)
      expect(omitted[39]).toBe(5)
      expect(omitted[35]).toBe(particleMaterial === 'warm' ? 1 : 0)
      solver.destroy()
    },
  )

  it('updates all physical controls live and uses their gravity and viscosity in the nodal bound', () => {
    const { solver, write } = setup()
    const baseline = write()
    const tuned = write({
      tuning: {
        grabStrength: 0.25,
        flow: 0.2,
        gravity: 0.5,
        floorDrag: 3,
        viscosity: 0.4,
      },
    })
    expect(tuned[31]).toBeCloseTo(4.905)
    expect(tuned[33]).toBeCloseTo((7 + 7 * 0.55) * 0.2)
    expect(tuned[35]).toBeCloseTo(0.4)
    expect(tuned[37]).toBe(600)
    expect(tuned[38]).toBe(45)
    expect(tuned[39]).toBe(3)
    expect(tuned[4]).toBe(baseline[4])
    expect(tuned[5]).toBe(baseline[5])
    expect(tuned[34]).toBe(baseline[34])
    expect([...tuned.slice(40, 43)]).toEqual([...baseline.slice(40, 43)])
    expect(solver.nodalSpeedBound).toBeCloseTo(
      gummyParticleViscousSpeedLimit(
        solver.fixedDt,
        solver.gridSpacing,
        0.4,
        4.905,
      ),
      10,
    )
    expect(write()).toEqual(baseline)
    solver.destroy()
  })

  it('rejects non-finite controls through defaults and clamps physical coefficients before uploading', () => {
    const { solver, write } = setup()
    const values = write({
      tuning: {
        grabStrength: -1,
        flow: NaN,
        gravity: 100,
        floorDrag: Infinity,
        viscosity: 100,
      },
    })
    expect([...values].every(Number.isFinite)).toBe(true)
    expect(values[31]).toBeCloseTo(14.715)
    expect(values[33]).toBeCloseTo(7 + 7 * 0.55)
    expect(values[35]).toBe(1)
    expect(values[37]).toBe(240)
    expect(values[38]).toBeCloseTo(90 * Math.sqrt(0.1))
    expect(values[39]).toBe(5)
    const highGravityBound = solver.nodalSpeedBound
    write()
    expect(highGravityBound).toBeGreaterThan(solver.nodalSpeedBound)
    solver.destroy()
  })
})
