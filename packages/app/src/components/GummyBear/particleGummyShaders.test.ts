/** Compile particle GPU passes and independently test support gaps and occupied-volume optics. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { PARTICLE_GUMMY_DENSITY_ISO, PARTICLE_GUMMY_RADIUS_SCALE, particleBoundaryNormal, particleDensitySurface, particleDensitySurfaceWithFallback, particleDepthWeight, particleEdgeNormal, particleKernelDensity, particleKernelNormal, particleMeanDye, particleOpticalScale, particleSmoothChord, particleSphereInterval, particleVolumeWeight, } from './particleGummyMath'
import { particleGummyComposite, particleGummyDepthFragment, particleGummyFilterHorizontal, particleGummyFilterVertical, particleGummyOpticalFragment, particleGummyShadowFragment, particleGummyShadowVertex, particleGummyVertex, } from './particleGummyShaders'
import { particleGummyFarProfileFragment, particleGummyNormalFragment, particleGummySurfaceFragment, } from './particleGummySurfaceShaders'

describe('particle gummy native surface', () => {
  it.each([
    particleGummyVertex,
    particleGummyDepthFragment,
    particleGummyOpticalFragment,
    particleGummySurfaceFragment,
    particleGummyNormalFragment,
    particleGummyFarProfileFragment,
    particleGummyFilterHorizontal,
    particleGummyFilterVertical,
    particleGummyComposite,
    particleGummyShadowVertex,
    particleGummyShadowFragment,
  ])('resolves a real GPU entrypoint', (shader) => {
    const source = tgpu.resolve([shader], { names: 'strict' })
    expect(source).toMatch(/@(vertex|fragment)/)
    expect(source).not.toContain('NaN')
  })

  it('intersects analytic sphere fronts and clips spheres behind the eye', () => {
    const eye = d.vec3f(0, 0, 5)
    const ray = d.vec3f(0, 0, -1)
    const hit = particleSphereInterval(eye, ray, d.vec3f(0), 1)
    expect([hit.x, hit.y]).toEqual([4, 6])
    const tangent = particleSphereInterval(eye, ray, d.vec3f(1, 0, 0), 1)
    expect([tangent.x, tangent.y]).toEqual([0, 0])
    const missed = particleSphereInterval(eye, ray, d.vec3f(1.01, 0, 0), 1)
    expect([missed.x, missed.y]).toEqual([0, 0])
    const behind = particleSphereInterval(eye, ray, d.vec3f(0, 0, 7), 1)
    expect([behind.x, behind.y]).toEqual([0, 0])
  })

  it('adds only occupied chords across separated blobs, excluding the air gap', () => {
    const eye = d.vec3f(0, 0, 8)
    const ray = d.vec3f(0, 0, -1)
    const near = particleSphereInterval(eye, ray, d.vec3f(0, 0, 4), 0.5)
    const far = particleSphereInterval(eye, ray, d.vec3f(0), 0.5)
    const occupied = near.y - near.x + far.y - far.x
    expect(occupied).toBe(2)
    expect(far.y - near.x).toBe(5)
  })

  it('keeps a missing centre empty even between valid foreground neighbors', () => {
    expect(particleDepthWeight(0, 4, -1, 2, 0.1)).toBe(0)
    expect(particleDepthWeight(0, 4, 1, 2, 0.1)).toBe(0)
    expect(particleDepthWeight(4, 0, 1, 2, 0.1)).toBe(0)
    const source = tgpu.resolve([particleGummyFilterVertical], {
      names: 'strict',
    })
    expect(source).toContain('particleDepthWeight')
    expect(source).toMatch(/if \(\(?originalCentre <= 0/)
  })

  it('rejects a distinct depth layer and bounds support in world distance', () => {
    expect(particleDepthWeight(4, 4.11, 1, 2, 0.1)).toBe(0)
    expect(particleDepthWeight(4, 3.89, 1, 2, 0.1)).toBe(0)
    expect(particleDepthWeight(4, 4.05, 1, 2, 0.1)).toBeGreaterThan(0)
    expect(particleDepthWeight(4, 4, 0, 2, 0.1)).toBe(1)
    expect(particleDepthWeight(4, 4, 5, 2, 0.1)).toBeLessThan(
      particleDepthWeight(4, 4, 1, 2, 0.1),
    )
  })

  it('averages transported dyes by occupied support and keeps empty rays finite', () => {
    const mixture = particleMeanDye(d.vec3f(0.3, 0.5, 0), 0.8)
    expect([mixture.x, mixture.y, mixture.z]).toEqual([0.375, 0.625, 0])
    const scaled = particleMeanDye(d.vec3f(0.6, 1, 0), 1.6)
    expect([scaled.x, scaled.y, scaled.z]).toEqual([
      mixture.x,
      mixture.y,
      mixture.z,
    ])
    const empty = particleMeanDye(d.vec3f(0), 0)
    expect([empty.x, empty.y, empty.z]).toEqual([0, 0, 0])
    const source = tgpu.resolve([particleGummyOpticalFragment], {
      names: 'strict',
    })
    expect(source).toContain('gummyColourAtPoint')
    expect(source).toContain('@location(1)')
  })

  it('preserves smooth interior normals and restores a grazing normal at an open edge', () => {
    const interior = d.vec3f(0, 0, 1)
    const analytic = d.vec3f(1, 0, 0.01)
    const smooth = particleEdgeNormal(interior, analytic, d.vec4f(1))
    expect([smooth.x, smooth.y, smooth.z]).toEqual([0, 0, 1])
    const edge = particleEdgeNormal(interior, analytic, d.vec4f(1, 0, 1, 1))
    expect(edge.x).toBeGreaterThan(0.999)
    expect(edge.z).toBeLessThan(0.011)
    const degenerate = particleEdgeNormal(interior, d.vec3f(0), d.vec4f(0))
    expect([degenerate.x, degenerate.y, degenerate.z]).toEqual([0, 0, 1])
  })

  it('normalizes integrated sphere thickness to the represented particle volume', () => {
    const spacing = 0.08
    const radius = spacing * PARTICLE_GUMMY_RADIUS_SCALE
    const weight = particleVolumeWeight(spacing, radius)
    const slices = 20000
    let volume = 0
    // Independent annular integration of chord length across the sphere projection.
    for (let index = 0; index < slices; index++) {
      const r = ((index + 0.5) / slices) * radius
      const chord = 2 * Math.sqrt(radius * radius - r * r)
      volume += chord * 2 * Math.PI * r * (radius / slices) * weight
    }
    expect(volume).toBeCloseTo(spacing ** 3, 8)
    expect(weight).toBeLessThan(0.4)
    expect(particleVolumeWeight(spacing * 2, radius * 2)).toBeCloseTo(
      weight,
      12,
    )
    expect(() => particleVolumeWeight(0, radius)).toThrow(/positive/)
  })

  it('normalizes the compact optical kernel and clips its integral at opaque boundaries', () => {
    const spacing = 0.08
    const radius = spacing * PARTICLE_GUMMY_RADIUS_SCALE
    const weight = particleVolumeWeight(spacing, radius)
    const slices = 20000
    let volume = 0
    for (let index = 0; index < slices; index++) {
      const impact = ((index + 0.5) / slices) * radius
      const halfChord = Math.sqrt(radius * radius - impact * impact)
      const occupied = particleSmoothChord(
        halfChord,
        -halfChord,
        halfChord,
        radius,
      )
      volume += occupied * 2 * Math.PI * impact * (radius / slices) * weight
    }
    expect(volume).toBeCloseTo(spacing ** 3, 9)
    const whole = particleSmoothChord(radius, -radius, radius, radius)
    expect(whole).toBeCloseTo((14 / 3) * radius, 7)
    expect(particleSmoothChord(radius, -radius, 0, radius)).toBeCloseTo(
      whole / 2,
      7,
    )
    expect(particleSmoothChord(radius, 0, radius, radius)).toBeCloseTo(
      whole / 2,
      7,
    )
    expect(
      particleSmoothChord(radius, -2 * radius, 2 * radius, radius),
    ).toBeCloseTo(whole, 7)
    expect(particleSmoothChord(radius, radius, 2 * radius, radius)).toBe(0)
    // Independent trapezoidal integral of density along a clipped off-centre ray.
    const a = radius * 0.7,
      low = -a * 0.8,
      high = a * 0.35
    const step = (high - low) / 10000
    let integral = 0
    for (let index = 0; index < 10000; index++) {
      const local = low + (index + 0.5) * step
      const density = (a * a - local * local) / (radius * radius)
      integral += (35 / 8) * density * density * step
    }
    expect(particleSmoothChord(a, low, high, radius)).toBeCloseTo(integral, 7)
  })

  it('retains a small isolated blob and a single-particle-wide stretched neck', () => {
    const spacing = 0.08,
      radius = spacing * PARTICLE_GUMMY_RADIUS_SCALE
    const weight = particleVolumeWeight(spacing, radius)
    const start = 5 - radius,
      step = (2 * radius) / 7
    const values = Array.from({ length: 8 }, (_, index) => {
      const z = start + index * step - 5
      return particleKernelDensity(d.vec3f(0, 0, z), radius, weight)
    })
    const hit = particleDensitySurface(
      start,
      step,
      d.vec4f(values[0]!, values[1]!, values[2]!, values[3]!),
      d.vec4f(values[4]!, values[5]!, values[6]!, values[7]!),
      PARTICLE_GUMMY_DENSITY_ISO,
    )
    const peak = (35 / 8) * weight
    const analyticRadius =
      radius * Math.sqrt(1 - Math.sqrt(PARTICLE_GUMMY_DENSITY_ISO / peak))
    const volumeRadius = Math.cbrt((3 * spacing ** 3) / (4 * Math.PI))
    expect(hit).toBeGreaterThan(start)
    expect(Math.abs(hit - (5 - analyticRadius))).toBeLessThan(0.006)
    expect(analyticRadius / volumeRadius).toBeGreaterThan(0.9)
    expect(analyticRadius / volumeRadius).toBeLessThan(1.1)
    // A one-particle-wide line along Y never loses the centre particle's contribution.
    const neck = values.map(
      (value, index) =>
        value +
        particleKernelDensity(
          d.vec3f(0, spacing, start + index * step - 5),
          radius,
          weight,
        ) +
        particleKernelDensity(
          d.vec3f(0, -spacing, start + index * step - 5),
          radius,
          weight,
        ),
    )
    expect(
      particleDensitySurface(
        start,
        step,
        d.vec4f(neck[0]!, neck[1]!, neck[2]!, neck[3]!),
        d.vec4f(neck[4]!, neck[5]!, neck[6]!, neck[7]!),
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBeGreaterThan(0)
  })

  it('removes a zero-density support halo and never invents material in a missing pixel', () => {
    const radius = 0.104,
      weight = particleVolumeWeight(0.08, radius)
    const samples = Array.from({ length: 8 }, (_, index) =>
      particleKernelDensity(
        d.vec3f(radius * 0.9, 0, -radius + (2 * radius * index) / 7),
        radius,
        weight,
      ),
    )
    const first = d.vec4f(samples[0]!, samples[1]!, samples[2]!, samples[3]!)
    const second = d.vec4f(samples[4]!, samples[5]!, samples[6]!, samples[7]!)
    expect(
      particleDensitySurface(
        4,
        (2 * radius) / 7,
        first,
        second,
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBe(0)
    expect(
      particleDensitySurface(
        0,
        (2 * radius) / 7,
        d.vec4f(1),
        d.vec4f(1),
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBe(0)
  })

  it('gathers a C1 field normal with the correct gradient sign and no support-edge ring', () => {
    const radius = 0.104,
      weight = particleVolumeWeight(0.08, radius)
    const point = d.vec3f(0.03, 0.02, -0.04)
    const normal = particleKernelNormal(point, radius, weight)
    const epsilon = 0.0001
    const numerical =
      (particleKernelDensity(
        d.vec3f(point.x - epsilon, point.y, point.z),
        radius,
        weight,
      ) -
        particleKernelDensity(
          d.vec3f(point.x + epsilon, point.y, point.z),
          radius,
          weight,
        )) /
      (2 * epsilon)
    expect(normal.x).toBeCloseTo(numerical, 3)
    expect(normal.x).toBeGreaterThan(0)
    expect(normal.z).toBeLessThan(0)
    expect(particleKernelNormal(d.vec3f(radius, 0, 0), radius, weight).x).toBe(
      0,
    )
    expect(
      particleKernelNormal(d.vec3f(radius + epsilon, 0, 0), radius, weight).x,
    ).toBe(0)
    expect(
      particleKernelNormal(d.vec3f(radius - epsilon, 0, 0), radius, weight).x,
    ).toBeLessThan(0.05)
  })
  it('finds actual bulk behind a sparse foreground support without substituting coverage', () => {
    const radius = 0.104,
      weight = particleVolumeWeight(0.08, radius),
      start = 4
    const centre = start + 3.3 * radius
    const value = (distance: number) =>
      particleKernelDensity(d.vec3f(0, 0, distance - centre), radius, weight)
    const near = Array.from({ length: 8 }, (_, i) =>
      value(start + (2 * radius * i) / 7),
    )
    const far = Array.from({ length: 4 }, (_, i) =>
      value(start + (2 + ((i + 1) * 2) / 3) * radius),
    )
    const first = d.vec4f(near[0]!, near[1]!, near[2]!, near[3]!)
    const second = d.vec4f(near[4]!, near[5]!, near[6]!, near[7]!)
    const later = d.vec4f(far[0]!, far[1]!, far[2]!, far[3]!)
    expect(
      particleDensitySurface(
        start,
        (2 * radius) / 7,
        first,
        second,
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBe(0)
    const hit = particleDensitySurfaceWithFallback(
      start,
      radius,
      first,
      second,
      later,
      PARTICLE_GUMMY_DENSITY_ISO,
    )
    expect(hit).toBeGreaterThan(start + 2 * radius)
    expect(hit).toBeLessThan(centre)
    expect(
      particleDensitySurfaceWithFallback(
        start,
        radius,
        d.vec4f(0),
        d.vec4f(0),
        d.vec4f(0),
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBe(0)
    expect(
      particleDensitySurfaceWithFallback(
        0,
        radius,
        d.vec4f(0),
        d.vec4f(0),
        d.vec4f(1),
        PARTICLE_GUMMY_DENSITY_ISO,
      ),
    ).toBe(0)
    // The nearer crossing wins even when a different, deeper blob also occupies the ray.
    const nearest = particleDensitySurfaceWithFallback(
      start,
      radius,
      d.vec4f(0, 0.5, 0.7, 0.8),
      d.vec4f(0),
      d.vec4f(1),
      PARTICLE_GUMMY_DENSITY_ISO,
    )
    expect(nearest).toBeLessThan(start + 2 * radius)
  })

  it('does not skip a particle-sized blob between deeper profile sample positions', () => {
    const radius = 0.104,
      weight = particleVolumeWeight(0.08, radius),
      start = 4
    for (let index = 0; index < 80; index++) {
      const centre = start + (2.1 + (2.2 * index) / 79) * radius
      const value = (distance: number) =>
        particleKernelDensity(d.vec3f(0, 0, distance - centre), radius, weight)
      const near = Array.from({ length: 8 }, (_, i) =>
        value(start + (2 * radius * i) / 7),
      )
      const far = Array.from({ length: 4 }, (_, i) =>
        value(start + (2 + ((i + 1) * 2) / 3) * radius),
      )
      const hit = particleDensitySurfaceWithFallback(
        start,
        radius,
        d.vec4f(near[0]!, near[1]!, near[2]!, near[3]!),
        d.vec4f(near[4]!, near[5]!, near[6]!, near[7]!),
        d.vec4f(far[0]!, far[1]!, far[2]!, far[3]!),
        PARTICLE_GUMMY_DENSITY_ISO,
      )
      expect(hit).toBeGreaterThan(0)
    }
  })
  it('restores grazing normals across the filter boundary band while preserving the smooth body', () => {
    const filtered = d.vec3f(0, 0, 1),
      field = d.vec3f(1, 0, 0.1)
    const edge = particleBoundaryNormal(filtered, field, 2, 12)
    expect(edge.x).toBeGreaterThan(0.99)
    expect(edge.z).toBeLessThan(0.1)
    const band = particleBoundaryNormal(filtered, field, 8, 12)
    expect(band.x).toBeGreaterThan(0.5)
    expect(band.z).toBeGreaterThan(0.5)
    const inside = particleBoundaryNormal(filtered, field, 14, 12)
    expect([inside.x, inside.y, inside.z]).toEqual([0, 0, 1])
    const empty = particleBoundaryNormal(filtered, d.vec3f(0), 2, 12)
    expect([empty.x, empty.y, empty.z]).toEqual([0, 0, 1])
  })

  it('corrects occupied grazing absorption without introducing a front-to-back air span', () => {
    expect(particleOpticalScale(0, 0.01, 0.8)).toBe(0)
    expect(particleOpticalScale(0.0000001, 0.01, 0.8)).toBe(0)
    expect(particleOpticalScale(0.7, 1, 1)).toBeCloseTo(1, 6)
    expect(particleOpticalScale(0.1, 0.1, 0.8)).toBe(4)
    const occupied = 0.12,
      distantAirGap = 8
    const scale = particleOpticalScale(occupied, 0.35, 0.8)
    expect(occupied * scale).toBeLessThan(occupied * 4 + 0.000001)
    expect(occupied * scale).toBeLessThan(distantAirGap)
    expect(Number.isFinite(particleOpticalScale(1, 0, 0))).toBe(true)
  })
})
