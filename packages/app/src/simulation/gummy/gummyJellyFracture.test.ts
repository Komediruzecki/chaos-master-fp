/** Mechanical topology, objectivity and inertial continuity regression tests for extrinsic tears. */
import { describe, expect, it } from 'vitest'
import { prepareGummyJellyTets } from './gummyJelly'
import { createGummyJellyFracture, GUMMY_JELLY_DEFAULT_FRAGILITY, GUMMY_JELLY_TEAR_OPENING, GUMMY_JELLY_TEAR_RATE, gummyJellyFractureParameters, } from './gummyJellyFracture'
import { buildGummyBearMesh, EXPOSED_TEAR_FACE } from './gummyMesh'
import { remapGummyDynamicState } from './gummySolverState'
import type { GummyMesh } from './gummyMesh'
import type { GummySolverDynamicState } from './gummySolverState'

function fixture(pinned = false): GummyMesh {
  return {
    positions: new Float32Array([
      0,
      0,
      0,
      pinned ? 0 : 0.5,
      1,
      0,
      0,
      1 / 3,
      0,
      1,
      0,
      0.25,
      0,
      0,
      1,
      0.2,
      0,
      0,
      -1,
      1 / 6,
    ]),
    tetrahedra: new Uint32Array([0, 1, 2, 3, 0, 2, 1, 4]),
    restNormals: new Float32Array(20),
    interfaces: new Uint32Array(),
    surface: new Uint32Array(),
    nodeRegions: new Uint32Array(5),
    spacing: 0.14,
    restVolume: 1 / 3,
    bounds: { min: [0, 0, -1], max: [1, 1, 1] },
    demoGrip: { center: [0, 0, 1], radius: 0.3, pull: [0, 0, 1] },
  }
}

function transform(
  mesh: GummyMesh,
  map: (x: number, y: number, z: number) => number[],
) {
  const p = new Float32Array(mesh.positions)
  for (let i = 0; i < p.length; i += 4)
    p.set(map(p[i]!, p[i + 1]!, p[i + 2]!), i)
  return p
}

function plasticGradients(mesh: GummyMesh, stretch = 1) {
  const packed = prepareGummyJellyTets(mesh)
  // Be = B0 Fp^-1 for a volume-preserving permanent stretch along the shared face normal.
  const inverseStretch = [Math.sqrt(stretch), Math.sqrt(stretch), 1 / stretch]
  return Float32Array.from(
    { length: (mesh.tetrahedra.length / 4) * 9 },
    (_, index) => {
      const tet = Math.floor(index / 9)
      const row = Math.floor((index % 9) / 3)
      const col = index % 3
      return packed[tet * 16 + 4 + row * 4 + col]! * inverseStretch[col]!
    },
  )
}

function twoOctahedra(): GummyMesh {
  const mesh = fixture()
  const vertices = [
    0, 0, 0, 1, 1, 0, 0, 1, -1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0,
    0, -1, 1,
  ]
  mesh.positions = Float32Array.from([
    ...vertices,
    ...vertices.map((v, i) => (i % 4 === 0 ? v + 5 : v)),
  ])
  mesh.restNormals = new Float32Array(mesh.positions.length)
  const tets: number[] = []
  for (let shape = 0; shape < 2; shape++)
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++)
          tets.push(
            ...((x + y + z) % 2 === 0
              ? [0, 1 + x, 3 + y, 5 + z]
              : [0, 3 + y, 1 + x, 5 + z]
            ).map((node) => node + shape * 7),
          )
  mesh.tetrahedra = Uint32Array.from(tets)
  mesh.nodeRegions = new Uint32Array(14)
  return mesh
}

function state(mesh: GummyMesh): GummySolverDynamicState {
  const positions = transform(mesh, (x, y, z) => [x + 2, y - 3, z * 3])
  const previous = transform(mesh, (x, y, z) => [
    x + 1.99,
    y - 3.02,
    z * 3 + 0.01,
  ])
  const velocities = Float32Array.from(mesh.positions, (_, i) =>
    i % 4 === 3 ? 0 : (i + 1) * 0.125,
  )
  const grip = Float32Array.from(mesh.positions, (_, i) => (i + 1) * 0.01)
  return {
    positions,
    previous,
    velocities,
    grip,
    simulationTime: 3.4,
    accumulator: 0.002,
    gripKey: 'captured',
    gripping: true,
    previousPressHeight: 2,
  }
}

const enabled = { tearing: true, softness: 55 }
const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0)

function invariant(s: GummySolverDynamicState, m: Float64Array) {
  let kinetic = 0
  const momentum = [0, 0, 0],
    angular = [0, 0, 0]
  for (let n = 0; n < m.length; n++) {
    const p = Array.from(s.positions.subarray(n * 4, n * 4 + 3)),
      v = Array.from(s.velocities.subarray(n * 4, n * 4 + 3)),
      mass = m[n]!
    kinetic += 0.5 * mass * v.reduce((s, x) => s + x * x, 0)
    for (let a = 0; a < 3; a++) momentum[a]! += mass * v[a]!
    angular[0]! += mass * (p[1]! * v[2]! - p[2]! * v[1]!)
    angular[1]! += mass * (p[2]! * v[0]! - p[0]! * v[2]!)
    angular[2]! += mass * (p[0]! * v[1]! - p[1]! * v[0]!)
  }
  return [kinetic, ...momentum, ...angular]
}

