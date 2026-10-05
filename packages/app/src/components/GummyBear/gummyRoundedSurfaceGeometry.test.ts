/** Independent geometric fixtures distinguish rounded render corners from physical tetrahedra. */
import { d, std } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { gummyRoundingScale, gummyRoundingWeight } from './gummyRoundedSurface'
import { prepareRuntimeGummyMetadata } from './gummyRuntimeSurface'
import { gummyBoundedTearPatch, gummyTetInradius, } from './gummyRuntimeSurfaceMath'

type Point = [number, number, number]
type Tet = [number, number, number, number]

function fixture(points: Point[], tetrahedra: Tet[], exposed = true) {
  const positions = new Float32Array(points.flatMap((point) => [...point, 1]))
  const surface = new Uint32Array(
    tetrahedra.flatMap(([a, b, c, q]) =>
      [
        [b, c, q],
        [a, q, c],
        [a, b, q],
        [a, c, b],
      ].flatMap((face) => [
        ...face,
        exposed ? EXPOSED_TEAR_FACE : EXTERIOR_FACE,
      ]),
    ),
  )
  return {
    positions,
    tetrahedra: new Uint32Array(tetrahedra.flat()),
    surface,
  }
}

const rightTetrahedron: Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

const regularTetrahedron = [
  d.vec3f(1, 1, 1),
  d.vec3f(1, -1, -1),
  d.vec3f(-1, -1, 1),
  d.vec3f(-1, 1, -1),
] as const

const regularFaces = [
  [1, 2, 3],
  [0, 3, 2],
  [0, 1, 3],
  [0, 2, 1],
] as const

/** Divergence theorem over tessellated curved triangles, independent of solver volume. */
function curvedVolume(corners: readonly d.v3f[], support: number) {
  let volume = 0
  for (const face of regularFaces) {
    const [a, b, c] = face.map((node) => corners[node]!) as [
      d.v3f,
      d.v3f,
      d.v3f,
    ]
    const at = (u: number, v: number) =>
      gummyBoundedTearPatch(
        a,
        b,
        c,
        std.normalize(a),
        std.normalize(b),
        std.normalize(c),
        d.vec3f(1 - u - v, u, v),
        d.vec3f(support * 0.35),
      )
    const accumulate = (p: d.v3f, q: d.v3f, r: d.v3f) => {
      volume += std.dot(p, std.cross(q, r)) / 6
    }
    // Match the actual surface's 16 triangles per patch; no solver cells are created.
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 4 - row; column++) {
        accumulate(
          at(row / 4, column / 4),
          at((row + 1) / 4, column / 4),
          at(row / 4, (column + 1) / 4),
        )
        if (row + column < 3)
          accumulate(
            at((row + 1) / 4, column / 4),
            at((row + 1) / 4, (column + 1) / 4),
            at(row / 4, (column + 1) / 4),
          )
      }
  }
  return volume
}

function rounding(mesh: ReturnType<typeof fixture>) {
  return prepareRuntimeGummyMetadata(
    mesh.positions,
    mesh.tetrahedra,
    mesh.surface,
  ).rounding
}

