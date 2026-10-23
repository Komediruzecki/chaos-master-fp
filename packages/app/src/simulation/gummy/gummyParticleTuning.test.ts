/** Live material controls preserve the calibrated default and the solver's physical bounds. */
import { describe, expect, it } from 'vitest'
import { GUMMY_PARTICLE_BULK, GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MAX_SHEAR, GUMMY_PARTICLE_MAX_VISCOSITY, gummyParticleGridSpeedLimit, gummyParticleMaterial, gummyParticleViscousSpeedLimit, prepareGummyParticles, } from './gummyParticleMath'
import { DEFAULT_GUMMY_PARTICLE_TUNING, GUMMY_PARTICLE_TUNING_RANGES, normalizeGummyParticleTuning, } from './gummyParticleTuning'
import type { GummyParticleTuning } from './gummyParticleTuning'

describe('particle jelly live tuning', () => {
  it('fills partial input without mutating defaults and bounds every finite control', () => {
    expect(normalizeGummyParticleTuning()).toEqual(
      DEFAULT_GUMMY_PARTICLE_TUNING,
    )
    expect(normalizeGummyParticleTuning({ flow: 0.4 })).toEqual({
      ...DEFAULT_GUMMY_PARTICLE_TUNING,
      flow: 0.4,
    })
    for (const key of Object.keys(
      GUMMY_PARTICLE_TUNING_RANGES,
    ) as (keyof GummyParticleTuning)[]) {
      const { min, max } = GUMMY_PARTICLE_TUNING_RANGES[key]
      expect(normalizeGummyParticleTuning({ [key]: -100 })[key]).toBe(min)
      expect(normalizeGummyParticleTuning({ [key]: 100 })[key]).toBe(max)
      for (const invalid of [NaN, Infinity, -Infinity])
        expect(normalizeGummyParticleTuning({ [key]: invalid })[key]).toBe(
          DEFAULT_GUMMY_PARTICLE_TUNING[key],
        )
    }
    const mutable = normalizeGummyParticleTuning()
    mutable.floorDrag = 0
    expect(DEFAULT_GUMMY_PARTICLE_TUNING.floorDrag).toBe(5)
  })

  it.each(['elastic', 'warm'] as const)(
    'keeps the %s baseline unchanged when controls are omitted or reset',
    (mode) => {
      const material = gummyParticleMaterial(0.55, mode, 0.75)
      expect(
        gummyParticleMaterial(0.55, mode, 0.75, DEFAULT_GUMMY_PARTICLE_TUNING),
      ).toEqual(material)
      expect(material).toMatchObject({
        shearModulus:
          GUMMY_PARTICLE_MAX_SHEAR * 0.35 ** 0.55 * (mode === 'warm' ? 0.7 : 1),
        bulkModulus: GUMMY_PARTICLE_BULK,
        relaxationRate: mode === 'warm' ? 7 + 7 * 0.55 : 0,
        damageRate: mode === 'warm' ? 12 + 12 * 0.75 : 0,
        viscosity: mode === 'warm' ? GUMMY_PARTICLE_MAX_VISCOSITY : 0,
        gripStiffness: mode === 'warm' ? 2400 : 4000,
        gripDamping: mode === 'warm' ? 90 : 80,
        gravity: 9.81,
        floorDrag: 5,
      })
    },
  )

  it('weakens the grip without changing its damping ratio or the material modulus', () => {
    for (const mode of ['elastic', 'warm'] as const) {
      const baseline = gummyParticleMaterial(0.55, mode, 0.75)
      const tuned = gummyParticleMaterial(0.55, mode, 0.75, {
        grabStrength: 0.25,
      })
      expect(tuned.gripStiffness).toBe(baseline.gripStiffness * 0.25)
      expect(tuned.gripDamping).toBe(baseline.gripDamping * 0.5)
      expect(tuned.gripDamping / Math.sqrt(tuned.gripStiffness)).toBeCloseTo(
        baseline.gripDamping / Math.sqrt(baseline.gripStiffness),
        10,
      )
      expect(tuned.shearModulus).toBe(baseline.shearModulus)
      expect(tuned.bulkModulus).toBe(baseline.bulkModulus)
    }
  })

  it('can stop warm flow and viscosity without altering softness or fragility', () => {
    const baseline = gummyParticleMaterial(0.2, 'warm', 0.9)
    const tuned = gummyParticleMaterial(0.2, 'warm', 0.9, {
      flow: 0,
      viscosity: 0,
      floorDrag: 0,
      gravity: 0,
    })
    expect(tuned).toEqual({
      ...baseline,
      relaxationRate: 0,
      viscosity: 0,
      floorDrag: 0,
      gravity: 0,
    })
    expect(
      gummyParticleMaterial(0.2, 'warm', 0.9, { flow: 0.25 }).relaxationRate,
    ).toBe(baseline.relaxationRate * 0.25)
    expect(
      gummyParticleMaterial(0.2, 'elastic', 0.9, { flow: 1, viscosity: 1 }),
    ).toMatchObject({ relaxationRate: 0, viscosity: 0 })
  })

  it('keeps the explicit viscous timestep stable at every allowed resolution and maximum tuning', () => {
    const tuned = gummyParticleMaterial(0, 'warm', 1, {
      viscosity: 100,
      gravity: 100,
      grabStrength: 100,
    })
    expect(tuned.viscosity).toBe(GUMMY_PARTICLE_MAX_VISCOSITY)
    expect(tuned.gravity).toBe(9.81 * 1.5)
    expect(tuned.shearModulus).toBeLessThanOrEqual(GUMMY_PARTICLE_MAX_SHEAR)
    expect(tuned.gripStiffness).toBe(2400)
    for (const spacing of [0.06, 0.08, 0.12]) {
      const { fixedDt, gridSpacing } = prepareGummyParticles({ spacing })
      expect(
        (12 * tuned.viscosity * GUMMY_PARTICLE_MAX_J * fixedDt) /
          gridSpacing ** 2,
      ).toBeLessThan(1)
      const baseline = gummyParticleGridSpeedLimit(fixedDt, gridSpacing, 9.81)
      const strongerGravity = gummyParticleGridSpeedLimit(
        fixedDt,
        gridSpacing,
        tuned.gravity,
      )
      expect(strongerGravity).toBeGreaterThan(baseline)
      expect(strongerGravity - baseline).toBeCloseTo(
        (tuned.gravity - 9.81) * fixedDt,
        8,
      )
      expect(
        gummyParticleViscousSpeedLimit(fixedDt, gridSpacing, 0, tuned.gravity),
      ).toBe(strongerGravity)
      expect(
        gummyParticleViscousSpeedLimit(
          fixedDt,
          gridSpacing,
          tuned.viscosity,
          tuned.gravity,
        ),
      ).toBeGreaterThan(strongerGravity)
    }
  })
})
