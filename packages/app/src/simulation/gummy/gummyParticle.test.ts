/** Transfer conservation, objective stress, irreversible softening and actual particle-kernel resolution. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { GUMMY_PARTICLE_BULK, GUMMY_PARTICLE_MAX_AFFINE, GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MAX_SHEAR, GUMMY_PARTICLE_MAX_SPEED, GUMMY_PARTICLE_MAX_VISCOSITY, GUMMY_PARTICLE_MIN_J, GUMMY_PARTICLE_OUTER_DT, gummyParticleCavitatedVolumeState, gummyParticleCavitationReturn, gummyParticleDamage, gummyParticleDamageStretch, gummyParticleDeterminant, gummyParticleFlowStep, gummyParticleGridSpeedLimit, gummyParticleGripOffset, gummyParticleIdentity, gummyParticleMaterial, gummyParticleRelaxation, gummyParticleStress, gummyParticleStretch, gummyParticleViscousSpeedLimit, gummyParticleViscousStress, gummyParticleVolumeState, gummyParticleWarmDamage, gummyParticleWarmStress, gummyParticleWarmVolumetricEnergy, gummyParticleWaveSpeed, gummyParticleWeights, prepareGummyParticles, } from './gummyParticleMath'
import { gummyParticleCaptureGrip, gummyParticleG2P, gummyParticleGridUpdate, gummyParticleP2G, } from './gummyParticleShaders'

const components = (m: d.m3x3f) => m.columns.flatMap((c) => [...c])
const diagonal = (x: number, y: number, z: number) =>
  d.mat3x3f(d.vec3f(x, 0, 0), d.vec3f(0, y, 0), d.vec3f(0, 0, z))

describe('particle jelly continuum', () => {
  it('samples one unsegmented equal-volume mould, with a separate explicit foot fixture', () => {
    const sample = prepareGummyParticles()
    expect(sample.particleCount).toBe(2445)
    const free = prepareGummyParticles({ pinnedFeet: false })
    expect(free.particleCount).toBe(sample.particleCount)
    expect(sample.restVolume).toBeCloseTo(
      sample.particleCount * sample.spacing ** 3,
      10,
    )
    let pinned = 0
    for (let id = 0; id < sample.particleCount; id++) {
      expect([...free.restPositions.slice(id * 4, id * 4 + 3)]).toEqual([
        ...sample.restPositions.slice(id * 4, id * 4 + 3),
      ])
      expect(free.restPositions[id * 4 + 3]).toBe(1)
      if (!sample.restPositions[id * 4 + 3]) {
        expect(sample.restPositions[id * 4 + 1]).toBeLessThan(0.48)
        pinned++
      }
    }
    expect(pinned).toBe(457)
  })

  it('prepares two free blobs with bounds covering the sampled material', () => {
    const sample = prepareGummyParticles({ fixture: 'blobs' })
    expect(sample.pinHeight).toBe(0)
    const ids = Array.from({ length: sample.particleCount }, (_, id) => id)
    expect(ids.every((id) => sample.restPositions[id * 4 + 3] === 1)).toBe(true)
    for (let axis = 0; axis < 3; axis++) {
      const coordinates = ids.map((id) => sample.restPositions[id * 4 + axis]!)
      expect(Math.min(...coordinates)).toBeCloseTo(sample.bounds.min[axis]!, 6)
      expect(Math.max(...coordinates)).toBeCloseTo(sample.bounds.max[axis]!, 6)
    }
  })

  it('bounds the large-strain elastic CFL over every permitted resolution', () => {
    for (const spacing of [0.06, 0.08, 0.12]) {
      const sample = prepareGummyParticles({ spacing })
      const waveSpeed = gummyParticleWaveSpeed()
      expect(waveSpeed).toBeGreaterThan(
        Math.sqrt(800 + 2 * gummyParticleMaterial(0).shearModulus),
      )
      expect(
        (sample.fixedDt * (waveSpeed + GUMMY_PARTICLE_MAX_SPEED)) /
          sample.gridSpacing,
      ).toBeLessThanOrEqual(0.28)
      expect(sample.fixedDt * sample.substeps).toBeCloseTo(
        GUMMY_PARTICLE_OUTER_DT,
        12,
      )
    }
    expect(() => prepareGummyParticles({ spacing: NaN })).toThrow()
    expect(() => prepareGummyParticles({ spacing: 0.02 })).toThrow()
    expect(() => prepareGummyParticles({ pinHeight: Infinity })).toThrow()
  })

  it('bounds nodal extrapolation over the admitted deformation, affine velocity and support', () => {
    for (const spacing of [0.06, 0.08, 0.12]) {
      const sample = prepareGummyParticles({ spacing })
      const radius = 1.5 * Math.sqrt(3) * sample.gridSpacing
      const maxStress =
        GUMMY_PARTICLE_MAX_SHEAR *
          (GUMMY_PARTICLE_MAX_F_NORM ** 2 + Math.sqrt(3)) +
        GUMMY_PARTICLE_BULK *
          Math.sqrt(3) *
          Math.max(
            Math.abs(Math.log(GUMMY_PARTICLE_MIN_J)),
            Math.abs(Math.log(GUMMY_PARTICLE_MAX_J)),
          )
      const extrapolation =
        GUMMY_PARTICLE_MAX_SPEED +
        GUMMY_PARTICLE_MAX_AFFINE * radius +
        (4 * sample.fixedDt * maxStress * radius) / sample.gridSpacing ** 2
      expect(sample.nodalSpeedBound).toBeCloseTo(
        gummyParticleGridSpeedLimit(sample.fixedDt, sample.gridSpacing, 9.81),
        6,
      )
      expect(sample.nodalSpeedBound).toBeGreaterThan(extrapolation)
      expect(sample.nodalSpeedBound).toBeLessThan(extrapolation + 2.01)
    }
  })

  it('quadratic weights conserve mass, linear momentum and the exact affine second moment', () => {
    for (const f of [0.5, 0.62, 0.99, 1.01, 1.49]) {
      const w = gummyParticleWeights(f)
      expect(w.x + w.y + w.z).toBeCloseTo(1, 6)
      expect(
        [...w].reduce((sum, value, i) => sum + value * (i - f), 0),
      ).toBeCloseTo(0, 6)
      expect(
        [...w].reduce((sum, value, i) => sum + value * (i - f) ** 2, 0),
      ).toBeCloseTo(0.25, 6)
      // With affine velocity v + C(x_i-x_p), the weighted grid mean recovers v exactly.
      expect(
        [...w].reduce(
          (sum, value, i) => sum + value * (2.7 + 0.9 * (i - f)),
          0,
        ),
      ).toBeCloseTo(2.7, 6)
    }
  })

  it('has zero rest and rotated-rest stress, and objective principal stretch', () => {
    const rotation = d.mat3x3f(
      d.vec3f(0, 1, 0),
      d.vec3f(-1, 0, 0),
      d.vec3f(0, 0, 1),
    )
    for (const f of [gummyParticleIdentity(), rotation]) {
      expect(components(gummyParticleStress(f, 80, 800, 0))).toEqual(
        Array(9).fill(0),
      )
      expect(gummyParticleStretch(f)).toBeCloseTo(1, 6)
    }
    const stretch = diagonal(2, 1 / Math.sqrt(2), 1 / Math.sqrt(2))
    expect(gummyParticleDeterminant(stretch)).toBeCloseTo(1, 6)
    expect(gummyParticleStretch(stretch)).toBeCloseTo(2, 6)
    expect(gummyParticleStretch(std.mul(rotation, stretch))).toBeCloseTo(2, 6)
    const stress = gummyParticleStress(stretch, 80, 800, 0)
    const expected = std.mul(std.mul(rotation, stress), std.transpose(rotation))
    components(
      gummyParticleStress(std.mul(rotation, stretch), 80, 800, 0),
    ).forEach((v, i) => {
      expect(v).toBeCloseTo(components(expected)[i]!, 6)
    })
  })

  it('keeps hydrostatic compression pressure after complete damage without treating it as tensile damage', () => {
    const compression = diagonal(0.8, 0.8, 0.8)
    const intact = gummyParticleStress(compression, 80, 800, 0)
    const damaged = gummyParticleStress(compression, 80, 800, 1)
    expect(damaged.columns[0].x).toBeLessThan(-500)
    expect(intact.columns[0].x).toBeLessThan(damaged.columns[0].x)
    expect(gummyParticleStretch(compression)).toBeCloseTo(1, 6)
    expect(gummyParticleDamage(0, gummyParticleStretch(compression))).toBe(0)
    expect(gummyParticleDamage(0, 1.5)).toBe(0)
    expect(gummyParticleDamage(0, 2.1)).toBeGreaterThan(0)
    expect(gummyParticleDamage(0.7, 1)).toBe(0.7)
    expect(gummyParticleDamage(0.7, 3)).toBe(1)
  })

  it('matches the elastic energy derivative under an arbitrary incremental spatial deformation', () => {
    const f = d.mat3x3f(
      d.vec3f(1.2, 0.1, -0.1),
      d.vec3f(0.3, 0.9, 0.2),
      d.vec3f(0.1, -0.2, 1.1),
    )
    const mu = 80
    const bulk = 800
    const energy = (m: d.m3x3f) => {
      const logJ = Math.log(gummyParticleDeterminant(m))
      const norm = components(m).reduce((sum, v) => sum + v * v, 0)
      return (mu * (norm - 3)) / 2 - mu * logJ + (bulk * logJ ** 2) / 2
    }
    const stress = gummyParticleStress(f, mu, bulk, 0)
    const epsilon = 0.002
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 3; row++) {
        const plus = gummyParticleIdentity()
        const minus = gummyParticleIdentity()
        plus.columns[col]![row]! += epsilon
        minus.columns[col]![row]! -= epsilon
        const finiteDifference =
          (energy(std.mul(plus, f)) - energy(std.mul(minus, f))) / (2 * epsilon)
        expect(
          Math.abs(finiteDifference - stress.columns[col]![row]!),
        ).toBeLessThan(0.04)
      }
  })

  it('removes tensile bulk cohesion only for warm damage while preserving compression', () => {
    const expanded = diagonal(1.2, 1.2, 1.2)
    const compressed = diagonal(0.8, 0.8, 0.8)
    expect(components(gummyParticleWarmStress(expanded, 80, 800, 1))).toEqual(
      Array(9).fill(0),
    )
    expect(
      gummyParticleStress(expanded, 80, 800, 1).columns[0].x,
    ).toBeGreaterThan(400)
    const remaining = (1 - 0.4) ** 2
    expect(
      gummyParticleWarmStress(expanded, 0, 800, 0.4).columns[0].x,
    ).toBeCloseTo(remaining * 800 * Math.log(1.2 ** 3), 4)
    for (const damage of [0, 0.4, 1])
      expect(
        gummyParticleWarmStress(compressed, 0, 800, damage).columns[0].x,
      ).toBeCloseTo(800 * Math.log(0.8 ** 3), 3)
  })

  it('returns fully softened void dilation to zero pressure without deleting compression memory', () => {
    const expanded = diagonal(2.2, 1.8, 1.5)
    const compressed = diagonal(0.8, 0.8, 0.8)
    const returned = gummyParticleCavitatedVolumeState(expanded)
    expect(components(returned)).toEqual(components(gummyParticleIdentity()))
    expect(
      gummyParticleDeterminant(gummyParticleCavitatedVolumeState(compressed)),
    ).toBeCloseTo(0.8 ** 3, 6)
    expect(
      gummyParticleWarmVolumetricEnergy(
        Math.log(gummyParticleDeterminant(expanded)),
        800,
        1,
      ),
    ).toBe(0)
    expect(
      gummyParticleWarmVolumetricEnergy(Math.log(0.8 ** 3), 800, 1),
    ).toBeCloseTo(400 * Math.log(0.8 ** 3) ** 2, 5)
  })

  it('returns partial-damage expansion to its tensile yield surface before the elastic safety limit', () => {
    const expanded = diagonal(2.2, 1.8, 1.5)
    const compressed = diagonal(0.8, 0.9, 0.8)
    for (const damage of [0, 0.25, 0.9, 1]) {
      const returned = gummyParticleCavitationReturn(expanded, damage)
      const f = d.mat3x3f(returned.column0, returned.column1, returned.column2)
      expect(gummyParticleDeterminant(f)).toBeCloseTo(1.35 ** (1 - damage), 5)
      expect(gummyParticleStretch(f)).toBeCloseTo(
        gummyParticleStretch(expanded),
        5,
      )
      expect(returned.opening).toBeCloseTo(
        Math.log(gummyParticleDeterminant(expanded)) -
          (1 - damage) * Math.log(1.35),
        5,
      )
      const unchanged = gummyParticleCavitationReturn(compressed, damage)
      expect(
        components(
          d.mat3x3f(unchanged.column0, unchanged.column1, unchanged.column2),
        ),
      ).toEqual(components(compressed))
      expect(unchanged.opening).toBe(0)
    }
  })

  it('keeps volumetric cavitation objective and dissipative rather than hiding a numerical rejection', () => {
    const rotation = d.mat3x3f(
      d.vec3f(0, 1, 0),
      d.vec3f(-1, 0, 0),
      d.vec3f(0, 0, 1),
    )
    const original = diagonal(2.2, 1.8, 1.5)
    for (const damage of [0, 0.25, 0.9, 1]) {
      const a = gummyParticleCavitationReturn(original, damage)
      const b = gummyParticleCavitationReturn(
        std.mul(rotation, original),
        damage,
      )
      const returned = d.mat3x3f(a.column0, a.column1, a.column2)
      const expected = components(std.mul(rotation, returned))
      components(d.mat3x3f(b.column0, b.column1, b.column2)).forEach((v, i) => {
        expect(v).toBeCloseTo(expected[i]!, 6)
      })
      expect(b.opening).toBeCloseTo(a.opening, 6)
      const energy = (f: d.m3x3f) => {
        const logJ = Math.log(gummyParticleDeterminant(f))
        const mu = 80 * (1 - damage) ** 2
        return (
          (mu *
            (components(f).reduce((sum, value) => sum + value * value, 0) -
              3)) /
            2 -
          mu * logJ +
          gummyParticleWarmVolumetricEnergy(logJ, 800, damage)
        )
      }
      // At unit volume, f32 rescaling can leave a tiny compressive energy from roundoff.
      expect(energy(returned) - energy(original)).toBeLessThanOrEqual(1e-9)
    }
  })

  it('matches warm tensile/compressive stress to the energy reported by solver diagnostics', () => {
    const mu = 80
    const bulk = 800
    for (const f of [diagonal(1.3, 1.1, 0.9), diagonal(0.8, 0.9, 0.9)])
      for (const damage of [0, 0.4, 1]) {
        const shear = mu * (1 - damage) ** 2
        const energy = (m: d.m3x3f) => {
          const logJ = Math.log(gummyParticleDeterminant(m))
          const norm = components(m).reduce(
            (sum, value) => sum + value * value,
            0,
          )
          return (
            (shear * (norm - 3)) / 2 -
            shear * logJ +
            gummyParticleWarmVolumetricEnergy(logJ, bulk, damage)
          )
        }
        const stress = gummyParticleWarmStress(f, mu, bulk, damage)
        const epsilon = 0.001
        for (let axis = 0; axis < 3; axis++) {
          const plus = gummyParticleIdentity()
          const minus = gummyParticleIdentity()
          plus.columns[axis]![axis]! += epsilon
          minus.columns[axis]![axis]! -= epsilon
          const derivative =
            (energy(std.mul(plus, f)) - energy(std.mul(minus, f))) /
            (2 * epsilon)
          expect(
            Math.abs(derivative - stress.columns[axis]![axis]!),
          ).toBeLessThan(0.04)
        }
      }
  })

  it('retains volume and identical pressure when fully damaged material discards shear memory', () => {
    const f = d.mat3x3f(
      d.vec3f(4, 0.2, 0),
      d.vec3f(0.3, 0.45, 0.1),
      d.vec3f(0, -0.15, 0.7),
    )
    const reduced = gummyParticleVolumeState(f)
    expect(gummyParticleDeterminant(reduced)).toBeCloseTo(
      gummyParticleDeterminant(f),
      5,
    )
    const before = components(gummyParticleStress(f, 80, 800, 1))
    components(gummyParticleStress(reduced, 80, 800, 1)).forEach(
      (value, id) => {
        expect(value).toBeCloseTo(before[id]!, 2)
      },
    )
    expect(gummyParticleStretch(reduced)).toBeCloseTo(1, 5)
  })

  it('preserves volume and rigid rotation while warm creep dissipates elastic shape energy', () => {
    const rotation = d.mat3x3f(
      d.vec3f(0, 1, 0),
      d.vec3f(-1, 0, 0),
      d.vec3f(0, 0, 1),
    )
    const spinOnly = gummyParticleRelaxation(rotation, 0.1, 12, 1)
    components(spinOnly).forEach((value, i) => {
      expect(value).toBeCloseTo(components(rotation)[i]!, 6)
    })
    for (const stretch of [1.01, 1.4, 2, 4]) {
      const f = diagonal(
        stretch,
        0.8 / Math.sqrt(stretch),
        1.2 / Math.sqrt(stretch),
      )
      const relaxed = gummyParticleRelaxation(f, 1 / 3500, 12, 1)
      expect(gummyParticleDeterminant(relaxed)).toBeCloseTo(
        gummyParticleDeterminant(f),
        6,
      )
      const norm = (m: d.m3x3f) =>
        components(m).reduce((sum, v) => sum + v * v, 0)
      // J is unchanged, so the NH energy change is exactly mu/2 times this trace difference.
      expect(norm(relaxed)).toBeLessThan(norm(f))
      const rotated = gummyParticleRelaxation(
        std.mul(rotation, f),
        1 / 3500,
        12,
        1,
      )
      const expected = components(std.mul(rotation, relaxed))
      components(rotated).forEach((value, i) => {
        expect(value).toBeCloseTo(expected[i]!, 6)
      })
    }
    const compressed = diagonal(0.7, 0.7, 0.7)
    components(gummyParticleRelaxation(compressed, 0.1, 12, 1)).forEach(
      (value, i) => {
        expect(value).toBeCloseTo(components(compressed)[i]!, 6)
      },
    )
  })

  it('keeps warm creep inactive below yield and converges with microstep refinement', () => {
    const initial = diagonal(1.7, 1 / Math.sqrt(1.7), 1 / Math.sqrt(1.7))
    expect(components(gummyParticleRelaxation(initial, 0.1, 12, 0))).toEqual(
      components(initial),
    )
    const integrate = (steps: number) => {
      let f = initial
      for (let i = 0; i < steps; i++)
        f = gummyParticleRelaxation(f, 0.1 / steps, 12, 1)
      return f
    }
    const coarse = integrate(200)
    const fine = integrate(400)
    expect(gummyParticleDeterminant(fine)).toBeCloseTo(1, 4)
    components(coarse).forEach((value, i) => {
      expect(value).toBeCloseTo(components(fine)[i]!, 3)
    })
    expect(gummyParticleStretch(fine)).toBeLessThan(1.5)
  })

  it('tracks objective plastic strain from the actual isochoric update rather than losing it during creep', () => {
    const rotation = d.mat3x3f(
      d.vec3f(0, 1, 0),
      d.vec3f(-1, 0, 0),
      d.vec3f(0, 0, 1),
    )
    const f = diagonal(1.3, 1 / Math.sqrt(1.3), 1 / Math.sqrt(1.3))
    const result = gummyParticleFlowStep(f, 1 / 3500, 12, 1)
    const exactUniaxialIncrement = Math.log(f.columns[0].x / result.column0.x)
    expect(result.plasticStrain).toBeCloseTo(exactUniaxialIncrement, 6)
    expect(
      gummyParticleFlowStep(std.mul(rotation, f), 1 / 3500, 12, 1)
        .plasticStrain,
    ).toBeCloseTo(result.plasticStrain, 6)
    expect(
      gummyParticleFlowStep(rotation, 1 / 3500, 12, 1).plasticStrain,
    ).toBeCloseTo(0, 7)
    expect(
      gummyParticleFlowStep(diagonal(0.8, 0.8, 0.8), 1 / 3500, 12, 1)
        .plasticStrain,
    ).toBeCloseTo(0, 7)
  })

  it('lets a sustained modest yielded neck soften while sub-yield rest stays intact', () => {
    const material = gummyParticleMaterial(0.55, 'warm', 0.88)
    const elasticStretch = 1.115
    const f = diagonal(
      elasticStretch,
      1 / Math.sqrt(elasticStretch),
      1 / Math.sqrt(elasticStretch),
    )
    const dt = 1 / 3500
    const activation =
      (elasticStretch - material.yieldStretch) / (elasticStretch - 1)
    let accumulated = 0
    let damage = 0
    for (let i = 0; i < 2800; i++) {
      const yielded = gummyParticleFlowStep(
        f,
        dt,
        material.relaxationRate,
        activation,
      )
      accumulated += yielded.plasticStrain
      damage = gummyParticleWarmDamage(
        damage,
        gummyParticleDamageStretch(elasticStretch, elasticStretch, accumulated),
        dt,
        material.damageRate,
        material.damageOnset,
        material.damageComplete,
      )
    }
    expect(accumulated).toBeGreaterThan(0.1)
    expect(damage).toBeGreaterThan(0.2)
    expect(damage).toBeLessThan(0.9)
    expect(
      gummyParticleWarmDamage(
        0,
        gummyParticleDamageStretch(1.04, 1.04, 0),
        1,
        material.damageRate,
        material.damageOnset,
        material.damageComplete,
      ),
    ).toBe(0)
    expect(gummyParticleDamageStretch(1.1, 1.1, 1000)).toBeLessThan(9)
  })

  it('allows yielded shape flow with damage disabled while retaining bulk resistance', () => {
    const material = gummyParticleMaterial(0.55, 'warm')
    const f = diagonal(1.4, 0.8, 0.9)
    const stretch = gummyParticleStretch(f)
    const activation = (stretch - material.yieldStretch) / (stretch - 1)
    const relaxed = gummyParticleRelaxation(
      f,
      0.01,
      material.relaxationRate,
      activation,
    )
    const before = gummyParticleStress(
      f,
      material.shearModulus,
      material.bulkModulus,
      0,
    )
    const after = gummyParticleStress(
      relaxed,
      material.shearModulus,
      material.bulkModulus,
      0,
    )
    expect(after.columns[0].x).toBeLessThan(before.columns[0].x)
    const beforeBulk = gummyParticleStress(f, 0, material.bulkModulus, 0)
    const afterBulk = gummyParticleStress(relaxed, 0, material.bulkModulus, 0)
    components(afterBulk).forEach((value, i) => {
      expect(value).toBeCloseTo(components(beforeBulk)[i]!, 4)
    })
  })

  it('softens short warm pulls irreversibly with a microstep-independent material time scale', () => {
    const warm = gummyParticleMaterial(0.55, 'warm', 0.75)
    const update = (previous: number, dt: number, stretch = 1.5) =>
      gummyParticleWarmDamage(
        previous,
        stretch,
        dt,
        warm.damageRate,
        warm.damageOnset,
        warm.damageComplete,
      )
    const full = update(0, 0.1)
    let stepped = 0
    for (let i = 0; i < 100; i++) stepped = update(stepped, 0.001)
    expect(full).toBeCloseTo(1 - Math.exp(-2.1), 6)
    expect(stepped).toBeCloseTo(full, 6)
    expect(update(full, 0.1, 1)).toBe(full)
    expect(gummyParticleDamage(0, 1.5)).toBe(0)
    expect(update(0, 0.1, 1)).toBe(0)
  })

  it('reaches the zero-shear phase after complete softening without saturating partial damage', () => {
    let damage = 0
    for (let i = 0; i < 4000; i++)
      damage = gummyParticleWarmDamage(damage, 2, 1 / 4000, 21, 1.18, 1.5)
    expect(damage).toBe(1)
    expect(gummyParticleWarmDamage(0.999, 1.49, 1, 21, 1.18, 1.5)).toBeLessThan(
      1,
    )
    for (const previous of [0, 0.3, 1])
      for (const stretch of [1, 1.3, 2]) {
        const next = gummyParticleWarmDamage(
          previous,
          stretch,
          1,
          21,
          1.18,
          1.5,
        )
        expect(next).toBeGreaterThanOrEqual(previous)
        expect(next).toBeLessThanOrEqual(1)
      }
  })

  it('preserves pointer motion arriving before current-space grip capture', () => {
    const particle = d.vec3f(1.1, 0.2, 0.3)
    const picked = d.vec3f(1, 0.2, 0.3)
    const movedPointer = d.vec3f(1.4, 0.5, 0.3)
    const offset = gummyParticleGripOffset(particle, picked, movedPointer, 1)
    expect([...std.add(movedPointer, offset)]).toEqual([
      ...d.vec3f(1.5, 0.5, 0.3),
    ])
    // Existing rest-space scripts capture around their initial target and keep their original contract.
    const baseline = gummyParticleGripOffset(particle, picked, movedPointer, 0)
    for (let axis = 0; axis < 3; axis++)
      expect(std.add(movedPointer, baseline)[axis]).toBeCloseTo(
        particle[axis]!,
        6,
      )
  })

  it('adds dissipative viscosity without resistance to rigid spin or volume change', () => {
    const rotationRate = d.mat3x3f(
      d.vec3f(0, 3, 0),
      d.vec3f(-3, 0, 0),
      d.vec3f(0, 0, 0),
    )
    expect(
      components(gummyParticleViscousStress(rotationRate, 1.2, 1)),
    ).toEqual(Array(9).fill(0))
    expect(
      components(gummyParticleViscousStress(diagonal(2, 2, 2), 1, 1)),
    ).toEqual(Array(9).fill(0))
    const strainRate = diagonal(2, -1, -1)
    expect(
      components(gummyParticleViscousStress(strainRate, 1.2, 0.5)),
    ).toEqual(components(diagonal(2.4, -1.2, -1.2)))
    const stress = gummyParticleViscousStress(strainRate, 1.2, 0.5)
    const dissipatedPower = components(stress).reduce(
      (sum, value, i) => sum + value * components(strainRate)[i]!,
      0,
    )
    expect(dissipatedPower).toBeCloseTo(7.2, 6)
  })

  it('bounds warm viscous diffusion separately while retaining the original elastic material', () => {
    const baseline = gummyParticleMaterial(0.55)
    expect(baseline.shearModulus).toBe(350 * 0.35 ** 0.55)
    expect(baseline.viscosity).toBe(0)
    expect(baseline.relaxationRate).toBe(0)
    for (const spacing of [0.06, 0.08, 0.12]) {
      const geometry = prepareGummyParticles({ spacing })
      // Explicit deviatoric viscous diffusion: conservative 3D 12 eta J dt/(rho0 dx²) bound.
      expect(
        (12 *
          GUMMY_PARTICLE_MAX_VISCOSITY *
          GUMMY_PARTICLE_MAX_J *
          geometry.fixedDt) /
          geometry.gridSpacing ** 2,
      ).toBeLessThan(1)
      const limit = gummyParticleViscousSpeedLimit(
        geometry.fixedDt,
        geometry.gridSpacing,
        GUMMY_PARTICLE_MAX_VISCOSITY,
        9.81,
      )
      expect(limit).toBeGreaterThan(geometry.nodalSpeedBound)
      expect(
        gummyParticleViscousSpeedLimit(
          geometry.fixedDt,
          geometry.gridSpacing,
          0,
          9.81,
        ),
      ).toBe(geometry.nodalSpeedBound)
    }
  })

  it('decodes node coordinates with exact u32 division in the emitted grid kernel', () => {
    const wgsl = tgpu.resolve([gummyParticleGridUpdate], { names: 'strict' })
    // Native GPU evidence: f32(48) / f32(48) can round below one and truncate to row zero.
    expect(wgsl.includes('f32(gid.x)')).toBe(false)
    expect(wgsl).toContain('gummyParticleGridCoordinates(gid.x, n)')
    const helper = wgsl.match(
      /fn gummyParticleGridCoordinates\(id: u32, n: u32\) -> vec3i \{([^}]+)\}/,
    )?.[1]
    expect(helper?.replace(/\s+/g, ' ').trim()).toBe(
      'return vec3i(i32(id % n), i32((id / n) % n), i32(id / (n * n)));',
    )
  })

  it('copies rejected deformation through scalar components for Metal storage compatibility', () => {
    const wgsl = tgpu.resolve([gummyParticleG2P], { names: 'strict' })
    // iOS rejects a Metal matrix constructor fed PackedVec3 storage columns.
    // Check actual emitted scalar arguments and column order, not TS source syntax.
    const copy = [
      ...wgsl.matchAll(/deformation = mat3x3f\(([^;\n]+)\);/g),
    ].find((match) => match[1]?.includes('(*previous).deformation'))?.[1]
    expect(copy?.split(',').map((value) => value.trim())).toEqual(
      [0, 1, 2].flatMap((column) =>
        ['x', 'y', 'z'].map(
          (axis) => `(*previous).deformation[${column}i].${axis}`,
        ),
      ),
    )
  })

  it('resolves the actual 3D transfer, material, grid contact and grip kernels', () => {
    for (const shader of [
      gummyParticleCaptureGrip,
      gummyParticleP2G,
      gummyParticleGridUpdate,
      gummyParticleG2P,
    ]) {
      const wgsl = tgpu.resolve([shader], { names: 'strict' })
      expect(wgsl).toContain('@compute @workgroup_size(64)')
      expect(wgsl).not.toContain('atomic<f32>')
    }
  })
})
