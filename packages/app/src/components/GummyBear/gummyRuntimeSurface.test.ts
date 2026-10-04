/** Runtime cracks keep close or coincident lips separate and expose correctly wound, finite cap shading. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { gummyTearVertexWeights } from './gummyRuntimeSurface'
import { gummyNormalsCompute, gummyVertex } from './gummyShaders'
import { prepareGummySurface } from './gummySurface'
import { gummyCapNormal, gummyExposedCapAreaNormal, gummyPnPosition, } from './gummySurfaceMath'

function splitTetrahedra() {
  const positions = new Float32Array([
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 1, 0, 0, -1, 1,
  ])
  return {
    positions,
    tetrahedra: new Uint32Array([0, 1, 2, 3, 4, 6, 5, 7]),
    restNormals: new Float32Array(
      Array.from({ length: 8 }, () => [0, 0, 1, 0]).flat(),
    ),
    interfaces: new Uint32Array(0),
    runtimeFracture: true,
    surface: new Uint32Array([
      1,
      2,
      3,
      EXTERIOR_FACE,
      0,
      3,
      2,
      EXTERIOR_FACE,
      0,
      1,
      3,
      EXTERIOR_FACE,
      0,
      2,
      1,
      EXPOSED_TEAR_FACE,
      6,
      5,
      7,
      EXTERIOR_FACE,
      4,
      7,
      5,
      EXTERIOR_FACE,
      4,
      6,
      7,
      EXTERIOR_FACE,
      4,
      5,
      6,
      EXPOSED_TEAR_FACE,
    ]),
  }
}

function adjacentEntries(
  data: ReturnType<typeof prepareGummySurface>,
  node: number,
) {
  const start = data.ranges[node * 2]! * 2
  const end = start + data.ranges[node * 2 + 1]! * 2
  return Array.from(data.adjacent.subarray(start, end))
}

describe('shared-node runtime tear surfaces', () => {
  it('keeps wet influence on the opened component despite coincident rest positions', () => {
    const mesh = splitTetrahedra()
    mesh.surface[31] = EXTERIOR_FACE
    const data = prepareGummySurface(mesh)
    const wetFaces = Array.from(
      data.metadata.filter((_, index) => index % 4 === 3),
    )
    expect(wetFaces).toEqual([
      0xffffff, 0xffffff, 0xffffff, 0xffffff, 0, 0, 0, 0,
    ])
    for (let offset = 3; offset < mesh.surface.length; offset += 4)
      mesh.surface[offset] = EXTERIOR_FACE
    const intact = prepareGummySurface(mesh)
    expect(
      Array.from(intact.metadata.filter((_, index) => index % 4 === 3)),
    ).toEqual(new Array(8).fill(0))
  })

  it('bounds the wet material neighbourhood to two shared-edge rings without thickness assumptions', () => {
    const tets: [number, number, number, number][] = [
      [0, 1, 2, 3],
      [3, 4, 5, 6],
      [6, 7, 8, 9],
    ]
    const incident = Array.from({ length: 10 }, (_, node) =>
      tets.filter((tet) => tet.includes(node)),
    )
    const weights = gummyTearVertexWeights(
      incident,
      new Uint32Array([0, 1, 2, EXPOSED_TEAR_FACE]),
    )
    expect(Array.from(weights)).toEqual([
      255, 255, 255, 255, 128, 128, 128, 0, 0, 0,
    ])
  })
  it('never welds the normals of distinct crack lips even at identical rest coordinates', () => {
    const mesh = splitTetrahedra()
    const data = prepareGummySurface(mesh)
    expect(adjacentEntries(data, 0)).toEqual([1, 0, 2, 0])
    expect(adjacentEntries(data, 4)).toEqual([5, 4, 6, 4])
    expect(adjacentEntries(data, 8)).toEqual([1, 0, 2, 0, 3, 0])
    expect(adjacentEntries(data, 12)).toEqual([5, 4, 6, 4, 7, 4])
    const legacy = prepareGummySurface({ ...mesh, runtimeFracture: false })
    expect(adjacentEntries(legacy, 0)).toEqual(adjacentEntries(legacy, 4))
    expect(adjacentEntries(legacy, 0)).toHaveLength(8)
  })

  it('accepts exposed caps without damage entries and emits non-overflowing permanent edge records', () => {
    const mesh = splitTetrahedra()
    const data = prepareGummySurface(mesh)
    const faceCount = mesh.surface.length / 4
    let permanentEdges = 0
    for (let face = 0; face < faceCount; face++) {
      if (mesh.surface[face * 4 + 3] !== EXTERIOR_FACE) continue
      for (let edge = 0; edge < 3; edge++) {
        const head = data.flatEdges[face * 4 + edge]!
        if (!head) continue
        expect(head).toBeGreaterThanOrEqual(faceCount)
        expect(head).toBeLessThan(data.flatEdges.length / 4)
        expect(data.flatEdges[head * 4]).toBe(0xffffffff)
        expect(data.flatEdges[head * 4 + 1]).toBe(0)
        permanentEdges++
      }
    }
    expect(permanentEdges).toBe(6)
    expect(data.indices).toHaveLength(8 * 48)
    expect(data.ranges).toHaveLength(positionsCount(mesh) * 6)
    expect(
      Array.from(data.metadata.filter((_, index) => index % 4 === 0)),
    ).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
  })

  it('uses opposite outward cap normals and keeps each newly closed tetra surface watertight', () => {
    const mesh = splitTetrahedra()
    const point = (node: number) =>
      d.vec3f(
        mesh.positions[node * 4]!,
        mesh.positions[node * 4 + 1]!,
        mesh.positions[node * 4 + 2]!,
      )
    const top = gummyExposedCapAreaNormal(point(0), point(2), point(1), 1)
    const bottom = gummyExposedCapAreaNormal(point(4), point(5), point(6), 1)
    expect([top.x, top.y, top.z]).toEqual([0, 0, -1])
    expect([bottom.x, bottom.y, bottom.z]).toEqual([0, 0, 1])
    const guarded = gummyCapNormal(d.vec3f(0, 0, 2), top)
    expect([guarded.x, guarded.y, guarded.z]).toEqual([0, 0, -1])
    for (const start of [0, 16]) {
      const edges = new Map<string, number>()
      for (let offset = start; offset < start + 16; offset += 4) {
        const nodes = Array.from(mesh.surface.subarray(offset, offset + 3))
        for (let i = 0; i < 3; i++) {
          const a = nodes[i]!,
            b = nodes[(i + 1) % 3]!
          const key = `${Math.min(a, b)}:${Math.max(a, b)}`
          edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1))
        }
      }
      expect(edges.size).toBe(6)
      expect([...edges.values()]).toEqual(new Array(6).fill(0))
    }
  })

  it('meets an exposed linear cap edge without flattening an unrelated intact PN edge', () => {
    const mesh = splitTetrahedra(),
      data = prepareGummySurface(mesh)
    const a = d.vec3f(0),
      b = d.vec3f(1, 0, 0),
      c = d.vec3f(0, 0, 1)
    const heads = data.flatEdges.subarray(8, 11)
    const mask = d.vec3f(
      ...(Array.from(heads, (head) => (head ? 1 : 0)) as [
        number,
        number,
        number,
      ]),
    )
    expect([mask.x, mask.y, mask.z]).toEqual([1, 0, 0])
    const curved = gummyPnPosition(
      a,
      b,
      c,
      d.vec3f(0.8, 0.6, 0),
      d.vec3f(-0.8, 0.6, 0),
      d.vec3f(0, 1, 0),
      d.vec3f(0.5, 0.5, 0),
      d.vec3f(0),
    )
    const meeting = gummyPnPosition(
      a,
      b,
      c,
      d.vec3f(0.8, 0.6, 0),
      d.vec3f(-0.8, 0.6, 0),
      d.vec3f(0, 1, 0),
      d.vec3f(0.5, 0.5, 0),
      mask,
    )
    expect(curved.y).toBeCloseTo(-0.12, 6)
    expect([meeting.x, meeting.y, meeting.z]).toEqual([0.5, 0, 0])
  })

  it('resolves the permanent marker branches in surface and normal shaders', () => {
    for (const shader of [gummyVertex, gummyNormalsCompute]) {
      const source = tgpu.resolve([shader], { names: 'strict' })
      expect(source).toContain('4294967294')
      expect(source).not.toContain('NaN')
    }
  })
})

function positionsCount(mesh: ReturnType<typeof splitTetrahedra>) {
  return mesh.positions.length / 4
}
