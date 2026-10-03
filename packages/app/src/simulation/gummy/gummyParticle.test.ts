/** Transfer conservation, objective stress, irreversible softening and actual particle-kernel resolution. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { GUMMY_PARTICLE_BULK, GUMMY_PARTICLE_MAX_AFFINE, GUMMY_PARTICLE_MAX_F_NORM, GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MAX_SHEAR, GUMMY_PARTICLE_MAX_SPEED, GUMMY_PARTICLE_MIN_J, GUMMY_PARTICLE_OUTER_DT, gummyParticleDamage, gummyParticleDeterminant, gummyParticleGridSpeedLimit, gummyParticleIdentity, gummyParticleMaterial, gummyParticleStress, gummyParticleStretch, gummyParticleVolumeState, gummyParticleWaveSpeed, gummyParticleWeights, prepareGummyParticles, } from './gummyParticleMath'
import { gummyParticleCaptureGrip, gummyParticleG2P, gummyParticleGridUpdate, gummyParticleP2G, } from './gummyParticleShaders'

const components = (m: d.m3x3f) => m.columns.flatMap((c) => [...c])
const diagonal = (x: number, y: number, z: number) =>
  d.mat3x3f(d.vec3f(x, 0, 0), d.vec3f(0, y, 0), d.vec3f(0, 0, z))

describe('particle jelly continuum', () => {
  it('samples one unsegmented equal-volume mould, with a separate explicit foot fixture', () => {
    const sample = prepareGummyParticles()
    expect(sample.particleCount).toBeGreaterThan(1500)
    expect(sample.particleCount).toBeLessThan(4500)
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
        gummyParticleGridSpeedLimit(sample.fixedDt, sample.gridSpacing),
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
