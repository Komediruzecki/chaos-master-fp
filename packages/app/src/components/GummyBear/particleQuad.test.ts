/** Particle proxy triangles must cover their square once before analytic sphere clipping. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { particleQuadCorner, particleSphereInterval } from './particleGummyMath'

type Point = readonly [number, number]
type Triangle = readonly [Point, Point, Point]

function corner(id: number): Point {
  const value = particleQuadCorner(id)
  return [value.x, value.y]
}

function triangles(): readonly [Triangle, Triangle] {
  return [
    [corner(0), corner(1), corner(2)],
    [corner(3), corner(4), corner(5)],
  ]
}

function cross(a: Point, b: Point, p: Point) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

function edges(point: Point, triangle: Triangle) {
  return [
    cross(triangle[0], triangle[1], point),
    cross(triangle[1], triangle[2], point),
    cross(triangle[2], triangle[0], point),
  ]
}

function covers(point: Point, triangle: Triangle) {
  const signs = edges(point, triangle)
  return (
    signs.every((value) => value > 1e-10) ||
    signs.every((value) => value < -1e-10)
  )
}

function coverage(point: Point, pair: readonly Triangle[]) {
  return pair.filter((triangle) => covers(point, triangle)).length
}

describe('particle proxy quad', () => {
  it('has consistent winding and the signed area of a complete two-unit square', () => {
    const pair = triangles()
    const signedAreas = pair.map(
      (triangle) => cross(triangle[0], triangle[1], triangle[2]) / 2,
    )
    expect(signedAreas).toEqual([2, 2])
    expect(signedAreas.reduce((sum, area) => sum + area, 0)).toBe(4)
  })

  it('covers each interior point once without an overlapping or missing wedge', () => {
    const pair = triangles()
    // The old triangles left the right wedge empty and covered the left wedge twice.
    expect(coverage([0.6, 0.1], pair)).toBe(1)
    expect(coverage([-0.6, 0.1], pair)).toBe(1)
    let checked = 0
    for (let row = 0; row < 23; row++) {
      for (let column = 0; column < 29; column++) {
        const point: Point = [
          -1 + (2 * (column + 0.37)) / 29,
          -1 + (2 * (row + 0.61)) / 23,
        ]
        if (
          pair.some((triangle) =>
            edges(point, triangle).some((edge) => Math.abs(edge) < 1e-10),
          )
        )
          continue
        expect(coverage(point, pair)).toBe(1)
        checked++
      }
    }
    expect(checked).toBe(667)
  })

  it('allows the fragment sphere test to run across the entire interior disc', () => {
    const pair = triangles()
    const ray = d.vec3f(0, 0, -1)
    for (let row = 0; row < 23; row++) {
      for (let column = 0; column < 29; column++) {
        const point: Point = [
          -1 + (2 * (column + 0.37)) / 29,
          -1 + (2 * (row + 0.61)) / 23,
        ]
        if (point[0] ** 2 + point[1] ** 2 >= 0.9) continue
        if (
          pair.some((triangle) =>
            edges(point, triangle).some((edge) => Math.abs(edge) < 1e-10),
          )
        )
          continue
        const hit = particleSphereInterval(
          d.vec3f(point[0], point[1], 3),
          ray,
          d.vec3f(0),
          1,
        )
        expect(hit.y).toBeGreaterThan(hit.x)
        expect(coverage(point, pair)).toBe(1)
      }
    }
  })
})