describe('extrinsic continuous-jelly fracture', () => {
  it.each(['plastic', 'saturated'] as const)(
    'preserves the local Soft material response for similar cells at two resolutions in the %s regime',
    (regime) => {
      const ruptureSteps = [0.14, 0.1].map((spacing) => {
        const mesh = fixture()
        const scale = spacing / 0.14
        mesh.spacing = spacing
        mesh.positions = transform(mesh, (x, y, z) => [
          x * scale,
          y * scale,
          z * scale,
        ])
        const fracture = createGummyJellyFracture(mesh)
        // Equal dimensionless strain and plastic histories retain the existing
        // graphics material law when only the element size changes.
        const increment = regime === 'plastic' ? 0.006 : 0
        for (let step = 1; step <= 5; step++) {
          const stretch =
            regime === 'plastic' ? 1.35 : 1.015 + 0.065 * Math.sqrt(step)
          const split = fracture.assess(
            transform(mesh, (x, y, z) => [x, y, z * stretch]),
            0.05,
            {
              tearing: true,
              softness: 0.55,
              fragility: 0.88,
              response: 'soft',
              plasticStrain: new Float32Array(2).fill(
                regime === 'plastic' ? 0.4 + step * increment : 1.2,
              ),
              plasticGradients: plasticGradients(mesh),
              plasticIncrement: new Float32Array(2).fill(increment),
            },
          )
          if (split) return step
        }
        return 0
      })
      // Pin Standard and the same local response at Fine resolution. This is
      // not a claim of calibrated, mesh-independent fracture energy per area.
      expect(ruptureSteps).toEqual([4, 4])
    },
  )

  it('requires local plastic yielding before soft rupture and never spends its history while tearing is disabled', () => {
    const mesh = fixture(),
      p = transform(mesh, (x, y, z) => [x, y, z * 1.35])
    const f = createGummyJellyFracture(mesh),
      options = {
        ...enabled,
        fragility: 0.88,
        response: 'soft' as const,
        plasticGradients: plasticGradients(mesh),
        plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
          0.001,
        ),
      }
    expect(f.assess(p, 100, options)).toBeUndefined()
    expect(f.failedFaceIds).toHaveLength(0)
    const plasticStrain = new Float32Array(mesh.tetrahedra.length / 4).fill(
      0.12,
    )
    expect(
      f.assess(p, 100, { ...options, plasticStrain, tearing: false }),
    ).toBeUndefined()
    expect(f.assess(p, 0.01, { ...options, plasticStrain })).toBeUndefined()
    expect(
      f.assess(p, 0.1, {
        ...options,
        plasticStrain,
        plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
          0.02,
        ),
      })?.diagnostics.components,
    ).toHaveLength(2)
    f.reset()
    expect(
      f.assess(mesh.positions, 100, { ...options, plasticStrain }),
    ).toBeUndefined()
    expect(f.failedFaceIds).toHaveLength(0)
    expect(() =>
      f.assess(p, 0.1, { ...options, plasticStrain: new Float32Array([NaN]) }),
    ).toThrow(/plastic strain/)
  })
  it('does not fracture a plastically stretched stress-free shape, but ruptures under renewed elastic tension', () => {
    const mesh = fixture()
    const permanentStretch = 1.8
    const options = {
      tearing: true,
      softness: 0.55,
      fragility: 0.88,
      response: 'soft' as const,
      plasticGradients: plasticGradients(mesh, permanentStretch),
      plasticStrain: new Float32Array(mesh.tetrahedra.length / 4).fill(0.4),
      plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
        0.001,
      ),
    }
    const permanentShape = transform(mesh, (x, y, z) => [
      x / Math.sqrt(permanentStretch),
      y / Math.sqrt(permanentStretch),
      z * permanentStretch,
    ])
    const fracture = createGummyJellyFracture(mesh)
    // Total stretch is 1.8, but Ds Be = I. Plastic memory alone cannot drive a crack.
    expect(fracture.assess(permanentShape, 100, options)).toBeUndefined()
    expect(fracture.failedFaceIds).toHaveLength(0)
    expect(fracture.diagnostics.maxOpening).toBeCloseTo(1, 6)
    const rotatedPermanentShape = transform(mesh, (x, y, z) => [
      4 - y / Math.sqrt(permanentStretch),
      7 + x / Math.sqrt(permanentStretch),
      z * permanentStretch - 2,
    ])
    expect(fracture.assess(rotatedPermanentShape, 100, options)).toBeUndefined()
    expect(fracture.failedFaceIds).toHaveLength(0)

    const elasticStretch = 1.4
    const loaded = transform(mesh, (x, y, z) => [
      x / Math.sqrt(permanentStretch * elasticStretch),
      y / Math.sqrt(permanentStretch * elasticStretch),
      z * permanentStretch * elasticStretch,
    ])
    // Give it a partial damage dose, unload for a long time, then compare the next
    // loading step against an identically loaded control that had no idle interval.
    const control = createGummyJellyFracture(mesh)
    expect(fracture.assess(loaded, 0.01, options)).toBeUndefined()
    expect(control.assess(loaded, 0.01, options)).toBeUndefined()
    expect(fracture.assess(permanentShape, 100, options)).toBeUndefined()
    expect(fracture.failedFaceIds).toHaveLength(0)
    expect(fracture.assess(loaded, 0.01, options)).toBeUndefined()
    expect(control.assess(loaded, 0.01, options)).toBeUndefined()
    expect(
      fracture.assess(loaded, 0.1, {
        ...options,
        plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
          0.02,
        ),
      })?.diagnostics.components,
    ).toHaveLength(2)
    expect(
      control.assess(loaded, 0.1, {
        ...options,
        plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
          0.02,
        ),
      })?.diagnostics.components,
    ).toHaveLength(2)
    expect(fracture.failedFaceIds).toEqual(control.failedFaceIds)
  })
  it('spends only new plastic work above the yield gate, independent of its time partition', () => {
    const mesh = fixture()
    const loaded = transform(mesh, (x, y, z) => [x, y, z * 1.35])
    const options = (accumulated: number, increment: number) => ({
      tearing: true,
      softness: 0.55,
      fragility: 0.88,
      response: 'soft' as const,
      plasticGradients: plasticGradients(mesh),
      plasticStrain: new Float32Array(mesh.tetrahedra.length / 4).fill(
        accumulated,
      ),
      plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4).fill(
        increment,
      ),
    })
    const single = createGummyJellyFracture(mesh)
    const partitioned = createGummyJellyFracture(mesh)
    // The fragility setting puts the gate at .058. Both paths cross from .03 to
    // .076, so only .018 of new strain can contribute, not the entire .046 step.
    expect(single.assess(loaded, 0.05, options(0.076, 0.046))).toBeUndefined()
    expect(
      partitioned.assess(loaded, 0.025, options(0.053, 0.023)),
    ).toBeUndefined()
    expect(
      partitioned.assess(loaded, 0.025, options(0.076, 0.023)),
    ).toBeUndefined()
    // Residual elastic stretch and past plastic history cannot spend a second
    // damage budget just because the released piece continues to simulate.
    expect(partitioned.assess(loaded, 100, options(0.076, 0))).toBeUndefined()
    expect(partitioned.failedFaceIds).toHaveLength(0)
    expect(
      partitioned.assess(loaded, 100, {
        ...options(0.086, 0.01),
        tearing: false,
      }),
    ).toBeUndefined()
    expect(partitioned.assess(loaded, 100, options(0.086, 0))).toBeUndefined()
    expect(partitioned.assess(loaded, 0, options(0.096, 0.01))).toBeUndefined()
    expect(partitioned.assess(loaded, 100, options(0.096, 0))).toBeUndefined()
    expect(partitioned.failedFaceIds).toHaveLength(0)
    expect(
      single.assess(loaded, 0.1, options(0.078, 0.002))?.diagnostics.components,
    ).toHaveLength(2)
    expect(
      partitioned.assess(loaded, 0.001, options(0.098, 0.002))?.diagnostics
        .components,
    ).toHaveLength(2)
    expect(partitioned.failedFaceIds).toEqual(single.failedFaceIds)
  })
  it('requires new extension after plastic saturation and restores that loading history transactionally', () => {
    const mesh = fixture()
    const options = {
      tearing: true,
      softness: 0.55,
      fragility: 0.88,
      response: 'soft' as const,
      plasticGradients: plasticGradients(mesh),
      plasticStrain: new Float32Array(mesh.tetrahedra.length / 4).fill(1.2),
      plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4),
    }
    const stretched = (stretch: number) =>
      transform(mesh, (x, y, z) => [x, y, z * stretch])
    const f = createGummyJellyFracture(mesh)
    // Once permanent strain reaches its cap, the first small elastic extension
    // spends a partial budget. Holding or unloading/reloading it adds no work.
    expect(f.assess(stretched(1.05), 0.05, options)).toBeUndefined()
    expect(f.assess(stretched(1.05), 100, options)).toBeUndefined()
    expect(f.assess(mesh.positions, 100, options)).toBeUndefined()
    expect(f.assess(stretched(1.05), 100, options)).toBeUndefined()
    const before = f.checkpoint()
    // A transaction that observed a higher peak and then rolled back must leave
    // the same future rupture response as if the transaction had never happened.
    expect(
      f.assess(stretched(1.15), 0.05, { ...options, tearing: false }),
    ).toBeUndefined()
    f.restore(before)
    expect(
      f.assess(stretched(1.14), 0.05, options)?.diagnostics.components,
    ).toHaveLength(2)
    f.reset()
    expect(f.assess(stretched(1.05), 0.05, options)).toBeUndefined()
    expect(
      f.assess(stretched(1.14), 0.05, options)?.diagnostics.components,
    ).toHaveLength(2)
  })
  it('spends the same saturated elastic work for one large extension or several small extensions', () => {
    const mesh = fixture()
    const options = {
      tearing: true,
      softness: 0.55,
      fragility: 0.88,
      response: 'soft' as const,
      plasticGradients: plasticGradients(mesh),
      plasticStrain: new Float32Array(mesh.tetrahedra.length / 4).fill(1.2),
      plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4),
    }
    const stretched = (stretch: number) =>
      transform(mesh, (x, y, z) => [x, y, z * stretch])
    const single = createGummyJellyFracture(mesh)
    const partitioned = createGummyJellyFracture(mesh)
    // At this setting the integrated opening work to 1.115 is below failure.
    // Multiplying the whole increment by its endpoint load would fail early.
    expect(single.assess(stretched(1.115), 0.05, options)).toBeUndefined()
    for (const stretch of [1.05, 1.085, 1.115])
      expect(
        partitioned.assess(stretched(stretch), 0.01, options),
      ).toBeUndefined()
    expect(single.assess(stretched(1.115), 100, options)).toBeUndefined()
    expect(partitioned.assess(stretched(1.115), 100, options)).toBeUndefined()
    expect(
      single.assess(stretched(1.14), 0.05, options)?.diagnostics.components,
    ).toHaveLength(2)
    expect(
      partitioned.assess(stretched(1.14), 0.01, options)?.diagnostics
        .components,
    ).toHaveLength(2)
    expect(partitioned.failedFaceIds).toEqual(single.failedFaceIds)
  })
  it('observes saturated extension while disabled or at zero time without banking damage', () => {
    const mesh = fixture()
    const options = {
      tearing: true,
      softness: 0.55,
      fragility: 0.88,
      response: 'soft' as const,
      plasticGradients: plasticGradients(mesh),
      plasticStrain: new Float32Array(mesh.tetrahedra.length / 4).fill(1.2),
      plasticIncrement: new Float32Array(mesh.tetrahedra.length / 4),
    }
    const loaded = transform(mesh, (x, y, z) => [x, y, z * 1.14])
    for (const inactive of [
      { elapsed: 0.05, tearing: false },
      { elapsed: 0, tearing: true },
    ]) {
      const f = createGummyJellyFracture(mesh)
      // This extension is enough to rupture if first encountered during active
      // loading. Seeing it while inactive consumes neither damage nor future work.
      expect(
        f.assess(loaded, inactive.elapsed, {
          ...options,
          tearing: inactive.tearing,
        }),
      ).toBeUndefined()
      expect(f.assess(loaded, 100, options)).toBeUndefined()
      expect(f.failedFaceIds).toHaveLength(0)
      expect(f.assess(mesh.positions, 100, options)).toBeUndefined()
      expect(f.assess(loaded, 100, options)).toBeUndefined()
      expect(
        f.assess(
          transform(mesh, (x, y, z) => [x, y, z * 1.2]),
          0.05,
          options,
        )?.diagnostics.components,
      ).toHaveLength(2)
    }
  })
  it('maps independent fragility to finite tensile strength and failure time while preserving the original setting', () => {
    expect(gummyJellyFractureParameters()).toEqual({
      opening: GUMMY_JELLY_TEAR_OPENING,
      propagationOpening: GUMMY_JELLY_TEAR_OPENING,
      rate: GUMMY_JELLY_TEAR_RATE,
      propagationRate: GUMMY_JELLY_TEAR_RATE,
    })
    expect(gummyJellyFractureParameters(-1)).toEqual(
      gummyJellyFractureParameters(0),
    )
    expect(gummyJellyFractureParameters(2)).toEqual(
      gummyJellyFractureParameters(1),
    )
    const hot = gummyJellyFractureParameters(GUMMY_JELLY_DEFAULT_FRAGILITY)
    expect(hot.opening).toBeCloseTo(1.312, 12)
    expect(hot.propagationOpening).toBeCloseTo(1.124736, 12)
    expect(hot.rate).toBeCloseTo(105.96, 12)
    expect(hot.propagationRate).toBeCloseTo(478.9392, 12)
    expect(gummyJellyFractureParameters(1).opening).toBeGreaterThan(1.29)
    for (const value of [NaN, Infinity, -Infinity])
      expect(() => gummyJellyFractureParameters(value)).toThrow(/finite/)
  })

  it('retains the intact elastic range, objectivity and compression protection at maximum fragility', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh)
    const cases = [
      mesh.positions,
      transform(mesh, (x, y, z) => [4 - y, 7 + x, -2 + z]),
      transform(mesh, (x, y, z) => [x * 0.8, y * 0.7, z * 0.6]),
      transform(mesh, (x, y, z) => [x, y, z * 0.5]),
      transform(mesh, (x, y, z) => [x, y, z * 1.29]),
    ]
    for (const p of cases)
      expect(f.assess(p, 100, { ...enabled, fragility: 1 })).toBeUndefined()
    expect(f.mesh).toBe(mesh)
    expect(f.failedFaceIds).toHaveLength(0)
  })

  it('ruptures rapidly at mild tensile extension independently of softness and preserves disabled time', () => {
    const mesh = fixture(),
      p = transform(mesh, (x, y, z) => [x, y, z * 1.35])
    const tough = createGummyJellyFracture(mesh)
    expect(tough.assess(p, 100, enabled)).toBeUndefined()
    expect(tough.failedFaceIds).toHaveLength(0)
    for (const softness of [0, 1]) {
      const f = createGummyJellyFracture(mesh),
        options = {
          tearing: true,
          softness,
          fragility: GUMMY_JELLY_DEFAULT_FRAGILITY,
        }
      expect(f.assess(p, 0.1, options)).toBeUndefined()
      expect(f.assess(p, 100, { ...options, tearing: false })).toBeUndefined()
      expect(f.assess(p, 0.1, options)).toBeUndefined()
      expect(f.assess(p, 0.1, options)?.diagnostics.components).toHaveLength(2)
      f.reset()
      expect(f.assess(p, 0.1, options)).toBeUndefined()
    }
  })

  it('propagates only local loaded crack tips, without completing unloaded cracks or weakening remote material', () => {
    for (const fragility of [0, GUMMY_JELLY_DEFAULT_FRAGILITY, 1]) {
      const mesh = twoOctahedra(),
        f = createGummyJellyFracture(mesh)
      const options = { ...enabled, fragility }
      const loaded = new Float32Array(mesh.positions)
      loaded.set([2.8, 0.23, 0.17], 4)
      loaded.set([0.12, 0.07, 0.09], 0)
      // Seed the strongest facet by actual tensile history, with no explicit cut API.
      expect(f.assess(loaded, 1e-9, options)).toBeUndefined()
      const material = gummyJellyFractureParameters(fragility)
      const duration =
        1 / (material.rate * (f.diagnostics.maxOpening - material.opening))
      f.assess(loaded, duration, options)
      expect(f.diagnostics.brokenFaceCount).toBe(1)
      const seeded = f.checkpoint()
      expect(f.assess(f.mesh.positions, 100, options)).toBeUndefined()
      expect(
        f.assess(
          transform(f.mesh, (x, y, z) => [x * 0.7, y * 0.7, z * 0.7]),
          100,
          options,
        ),
      ).toBeUndefined()
      expect(f.diagnostics.brokenFaceCount).toBe(1)
      expect(f.diagnostics.components).toHaveLength(2)
      f.restore(seeded)
      // Both octahedra experience the same mild tension. Only the seeded one's
      // edge-connected process zone is eligible to advance under this load.
      for (let step = 0; step < 6; step++)
        f.assess(
          transform(f.mesh, (x, y, z) => [x * 1.2, y * 1.2, z * 1.2]),
          0.1,
          options,
        )
      expect(f.mesh.tetrahedra.slice(32)).toEqual(mesh.tetrahedra.slice(32))
      if (fragility === 0) {
        expect(f.diagnostics.brokenFaceCount).toBe(1)
        expect(f.mesh).toBe(mesh)
      } else {
        expect(f.diagnostics.brokenFaceCount).toBeGreaterThan(1)
        expect(f.diagnostics.components.length).toBeGreaterThan(2)
        expect(f.mesh.tetrahedra).toHaveLength(mesh.tetrahedra.length)
      }
    }
  })

  it('separates a short local bear deformation into independent small fragments while the tough control stays welded', () => {
    const mesh = buildGummyBearMesh({
      fracture: 'none',
      pinnedFeet: true,
      pinHeight: 0.48,
    })
    // A compact material deformation, not a scripted crack plane. The affected patch
    // moves at most .24 units (less than one tenth of this bear's height).
    const loaded = transform(mesh, (x, y, z) => {
      const radius = Math.hypot(x - 0.64, y - 1.24, z - 0.08) / 0.32
      const weight = Math.max(0, 1 - radius * radius)
      return [x + 0.24 * weight * weight, y, z]
    })
    for (const fragility of [0, GUMMY_JELLY_DEFAULT_FRAGILITY]) {
      const f = createGummyJellyFracture(mesh),
        initialMass = sum(f.nodeMasses)
      for (let assessment = 0; assessment < 12; assessment++) {
        const p = new Float32Array(f.mesh.positions.length)
        for (let node = 0; node < f.originalNodeIds.length; node++) {
          const source = f.originalNodeIds[node]! * 4
          p.set(loaded.subarray(source, source + 4), node * 4)
        }
        f.assess(p, 0.05, { ...enabled, fragility })
      }
      const parts = f.diagnostics.components
      expect(f.mesh.tetrahedra).toHaveLength(mesh.tetrahedra.length)
      expect(sum(f.nodeMasses)).toBeCloseTo(initialMass, 8)
      if (fragility === 0) {
        expect(f.mesh).toBe(mesh)
        expect(f.failedFaceIds).toHaveLength(0)
      } else {
        expect(parts.length).toBeGreaterThan(2)
        expect(1 - parts[0]!.restVolume / mesh.restVolume).toBeGreaterThan(
          0.001,
        )
        expect(parts.slice(1).every((part) => part.tetCount < 20)).toBe(true)
        // Every tetrahedron belongs to one live-node component: no edge/point bridge
        // can masquerade as a detached fragment in the topology diagnostic.
        for (let tet = 0; tet < f.mesh.tetrahedra.length; tet += 4) {
          const regions = new Set(
            f.mesh.tetrahedra
              .slice(tet, tet + 4)
              .map((node) => f.mesh.nodeRegions[node]!),
          )
          expect(regions.size).toBe(1)
        }
      }
    }
  })

  it('preserves the exact welded mesh at rest, under rigid motion, normal compression and disabled tearing', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh)
    const cases = [
      mesh.positions,
      transform(mesh, (x, y, z) => [4 - y, 7 + x, -2 + z]),
      transform(mesh, (x, y, z) => [x, y, z * 0.5]),
      transform(mesh, (x, y, z) => [x + z, y, z]),
    ]
    for (const p of cases) expect(f.assess(p, 10, enabled)).toBeUndefined()
    const stretched = transform(mesh, (x, y, z) => [x, y, 3 * z])
    expect(
      f.assess(stretched, 10, { ...enabled, tearing: false }),
    ).toBeUndefined()
    expect(f.assess(stretched, 0, enabled)).toBeUndefined()
    expect(f.mesh).toBe(mesh)
    expect(f.diagnostics.brokenFaceCount).toBe(0)
    expect(f.diagnostics.components).toHaveLength(1)
    expect(f.diagnostics.maxOpening).toBeCloseTo(1.36038627, 7)
  })

  it('splits shared vertex stars, closes both crack lips and partitions original inertia without moving material', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh),
      mass0 = sum(f.nodeMasses)
    const result = f.assess(
      transform(mesh, (x, y, z) => [x, y, z * 3]),
      1,
      enabled,
    )!
    expect(result).toBeDefined()
    expect(result.mesh.runtimeFracture).toBe(true)
    expect(result.mesh.tetrahedra).toHaveLength(8)
    expect(result.mesh.positions).toHaveLength(32)
    expect(result.mesh.interfaces).toHaveLength(0)
    const a = new Set(result.mesh.tetrahedra.slice(0, 4))
    expect([...result.mesh.tetrahedra.slice(4)].every((n) => !a.has(n))).toBe(
      true,
    )
    expect(result.diagnostics.components).toHaveLength(2)
    expect(result.diagnostics.brokenFaceCount).toBe(1)
    expect(result.diagnostics.exposedFaceCount).toBe(1)
    expect(result.diagnostics.restVolume).toBeCloseTo(mesh.restVolume, 12)
    expect(sum(result.nodeMasses)).toBeCloseTo(mass0, 12)
    for (let id = 0; id < 8; id++) {
      const original = result.originalNodeIds[id]!
      expect(
        Array.from(result.mesh.positions.slice(id * 4, id * 4 + 3)),
      ).toEqual(
        Array.from(mesh.positions.slice(original * 4, original * 4 + 3)),
      )
      expect(result.sourceNodes[id]).toBe(original)
      expect(result.nodeMasses[id]).toBeCloseTo(
        (1 / mesh.positions[original * 4 + 3]!) * (original < 3 ? 0.5 : 1),
        12,
      )
    }
    const caps = []
    for (let i = 0; i < result.mesh.surface.length; i += 4)
      if (result.mesh.surface[i + 3] === EXPOSED_TEAR_FACE)
        caps.push(Array.from(result.mesh.surface.slice(i, i + 3)))
    expect(caps).toHaveLength(2)
    const normal = (ids: number[]) => {
      const p = result.mesh.positions,
        a = ids[0]! * 4,
        b = ids[1]! * 4,
        c = ids[2]! * 4
      return (
        (p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) -
        (p[b + 1]! - p[a + 1]!) * (p[c]! - p[a]!)
      )
    }
    expect(normal(caps[0]!) * normal(caps[1]!)).toBe(-1)
    expect(result.mesh.surface).toHaveLength(8 * 4)
    expect(f.assess(result.mesh.positions, 10, enabled)).toBeUndefined()
    f.reset()
    expect(f.mesh).toBe(mesh)
    expect(f.diagnostics.topologyVersion).toBe(0)
    expect(f.failedFaceIds).toHaveLength(0)
    expect(f.originalNodeIds).toEqual(Uint32Array.from([0, 1, 2, 3, 4]))
  })

  it('retains fixed-node status and total free/pinned mass across cloned support nodes', () => {
    const mesh = fixture(true),
      f = createGummyJellyFracture(mesh),
      before = f.diagnostics
    const result = f.assess(
      transform(mesh, (x, y, z) => [x, y, z * 3]),
      1,
      enabled,
    )!
    expect(result.diagnostics.freeMass).toBeCloseTo(before.freeMass, 12)
    expect(result.diagnostics.pinnedMass).toBeCloseTo(before.pinnedMass, 12)
    for (let id = 0; id < result.originalNodeIds.length; id++)
      expect(result.mesh.positions[id * 4 + 3] === 0).toBe(
        result.originalNodeIds[id] === 0,
      )
  })

  it('requires accumulated positive opening and does not catch up disabled elapsed time', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh),
      p = transform(mesh, (x, y, z) => [x, y, z * 2])
    expect(f.assess(p, 0.2, enabled)).toBeUndefined()
    expect(f.assess(p, 100, { ...enabled, tearing: false })).toBeUndefined()
    expect(f.assess(p, 0.2, enabled)).toBeUndefined()
    expect(f.assess(p, 0.6, enabled)).toBeDefined()
  })

  it('retains every real bear tetrahedron and material identity through repeated topology revisions', () => {
    const initial = buildGummyBearMesh({
        fracture: 'none',
        pinnedFeet: true,
        pinHeight: 0.48,
      }),
      f = createGummyJellyFracture(initial)
    const mass0 = sum(f.nodeMasses)
    for (let revision = 0; revision < 3; revision++) {
      const before = f.mesh
      const result = f.assess(
        transform(before, (x, y, z) => [x * 3, y * 3, z * 3]),
        1,
        enabled,
      )!
      expect(result).toBeDefined()
      expect(result.diagnostics.topologyVersion).toBe(revision + 1)
      expect(result.diagnostics.brokenFaceCount).toBe((revision + 1) * 64)
      expect(result.mesh.tetrahedra).toHaveLength(initial.tetrahedra.length)
      expect(sum(result.nodeMasses)).toBeCloseTo(mass0, 8)
      for (let i = 0; i < result.mesh.tetrahedra.length; i++)
        expect(result.originalNodeIds[result.mesh.tetrahedra[i]!]).toBe(
          initial.tetrahedra[i],
        )
      for (let i = 0; i < result.sourceNodes.length; i++) {
        const source = result.sourceNodes[i]!
        expect(source).toBeLessThan(before.positions.length / 4)
        expect(
          Array.from(result.mesh.positions.slice(i * 4, i * 4 + 3)),
        ).toEqual(
          Array.from(before.positions.slice(source * 4, source * 4 + 3)),
        )
      }
    }
  })

  it('regularizes clipped-cell opening over a finite mesh-scale crack band', () => {
    const mesh = fixture()
    mesh.positions = transform(mesh, (x, y, z) => [x, y, z * 0.00001])
    const f = createGummyJellyFracture(mesh)
    // A huge relative sliver strain has negligible physical extension: no idle crack.
    expect(
      f.assess(
        transform(mesh, (x, y, z) => [x, y, z * 20]),
        100,
        enabled,
      ),
    ).toBeUndefined()
    expect(f.diagnostics.brokenFaceCount).toBe(0)
    // A finite resolved opening still tears that same material; it is not permanently excluded.
    expect(
      f.assess(
        transform(mesh, (x, y, z) => [x, y, z * 20000]),
        1,
        enabled,
      ),
    ).toBeDefined()
  })

  it('rolls topology and partial failure history back after a failed allocation transaction', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh)
    const p = transform(mesh, (x, y, z) => [x, y, z * 2])
    const duration =
      1 / (GUMMY_JELLY_TEAR_RATE * (2 - GUMMY_JELLY_TEAR_OPENING))
    const pristine = f.checkpoint()
    expect(f.assess(p, duration * 0.2, enabled)).toBeUndefined()
    const partial = f.checkpoint()
    const before = f.diagnostics
    expect(f.assess(p, duration * 0.9, enabled)).toBeDefined()
    expect(f.mesh).not.toBe(mesh)
    f.restore(partial)
    expect(f.mesh).toBe(mesh)
    expect(f.diagnostics).toBe(before)
    expect(f.failedFaceIds).toHaveLength(0)
    expect(f.assess(p, duration * 0.5, enabled)).toBeUndefined()
    expect(f.assess(p, duration * 0.4, enabled)).toBeDefined()
    f.restore(pristine)
    expect(f.assess(p, duration * 0.8, enabled)).toBeUndefined()
    expect(f.diagnostics.topologyVersion).toBe(0)
    expect(() => {
      createGummyJellyFracture(mesh).restore(pristine)
    }).toThrow(/different controller/)
  })

  it('retains failed facets without rebuilding a still-connected vertex star', () => {
    const mesh = fixture()
    mesh.positions = new Float32Array([
      0, 0, 0, 1, 1, 0, 0, 1, -1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1,
      0, 0, -1, 1,
    ])
    mesh.restNormals = new Float32Array(mesh.positions.length)
    const tets: number[] = []
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++)
          tets.push(
            ...((x + y + z) % 2 === 0
              ? [0, 1 + x, 3 + y, 5 + z]
              : [0, 3 + y, 1 + x, 5 + z]),
          )
    mesh.tetrahedra = Uint32Array.from(tets)
    const f = createGummyJellyFracture(mesh)
    const p = new Float32Array(mesh.positions)
    p.set([2.8, 0.23, 0.17], 4)
    p.set([0.12, 0.07, 0.09], 0)
    expect(f.assess(p, 1e-9, enabled)).toBeUndefined()
    const excess = f.diagnostics.maxOpening - GUMMY_JELLY_TEAR_OPENING
    expect(excess).toBeGreaterThan(0)
    const result = f.assess(p, 1 / (GUMMY_JELLY_TEAR_RATE * excess), enabled)
    expect(result).toBeUndefined()
    expect(f.diagnostics.brokenFaceCount).toBe(1)
    expect(f.diagnostics.topologyVersion).toBe(0)
    expect(f.diagnostics.exposedFaceCount).toBe(0)
    expect(f.mesh).toBe(mesh)
    expect(f.diagnostics.components).toHaveLength(1)
  })

  it('rejects malformed live snapshots and non-welded initial data', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh)
    expect(() => f.assess(new Float32Array(4), 0.1, enabled)).toThrow(
      /snapshot/,
    )
    expect(() => f.assess(mesh.positions, -1, enabled)).toThrow(/elapsed/)
    const bad = new Float32Array(mesh.positions)
    bad[0] = NaN
    expect(() => f.assess(bad, 0.1, enabled)).toThrow(/snapshot/)
    expect(() =>
      createGummyJellyFracture({ ...mesh, interfaces: new Uint32Array(8) }),
    ).toThrow(/welded/)
    expect(() =>
      createGummyJellyFracture({
        ...mesh,
        tetrahedra: new Uint32Array([0, 2, 1, 3]),
      }),
    ).toThrow(/positive/)
  })
})