describe('rounded runtime surface geometry', () => {
  it('rounds a regular tetrahedron by a bounded convex mask, with measurable render-only volume loss', () => {
    const radius = gummyTetInradius(...regularTetrahedron)
    expect(radius).toBeCloseTo(1 / Math.sqrt(3), 7)
    const beta = gummyRoundingWeight(3)
    expect(beta).toBe(3 / 16)
    const rounded = regularTetrahedron.map((point) => {
      // Regular tetrahedron's three neighbors sum to -point.
      const delta = std.mul(point, -4 * beta)
      const scale = gummyRoundingScale(delta, radius)
      expect(scale).toBeCloseTo(2 / 15, 7)
      const result = std.add(point, std.mul(delta, scale))
      for (let axis = 0; axis < 3; axis++)
        expect(result[axis]).toBeCloseTo(point[axis]! * 0.9, 7)
      expect(std.distance(result, point)).toBeCloseTo(radius * 0.3, 7)
      return result
    })
    const physicalVolume = 8 / 3
    const cornerHullVolume =
      std.dot(
        std.sub(rounded[1]!, rounded[0]!),
        std.cross(
          std.sub(rounded[2]!, rounded[0]!),
          std.sub(rounded[3]!, rounded[0]!),
        ),
      ) / 6
    expect(cornerHullVolume / physicalVolume).toBeCloseTo(0.729, 6)
    const originalShell = curvedVolume(regularTetrahedron, radius)
    const roundedShell = curvedVolume(rounded, radius)
    // Independent double-precision PN integration, not physical mass conservation.
    expect(originalShell).toBeCloseTo(4.699654005655136, 5)
    expect(roundedShell).toBeCloseTo(3.6272579980934223, 5)
    expect(roundedShell).toBeLessThan(originalShell)
    expect(roundedShell).toBeGreaterThan(cornerHullVolume)
    expect(originalShell).toBeGreaterThan(physicalVolume)
  })

  it('uses convex weights for every supported valence and does not create a shell from invalid support', () => {
    expect(gummyRoundingWeight(3)).toBe(0.1875)
    expect(gummyRoundingWeight(4)).toBe(0.12109375)
    expect(gummyRoundingWeight(6)).toBeCloseTo(0.0625, 12)
    for (const valence of [0, 1, 2, 2.5, Number.NaN])
      expect(gummyRoundingWeight(valence)).toBe(0)
    for (let valence = 3; valence <= 128; valence++) {
      const beta = gummyRoundingWeight(valence)
      expect(beta).toBeGreaterThan(0)
      expect(valence * beta).toBeLessThan(1)
    }
    for (const support of [0, -1])
      expect(gummyRoundingScale(d.vec3f(1, 2, 3), support)).toBe(0)
    const collapsed = gummyTetInradius(
      d.vec3f(0),
      d.vec3f(1, 0, 0),
      d.vec3f(0, 1, 0),
      d.vec3f(0.25, 0.25, 0),
    )
    const inverted = gummyTetInradius(
      d.vec3f(0),
      d.vec3f(1, 0, 0),
      d.vec3f(0, 1, 0),
      d.vec3f(0, 0, -1),
    )
    expect(gummyRoundingScale(d.vec3f(1), collapsed)).toBe(0)
    expect(gummyRoundingScale(d.vec3f(1), inverted)).toBe(0)
    expect(
      std.length(std.mul(d.vec3f(0), gummyRoundingScale(d.vec3f(0), 1))),
    ).toBe(0)
  })

  it('uses one coefficient for deformed and rest coordinates, preserving an affine material field', () => {
    const transform = (p: d.v3f) =>
      d.vec3f(2 * p.x + 0.3 * p.y + 4, 0.7 * p.y - 2, 1.2 * p.z + 0.4 * p.x + 1)
    const origin = regularTetrahedron[0]
    const world = regularTetrahedron.map(transform)
    const support = gummyTetInradius(world[0]!, world[1]!, world[2]!, world[3]!)
    const delta = std.mul(
      std.sub(
        std.add(std.add(world[1]!, world[2]!), world[3]!),
        std.mul(world[0]!, 3),
      ),
      gummyRoundingWeight(3),
    )
    const scale = gummyRoundingScale(delta, support)
    const roundedWorld = std.add(world[0]!, std.mul(delta, scale))
    const roundedRest = std.add(origin, std.mul(origin, -0.75 * scale))
    const transported = transform(roundedRest)
    for (let axis = 0; axis < 3; axis++)
      expect(roundedWorld[axis]).toBeCloseTo(transported[axis]!, 6)
  })

  it('keeps cap and skin patches on the same relaxed edge in opposite winding', () => {
    const radius = gummyTetInradius(...regularTetrahedron)
    const a = std.mul(regularTetrahedron[0], 0.9)
    const b = std.mul(regularTetrahedron[1], 0.9)
    for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      const cap = gummyBoundedTearPatch(
        a,
        b,
        std.mul(regularTetrahedron[2], 0.9),
        std.normalize(a),
        std.normalize(b),
        std.normalize(regularTetrahedron[2]),
        d.vec3f(1 - t, t, 0),
        d.vec3f(radius * 0.35),
      )
      const skin = gummyBoundedTearPatch(
        b,
        a,
        std.mul(regularTetrahedron[3], 0.9),
        std.normalize(b),
        std.normalize(a),
        std.normalize(regularTetrahedron[3]),
        d.vec3f(t, 1 - t, 0),
        d.vec3f(radius * 0.35),
      )
      for (let axis = 0; axis < 3; axis++)
        expect(cap[axis]).toBeCloseTo(skin[axis]!, 7)
    }
  })

  it('changes only exposed, closed boundary stars and keeps original mesh buffers intact', () => {
    const mesh = fixture(rightTetrahedron, [[0, 1, 2, 3]])
    const original = {
      positions: [...mesh.positions],
      tetrahedra: [...mesh.tetrahedra],
      surface: [...mesh.surface],
    }
    expect(rounding(mesh)).toEqual([
      [1, 2, 3],
      [0, 2, 3],
      [0, 1, 3],
      [0, 1, 2],
    ])
    expect([...mesh.positions]).toEqual(original.positions)
    expect([...mesh.tetrahedra]).toEqual(original.tetrahedra)
    expect([...mesh.surface]).toEqual(original.surface)
    const intact = fixture(rightTetrahedron, [[0, 1, 2, 3]], false)
    expect(rounding(intact)).toEqual([[], [], [], []])
    intact.surface[15] = EXPOSED_TEAR_FACE
    expect(rounding(intact)).toEqual([[1, 2, 3], [0, 2, 3], [0, 1, 3], []])
  })

  it('keeps coincident disconnected fragments on independent node stencils', () => {
    const mesh = fixture(
      [...rightTetrahedron, ...rightTetrahedron],
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
    )
    const initial = rounding(mesh)
    expect(initial).toEqual([
      [1, 2, 3],
      [0, 2, 3],
      [0, 1, 3],
      [0, 1, 2],
      [5, 6, 7],
      [4, 6, 7],
      [4, 5, 7],
      [4, 5, 6],
    ])
    for (let node = 4; node < 8; node++) mesh.positions[node * 4]! += 9
    expect(rounding(mesh)).toEqual(initial)
  })

  it('freezes a pinched vertex whose boundary link has two disjoint cycles', () => {
    const mesh = fixture(
      [...rightTetrahedron, [-1, 0, 0], [0, -1, 0], [0, 0, -1]],
      [
        [0, 1, 2, 3],
        [0, 4, 6, 5],
      ],
    )
    const stencils = rounding(mesh)
    expect(stencils[0]).toEqual([])
    expect(stencils.slice(1)).toEqual([
      [0, 2, 3],
      [0, 1, 3],
      [0, 1, 2],
      [0, 5, 6],
      [0, 4, 6],
      [0, 4, 5],
    ])
  })
})
