/** Physics invariants execute the actual GPU math; resolution covers every simulation kernel. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { colorGummyConstraints, GUMMY_FINE_SOLVER_ITERATIONS, GUMMY_SOLVER_ITERATIONS, gummyCohesiveStrength, gummyMaterial, normalizeGummyPress, prepareGummyTets, } from './gummySolver'
import { gummyCaptureGrip, gummyEdgeProjection, gummyFinish, gummyGripAndFloor, gummyOpeningDamage, gummyPredict, gummyPressContact, gummyScaledTractionDamage, gummySignedVolume, gummySolveInterfaces, gummySolveTets, gummyTensionShear, gummyTractionDamage, gummyUpdateDamage, solveGummyTet, } from './gummySolverShaders'
import type { GummySolverMesh } from './gummySolver'

const rest = [
  d.vec4f(0, 0, 0, 1),
  d.vec4f(1, 0, 0, 1),
  d.vec4f(0, 1, 0, 1),
  d.vec4f(0, 0, 1, 1),
] as const
const lengthsA = d.vec4f(1, 1, 1, Math.SQRT2)
const lengthsB = d.vec4f(Math.SQRT2, Math.SQRT2, 1 / 6, 0)

function project(
  points: readonly d.v4f[],
  iterations: number,
  stretchAlpha = 0,
  volumeAlpha = 0,
) {
  let p = points.map((v) => d.vec4f(v))
  let a = d.vec4f(),
    b = d.vec4f()
  for (let i = 0; i < iterations; i++) {
    const result = solveGummyTet(
      p[0]!,
      p[1]!,
      p[2]!,
      p[3]!,
      lengthsA,
      lengthsB,
      a,
      b,
      stretchAlpha,
      volumeAlpha,
    )
    p = [result.p0, result.p1, result.p2, result.p3]
    a = result.a
    b = result.b
  }
  return p
}

function centroid(points: readonly d.v4f[]) {
  return [0, 1, 2].map(
    (axis) => points.reduce((sum, p) => sum + p[axis]!, 0) / points.length,
  )
}

function edgeError(points: readonly d.v4f[]) {
  const pairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ]
  return Math.max(
    ...pairs.map(([a, b], i) => {
      const p = points[a!]!,
        q = points[b!]!
      return Math.abs(
        Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - (i < 3 ? 1 : Math.SQRT2),
      )
    }),
  )
}

function projectedFootprint(points: readonly d.v4f[]) {
  const sorted = points
    .map((p) => [p.x, p.z] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (input: typeof sorted) => {
    const hull: typeof sorted = []
    for (const p of input) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!,
          b = hull[hull.length - 1]!
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0)
          break
        hull.pop()
      }
      hull.push(p)
    }
    return hull.slice(0, -1)
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  return (
    Math.abs(
      hull.reduce((sum, p, id) => {
        const q = hull[(id + 1) % hull.length]!
        return sum + p[0] * q[1] - p[1] * q[0]
      }, 0),
    ) / 2
  )
}

describe('gummy GPU elastic and cohesive mathematics', () => {
  it('distance projection conserves centre of mass and obeys pinned nodes', () => {
    const a = d.vec4f(0, 0, 0, 1),
      b = d.vec4f(2, 0, 0, 1)
    const q = gummyEdgeProjection(a, b, 1, 0, 0)
    expect(q.x).toBeCloseTo(0.5, 12)
    expect(q.w).toBeCloseTo(-0.5, 12)
    const pinned = gummyEdgeProjection(d.vec4f(0, 0, 0, 0), b, 1, 0, 0)
    expect(pinned.x).toBeCloseTo(1, 12)
    expect(b.x - pinned.x * b.w).toBeCloseTo(1, 12)
  })

  it('a rotated/translated rest tetrahedron has no elastic force', () => {
    const rotated = rest.map((p) => d.vec4f(2 - p.y, 3 + p.x, -1 + p.z, p.w))
    const after = project(rotated, 5)
    for (let i = 0; i < 4; i++)
      for (let axis = 0; axis < 3; axis++)
        expect(after[i]![axis]).toBeCloseTo(rotated[i]![axis]!, 6)
  })

  it('recovering a stretched tetrahedron preserves centre of mass and positive rest volume', () => {
    const stretched = rest.map((p) =>
      d.vec4f(p.x * 1.9, p.y * 0.8, p.z * 1.1, p.w),
    )
    const before = centroid(stretched)
    const after = project(stretched, 25)
    expect(edgeError(stretched)).toBeCloseTo(0.9, 6)
    expect(edgeError(after)).toBeLessThan(0.00001)
    for (let axis = 0; axis < 3; axis++)
      expect(centroid(after)[axis]).toBeCloseTo(before[axis]!, 6)
    expect(
      gummySignedVolume(
        after[0]!.xyz,
        after[1]!.xyz,
        after[2]!.xyz,
        after[3]!.xyz,
      ),
    ).toBeCloseTo(1 / 6, 6)
  })

  it('soft compliance permits more strain and fixed vertices remain fixed', () => {
    const input = [
      d.vec4f(0, 0, 0, 0),
      d.vec4f(1.8, 0, 0, 1),
      d.vec4f(0, 1, 0, 1),
      d.vec4f(0, 0, 1, 1),
    ]
    const rigid = project(input, 30),
      soft = project(input, 30, 5, 0.2)
    expect(edgeError(rigid)).toBeLessThan(0.0001)
    expect(edgeError(soft)).toBeGreaterThan(0.2)
    expect([soft[0]!.x, soft[0]!.y, soft[0]!.z, soft[0]!.w]).toEqual([
      0, 0, 0, 0,
    ])
  })

  it('opening damage is irreversible, disabled tearing preserves it, and failure releases', () => {
    expect(gummyOpeningDamage(0, 0.004, 1 / 120, 1, 0.006, 0.11, 12)).toBe(0)
    expect(gummyOpeningDamage(0.2, 0, 1 / 120, 1, 0.006, 0.11, 12)).toBe(0.2)
    expect(gummyOpeningDamage(0.2, 0.2, 1 / 120, 0, 0.006, 0.11, 12)).toBe(0.2)
    expect(
      gummyOpeningDamage(0, 0.012, 1 / 120, 1, 0.006, 0.11, 12),
    ).toBeCloseTo(0.1, 12)
    expect(gummyOpeningDamage(0.8, 0.11, 1 / 120, 1, 0.006, 0.11, 12)).toBe(1)
    expect(gummyOpeningDamage(1, 0, 1 / 120, 1, 0.006, 0.11, 12)).toBe(1)
    const oneStep = gummyOpeningDamage(0.1, 0.012, 1 / 60, 1, 0.006, 0.11, 12)
    const half = gummyOpeningDamage(0.1, 0.012, 1 / 120, 1, 0.006, 0.11, 12)
    expect(
      gummyOpeningDamage(half, 0.012, 1 / 120, 1, 0.006, 0.11, 12),
    ).toBeCloseTo(oneStep, 12)
  })
  it('closed loaded seams damage progressively while idle load and disabled tearing do not', () => {
    const damage = (old: number, force: number, enabled = 1) =>
      gummyTractionDamage(old, 0, force, 1 / 120, enabled, 0.006, 0.11, 12)
    expect(damage(0, 350)).toBe(0)
    expect(damage(0, 2800, 0)).toBe(0)
    const first = damage(0, 2800)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(1)
    expect(damage(first, 0)).toBe(first)
    expect(damage(first, 2800)).toBeGreaterThan(first)
    let accumulated = 0
    for (let step = 0; step < 120; step++)
      accumulated = damage(accumulated, 2800)
    expect(accumulated).toBe(1)
    expect(damage(1, 0)).toBe(1)
  })

  it('fine fracture excludes pure compression, retains shear, and is rotation invariant', () => {
    const n = d.vec3f(0, 1, 0)
    expect(gummyTensionShear(d.vec3f(0, -10, 0), n)).toBe(0)
    expect(gummyTensionShear(d.vec3f(0, 10, 0), n)).toBe(10)
    expect(gummyTensionShear(d.vec3f(3, -10, 4), n)).toBe(5)
    expect(gummyTensionShear(d.vec3f(3, 12, 4), n)).toBe(13)
    const angle = 0.71
    const rotate = (v: d.v3f) =>
      d.vec3f(
        Math.cos(angle) * v.x - Math.sin(angle) * v.y,
        Math.sin(angle) * v.x + Math.cos(angle) * v.y,
        v.z,
      )
    expect(
      gummyTensionShear(rotate(d.vec3f(3, -10, 4)), rotate(n)),
    ).toBeCloseTo(5, 5)
    // A collapsed face has a zero guarded normal: finite unsigned fallback, never NaN.
    expect(gummyTensionShear(d.vec3f(3, -10, 4), d.vec3f())).toBeCloseTo(
      Math.sqrt(125),
      5,
    )
  })

  it('fine strength changes only the traction threshold and disabled tearing never accumulates damage', () => {
    const damage = (strength: number, force: number, enabled = 1) =>
      gummyScaledTractionDamage(
        0,
        0,
        force,
        1 / 120,
        enabled,
        0.006,
        0.11,
        12,
        strength,
      )
    expect(damage(1, 700)).toBe(0)
    expect(damage(0.25, 700)).toBeGreaterThan(0)
    expect(damage(0.25, 350)).toBe(0)
    expect(damage(0.25, 2800, 0)).toBe(0)
    expect(damage(1, 2800)).toBe(
      gummyTractionDamage(0, 0, 2800, 1 / 120, 1, 0.006, 0.11, 12),
    )
  })

  it('the press underside limits only its finite square and still respects the floor', () => {
    const press = d.vec4f(0.3, 1.4, 1, -0.2)
    const input = d.vec3f(0.6, 1.2, -0.7)
    const contact = gummyPressContact(input, press)
    expect(Array.from(contact)).toEqual([input.x, Math.fround(0.3), input.z])
    expect(input.y).toBeCloseTo(1.2, 6)
    expect(gummyPressContact(d.vec3f(1.5, 1.2, 0), press).y).toBeCloseTo(1.2, 6)
    expect(gummyPressContact(d.vec3f(0, 1.2, 1.5), press).y).toBeCloseTo(1.2, 6)
    expect(gummyPressContact(d.vec3f(1.4, 1.2, 0), press).y).toBeCloseTo(0.3, 6)
    expect(gummyPressContact(d.vec3f(0, -1, 0), press).y).toBeCloseTo(0.006, 6)
    expect(gummyPressContact(input, d.vec4f()).y).toBeCloseTo(input.y, 6)
  })

  it('fine bulk resistance redistributes sustained plane compression into lateral strain', () => {
    const compress = (mode: 'legacy' | 'tension-shear', iterations: number) => {
      const material = gummyMaterial(0.55, mode)
      let p = rest.map((value, index) =>
        d.vec4f(value.xyz, index === 0 ? 0 : 1),
      )
      const dt = 1 / 120,
        press = d.vec4f(0.5, 10, 1, 0)
      for (let step = 0; step < 60; step++) {
        let a = d.vec4f(),
          b = d.vec4f()
        for (let iteration = 0; iteration < iterations; iteration++) {
          const result = solveGummyTet(
            p[0]!,
            p[1]!,
            p[2]!,
            p[3]!,
            lengthsA,
            lengthsB,
            a,
            b,
            material.stretchCompliance / (dt * dt),
            material.volumeCompliance / (dt * dt),
          )
          p = [result.p0, result.p1, result.p2, result.p3]
          a = result.a
          b = result.b
          p = p.map((value) =>
            value.w > 0
              ? d.vec4f(gummyPressContact(value.xyz, press), value.w)
              : value,
          )
        }
      }
      return {
        volume:
          gummySignedVolume(p[0]!.xyz, p[1]!.xyz, p[2]!.xyz, p[3]!.xyz) * 6,
        lateral: projectedFootprint(p),
      }
    }
    const legacy = compress('legacy', GUMMY_SOLVER_ITERATIONS),
      fine = compress('tension-shear', GUMMY_FINE_SOLVER_ITERATIONS)
    expect(fine.volume).toBeGreaterThan(0.9)
    expect(fine.volume).toBeGreaterThan(legacy.volume)
    expect(fine.lateral).toBeGreaterThan(legacy.lateral)
    expect(fine.lateral).toBeGreaterThan(projectedFootprint(rest))
  })
})

describe('gummy race-free preparation and native shaders', () => {
  it('colors shared constraints without simultaneous writes and keeps every constraint', () => {
    const indices = new Uint32Array([
      0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 0, 5, 7, 11,
    ])
    const { order, ranges } = colorGummyConstraints(indices, 4, 4)
    expect(Array.from(order).sort()).toEqual([0, 1, 2, 3])
    expect(ranges).toEqual([
      { offset: 0, count: 2 },
      { offset: 2, count: 1 },
      { offset: 3, count: 1 },
    ])
    for (const range of ranges) {
      const nodes = new Set<number>()
      for (const id of order.subarray(range.offset, range.offset + range.count))
        for (const node of indices.subarray(id * 4, id * 4 + 4)) {
          expect(nodes.has(node)).toBe(false)
          nodes.add(node)
        }
    }
  })

  it('prepares actual edge lengths and signed volume and rejects invalid rest geometry', () => {
    const mesh: GummySolverMesh = {
      positions: new Float32Array(rest.flatMap((p) => [p.x, p.y, p.z, p.w])),
      tetrahedra: new Uint32Array([0, 1, 2, 3]),
      interfaces: new Uint32Array(),
    }
    const data = prepareGummyTets(mesh)
    expect(Array.from(new Uint32Array(data.buffer).slice(0, 4))).toEqual([
      0, 1, 2, 3,
    ])
    expect(data[4]).toBe(1)
    expect(data[7]).toBeCloseTo(Math.SQRT2, 6)
    expect(data[10]).toBeCloseTo(1 / 6, 6)
    expect(() =>
      prepareGummyTets({ ...mesh, tetrahedra: new Uint32Array([0, 2, 1, 3]) }),
    ).toThrow('positive')
    expect(() =>
      prepareGummyTets({ ...mesh, tetrahedra: new Uint32Array([0, 1, 2, 8]) }),
    ).toThrow('out of range')
  })

  it('material compliance increases with softness and safely handles invalid input', () => {
    expect(gummyMaterial(0).stretchCompliance).toBe(0.0000002)
    expect(gummyMaterial(1).stretchCompliance).toBeCloseTo(0.000024, 12)
    expect(gummyMaterial(NaN)).toEqual(gummyMaterial(0.5))
    expect(gummyMaterial(-1)).toEqual(gummyMaterial(0))
    const legacy = gummyMaterial(0.55),
      fine = gummyMaterial(0.55, 'tension-shear')
    expect(fine.stretchCompliance).toBeCloseTo(legacy.stretchCompliance * 8, 12)
    expect(fine.volumeCompliance).toBeCloseTo(
      legacy.volumeCompliance * 0.01,
      12,
    )
    expect(fine.damping).toBe(legacy.damping)
    expect(gummyMaterial(0.55, 'legacy')).toEqual(legacy)
  })

  it('optional crush inputs retain legacy defaults and reject invalid collision geometry', () => {
    expect(gummyCohesiveStrength()).toBe(1)
    expect(gummyCohesiveStrength(NaN)).toBe(1)
    expect(gummyCohesiveStrength(-1)).toBe(0.05)
    expect(gummyCohesiveStrength(20)).toBe(8)
    expect(gummyCohesiveStrength(0.25)).toBe(0.25)
    expect(normalizeGummyPress()).toBeUndefined()
    expect(normalizeGummyPress({ height: NaN, halfExtent: 1 })).toBeUndefined()
    expect(normalizeGummyPress({ height: 0.01, halfExtent: 1 })).toBeUndefined()
    expect(normalizeGummyPress({ height: 0.3, halfExtent: 0 })).toBeUndefined()
    expect(
      normalizeGummyPress({ height: 0.3, halfExtent: Infinity }),
    ).toBeUndefined()
    expect(normalizeGummyPress({ height: 0.3, halfExtent: 1.4 })).toEqual({
      height: 0.3,
      halfExtent: 1.4,
    })
  })

  it.each([
    gummyCaptureGrip,
    gummyPredict,
    gummyGripAndFloor,
    gummyFinish,
    gummySolveTets,
    gummyUpdateDamage,
    gummySolveInterfaces,
  ])('resolves the actual TypeGPU compute kernel %s', (kernel) => {
    const code = tgpu.resolve([kernel], { names: 'strict' })
    expect(code).toContain('@compute @workgroup_size(64)')
    expect(code).not.toContain('atomicAdd')
  })
})
