/** Numerical surface checks: volume, disconnected support, droplets, cube topology and bounded indirect draws. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { MARCHING_GUMMY_CELL_SCALE, MARCHING_GUMMY_FIXED_SCALE, MARCHING_GUMMY_ISO, MARCHING_GUMMY_RADIUS_SCALE, marchingGummyCrossing, marchingGummyDensity, marchingGummyDomain, marchingGummyDrawCount, marchingGummyGrid, } from './marchingGummyMath'
import { marchingGummyFinalize, marchingGummyNormalize, marchingGummyPolygonize, marchingGummyScatter, } from './marchingGummySurfaceShaders'
import { MARCHING_GUMMY_CORNERS, MARCHING_GUMMY_EDGES, MARCHING_GUMMY_TRIANGLES, } from './marchingGummyTables'

describe('GPU marching-cubes jelly surface', () => {
  it.each([
    marchingGummyScatter,
    marchingGummyNormalize,
    marchingGummyPolygonize,
    marchingGummyFinalize,
  ])('resolves a real compute entrypoint', (shader) => {
    const source = tgpu.resolve([shader], { names: 'strict' })
    expect(source).toContain('@compute')
    expect(source).not.toContain('NaN')
  })

  it('integrates the compact density to the represented particle volume', () => {
    const spacing = 0.08,
      radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
    const weight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
    let integral = 0
    const step = radius / 10000
    for (let index = 0; index < 10000; index++) {
      const r = (index + 0.5) * step
      integral +=
        4 *
        Math.PI *
        r *
        r *
        marchingGummyDensity(d.vec3f(r, 0, 0), radius, weight) *
        step
    }
    expect(integral).toBeCloseTo(spacing ** 3, 9)
    expect(marchingGummyDensity(d.vec3f(radius, 0, 0), radius, weight)).toBe(0)
    expect(
      marchingGummyDensity(d.vec3f(2 * radius, 0, 0), radius, weight),
    ).toBe(0)
  })

  it('retains a detached particle at every grid phase, including the worst cell centre', () => {
    const spacing = 0.08,
      radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
    const weight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
    let minimumPeak = Infinity
    for (let x = 0; x <= 10; x++)
      for (let y = 0; y <= 10; y++)
        for (let z = 0; z <= 10; z++) {
          const offset = [x, y, z].map(
            (axis) =>
              (axis / 10 - Math.round(axis / 10)) *
              spacing *
              MARCHING_GUMMY_CELL_SCALE,
          )
          const density = marchingGummyDensity(
            d.vec3f(offset[0]!, offset[1]!, offset[2]!),
            radius,
            weight,
          )
          const quantized =
            Math.round(density * MARCHING_GUMMY_FIXED_SCALE) /
            MARCHING_GUMMY_FIXED_SCALE
          minimumPeak = Math.min(minimumPeak, quantized)
          expect(quantized).toBeGreaterThan(MARCHING_GUMMY_ISO)
        }
    expect(minimumPeak).toBe(0.135498046875)
  })

  it('leaves a real air gap between kernels beyond their combined support', () => {
    const radius = 0.12
    const weight = 0.08 ** 3 / ((4 * Math.PI * radius ** 3) / 3)
    const centres = [-0.19, 0.19]
    for (let x = -0.06; x <= 0.061; x += 0.01) {
      const density = centres.reduce(
        (sum, centre) =>
          sum + marchingGummyDensity(d.vec3f(x - centre, 0, 0), radius, weight),
        0,
      )
      expect(density).toBe(0)
    }
  })

  it('closes dense particles at every solver wall with empty outer ghost nodes', () => {
    const spacing = 0.08
    const radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
    const weight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
    const bounds = { min: [-3.84, -0.32, -3.84], max: [3.84, 7.36, 3.84] }
    const domain = marchingGummyDomain(bounds, radius)
    for (let axis = 0; axis < 3; axis++) {
      const particle = bounds.min[axis]! + 0.51 * spacing * 2
      const priorOffset = d.vec3f(bounds.min[axis]! - particle, 0, 0)
      // A dense contact can cross the old unpadded box and would be visibly clipped there.
      expect(
        2 * marchingGummyDensity(priorOffset, radius, weight),
      ).toBeGreaterThan(MARCHING_GUMMY_ISO)
      expect(
        marchingGummyDensity(
          d.vec3f(domain.min[axis]! - particle, 0, 0),
          radius,
          weight,
        ),
      ).toBe(0)
      const upperParticle = bounds.max[axis]! - 1.51 * spacing * 2
      expect(
        marchingGummyDensity(
          d.vec3f(domain.max[axis]! - upperParticle, 0, 0),
          radius,
          weight,
        ),
      ).toBe(0)
    }
    const padded = marchingGummyGrid(
      domain,
      spacing * MARCHING_GUMMY_CELL_SCALE,
    )
    expect(padded.gridSize).toEqual([134, 134, 134])
    expect(padded.bytes).toBe(91411968)
    expect(padded.bytes + 2445 * 16).toBeLessThan(90 * 1024 * 1024)
    expect(Math.ceil(padded.nodeCount / 64)).toBeLessThan(65535)
  })

  it('contains 256 real cube cases, each using only edges with an actual sign crossing', () => {
    expect(MARCHING_GUMMY_TRIANGLES.length).toBe(256 * 16)
    for (let cubeCase = 0; cubeCase < 256; cubeCase++) {
      const row = Array.from(
        MARCHING_GUMMY_TRIANGLES.slice(cubeCase * 16, cubeCase * 16 + 16),
      )
      const count = row.indexOf(-1)
      expect(count % 3).toBe(0)
      expect(count).toBeLessThanOrEqual(15)
      expect(row.slice(count).every((value) => value === -1)).toBe(true)
      for (const edgeIndex of row.slice(0, count)) {
        const edge = MARCHING_GUMMY_EDGES[edgeIndex]!
        expect(edge).toBeDefined()
        expect(
          ((cubeCase >> edge[0]) & 1) !== ((cubeCase >> edge[1]) & 1),
        ).toBe(true)
      }
    }
    expect(Array.from(MARCHING_GUMMY_TRIANGLES.slice(16, 20))).toEqual([
      0, 8, 3, -1,
    ])
    expect(MARCHING_GUMMY_TRIANGLES[0]).toBe(-1)
    expect(MARCHING_GUMMY_TRIANGLES[255 * 16]).toBe(-1)
  })

  it('places a one-corner surface exactly halfway along its three cube edges', () => {
    const result = Array.from(MARCHING_GUMMY_TRIANGLES.slice(16, 19)).map(
      (edgeIndex) => {
        const edge = MARCHING_GUMMY_EDGES[edgeIndex]!
        const a = MARCHING_GUMMY_CORNERS[edge[0]]
        const b = MARCHING_GUMMY_CORNERS[edge[1]]
        const t = marchingGummyCrossing(
          edge[0] === 0 ? 0 : 1,
          edge[1] === 0 ? 0 : 1,
          0.5,
        )
        return a.map((value, axis) => value + (b[axis]! - value) * t)
      },
    )
    expect(result).toEqual([
      [0.5, 0, 0],
      [0, 0, 0.5],
      [0, 0.5, 0],
    ])
    expect(marchingGummyCrossing(0.2, 0.6, 0.3)).toBeCloseTo(0.25, 12)
    expect(marchingGummyCrossing(0.6, 0.2, 0.3)).toBeCloseTo(0.75, 12)
    expect(marchingGummyCrossing(0.2, 0.2, 0.2)).toBe(0.5)
  })

  it('bounds GPU draw count to complete initialized triangles at overflow', () => {
    expect(marchingGummyDrawCount(0, 300000)).toBe(0)
    expect(marchingGummyDrawCount(123, 300000)).toBe(123)
    expect(marchingGummyDrawCount(300003, 300000)).toBe(300000)
    expect(marchingGummyDrawCount(123, 122)).toBe(120)
    expect(marchingGummyDrawCount(0xffffffff, 300000)).toBe(300000)
  })

  it('covers the full MPM domain within a bounded surface memory budget', () => {
    const grid = marchingGummyGrid(
      { min: [-3.84, -0.32, -3.84], max: [3.84, 7.36, 3.84] },
      0.08,
    )
    expect(grid.gridSize).toEqual([97, 97, 97])
    expect(grid.nodeCount).toBe(912673)
    expect(grid.cellCount).toBe(884736)
    expect(grid.bytes).toBe(43622176)
    const fine = marchingGummyGrid(
      { min: [-3.84, -0.32, -3.84], max: [3.84, 7.36, 3.84] },
      0.08 * MARCHING_GUMMY_CELL_SCALE,
    )
    expect(fine.gridSize).toEqual([129, 129, 129])
    expect(fine.bytes).toBe(83110688)
    expect(fine.bytes).toBeLessThan(90 * 1024 * 1024)
    expect(() =>
      marchingGummyGrid(
        { min: [-3.84, -0.32, -3.84], max: [3.84, 7.36, 3.84] },
        0.01,
      ),
    ).toThrow('memory budget')
    expect(() =>
      marchingGummyGrid({ min: [0, 0, 0], max: [1, 1, 1] }, 0),
    ).toThrow('cell size')
  })
})