describe('live jelly state remapping', () => {
  it('copies position, previous-position, velocity and captured grip exactly, conserving momentum and kinetic energy', () => {
    const mesh = fixture(),
      f = createGummyJellyFracture(mesh),
      snapshot = state(mesh),
      oldMass = new Float64Array(f.nodeMasses)
    const result = f.assess(snapshot.positions, 1, enabled)!
    const restored = remapGummyDynamicState(
      snapshot,
      result.mesh.positions,
      result.sourceNodes,
    )
    for (let id = 0; id < result.sourceNodes.length; id++) {
      const source = result.sourceNodes[id]!
      for (const field of [
        'positions',
        'previous',
        'velocities',
        'grip',
      ] as const) {
        expect(Array.from(restored[field].slice(id * 4, id * 4 + 3))).toEqual(
          Array.from(snapshot[field].slice(source * 4, source * 4 + 3)),
        )
        expect(restored[field][id * 4 + 3]).toBe(
          field === 'positions' || field === 'previous'
            ? result.mesh.positions[id * 4 + 3]
            : snapshot[field][source * 4 + 3],
        )
      }
    }
    expect(restored.simulationTime).toBe(snapshot.simulationTime)
    expect(restored.accumulator).toBe(snapshot.accumulator)
    expect(restored.gripKey).toBe(snapshot.gripKey)
    expect(restored.gripping).toBe(true)
    expect(restored.previousPressHeight).toBe(2)
    const before = invariant(snapshot, oldMass),
      after = invariant(restored, result.nodeMasses)
    after.forEach((v, i) => {
      expect(v).toBeCloseTo(before[i]!, 10)
    })
    expect(remapGummyDynamicState(snapshot, mesh.positions)).toEqual(snapshot)
  })

  it('validates source indices, buffer sizes and metadata before any GPU write', () => {
    const mesh = fixture(),
      s = state(mesh)
    expect(() =>
      remapGummyDynamicState(
        s,
        mesh.positions,
        new Uint32Array([0, 1, 2, 3, 9]),
      ),
    ).toThrow(/source map/)
    expect(() => remapGummyDynamicState(s, new Float32Array(24))).toThrow(
      /source map/,
    )
    expect(() =>
      remapGummyDynamicState(
        { ...s, grip: new Float32Array(4) },
        mesh.positions,
      ),
    ).toThrow(/snapshot/)
    expect(() =>
      remapGummyDynamicState(
        { ...s, simulationTime: Infinity },
        mesh.positions,
      ),
    ).toThrow(/snapshot/)
    expect(() =>
      remapGummyDynamicState({ ...s, accumulator: 1 }, mesh.positions),
    ).toThrow(/snapshot/)
  })
})
