/** Boundary smoothing must cross intact seams without ever averaging hidden tear surfaces. */
import { describe, expect, it } from 'vitest'
import { buildGummyBearMesh, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { prepareGummySurface } from './gummySurface'

const fixture = () => ({
  positions: new Float32Array([
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1,
  ]),
  restNormals: new Float32Array(20),
  surface: new Uint32Array([
    0,
    1,
    2,
    EXTERIOR_FACE,
    3,
    2,
    4,
    EXTERIOR_FACE,
    0,
    2,
    1,
    0,
  ]),
  interfaces: new Uint32Array(8),
})

/** Read the public packed edge records, checking each referenced tail record. */
function edgeInterfaces(records: Uint32Array, faceCount: number, head: number) {
  const ids: number[] = []
  const seen = new Set<number>()
  while (head) {
    expect(head).toBeGreaterThanOrEqual(faceCount)
    expect(head).toBeLessThan(records.length / 4)
    expect(seen.has(head)).toBe(false)
    seen.add(head)
    ids.push(records[head * 4]! - 1)
    head = records[head * 4 + 1]!
  }
  return ids
}

describe('gummy exterior adjacency', () => {
  it('shares exterior triangles at rest-coincident seam nodes and excludes cut faces', () => {
    const data = prepareGummySurface(fixture())
    const entries = (node: number) =>
      Array.from(
        data.adjacent.subarray(
          data.ranges[node * 2]! * 2,
          (data.ranges[node * 2]! + data.ranges[node * 2 + 1]!) * 2,
        ),
      )
    expect(entries(0)).toEqual([0, 0, 1, 3])
    expect(entries(3)).toEqual(entries(0))
    expect(entries(1)).toEqual([0, 1])
    const ownEntries = (node: number) =>
      entries(node + fixture().positions.length / 4)
    expect(ownEntries(0)).toEqual([0, 0, 2, 0])
    expect(ownEntries(3)).toEqual([1, 3])
    expect(Array.from(data.flatEdges)).toEqual([
      3, 4, 5, 0, 5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ])
    expect(data.indices).toHaveLength(2 * 16 * 3 + 3)
    expect(Array.from(data.indices.slice(-3))).toEqual([96, 97, 98])
    expect(Array.from(data.corners.slice(-12))).toEqual([
      1, 0, 0, 2, 0, 1, 0, 2, 0, 0, 1, 2,
    ])
  })

  it('retains every interface sharing a rest edge and deduplicates opposite cap faces', () => {
    const mesh = fixture()
    mesh.surface = new Uint32Array([...mesh.surface, 3, 1, 4, 1, 4, 1, 3, 1])
    mesh.interfaces = new Uint32Array(16)
    const data = prepareGummySurface(mesh)
    const ids = (face: number, edge: number) =>
      edgeInterfaces(data.flatEdges, 5, data.flatEdges[face * 4 + edge]!)
    expect(ids(0, 0)).toEqual([0, 1])
    expect(ids(0, 1)).toEqual([0])
    expect(ids(0, 2)).toEqual([0])
    expect(ids(1, 0)).toEqual(ids(0, 2))
    expect(ids(1, 1)).toEqual([])
    expect(ids(1, 2)).toEqual([1])
    expect(Array.from(data.flatEdges.slice(8, 20))).toEqual(
      new Array(12).fill(0),
    )
  })

  it('validates surface metadata before allocating GPU buffers', () => {
    const mesh = fixture()
    mesh.surface[0] = 99
    expect(() => prepareGummySurface(mesh)).toThrow('node index')
    mesh.surface[0] = 0
    mesh.surface[3] = 1
    expect(() => prepareGummySurface(mesh)).toThrow('interface index')
    mesh.surface[3] = EXTERIOR_FACE
    mesh.interfaces = new Uint32Array(7)
    expect(() => prepareGummySurface(mesh)).toThrow('buffer lengths')
  })

  it('prepares finite cohesive edge lists for the fine fracture mesh', () => {
    const mesh = buildGummyBearMesh({ fracture: 'fine', pinnedFeet: false })
    const data = prepareGummySurface(mesh)
    const faceCount = mesh.surface.length / 4
    let cohesiveEdges = 0
    for (let face = 0; face < faceCount; face++) {
      if (mesh.surface[face * 4 + 3] !== EXTERIOR_FACE) continue
      for (let edge = 0; edge < 3; edge++) {
        const ids = edgeInterfaces(
          data.flatEdges,
          faceCount,
          data.flatEdges[face * 4 + edge]!,
        )
        if (ids.length) cohesiveEdges++
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) {
          expect(id).toBeGreaterThanOrEqual(0)
          expect(id).toBeLessThan(mesh.interfaces.length / 8)
        }
      }
    }
    expect(cohesiveEdges).toBeGreaterThan(0)
  })

  it('keeps the fine mesh exposed-boundary adjacency inside each exact node and region', () => {
    const mesh = buildGummyBearMesh({ fracture: 'fine', pinnedFeet: false })
    const data = prepareGummySurface(mesh)
    const count = mesh.positions.length / 4
    let capEntries = 0
    for (let node = 0; node < count; node++) {
      const start = data.ranges[(count + node) * 2]! * 2
      const end = start + data.ranges[(count + node) * 2 + 1]! * 2
      for (let i = start; i < end; i += 2) {
        const face = data.adjacent[i]! * 4
        expect(data.adjacent[i + 1]).toBe(node)
        const corners = Array.from(mesh.surface.slice(face, face + 3))
        expect(corners).toContain(node)
        for (const corner of corners)
          expect(mesh.nodeRegions[corner]).toBe(mesh.nodeRegions[node])
        if (mesh.surface[face + 3] !== EXTERIOR_FACE) capEntries++
      }
    }
    expect(capEntries).toBe((mesh.interfaces.length / 8) * 6)
  })

  it('prepares every actual mesh node with only boundary adjacency', () => {
    const mesh = buildGummyBearMesh()
    const data = prepareGummySurface(mesh)
    expect(data.ranges.length).toBe(mesh.positions.length)
    let exterior = 0
    for (let i = 3; i < mesh.surface.length; i += 4)
      if (mesh.surface[i] === EXTERIOR_FACE) exterior++
    expect(data.indices.length).toBe(
      exterior * 16 * 3 + (mesh.surface.length / 4 - exterior) * 3,
    )
    for (let i = 0; i < data.corners.length; i += 4) {
      expect(
        data.corners[i]! + data.corners[i + 1]! + data.corners[i + 2]!,
      ).toBe(1)
      expect(data.corners[i + 3]).toBeLessThan(mesh.surface.length / 4)
    }
    const count = mesh.positions.length / 4
    const localStart = data.ranges[count * 2]! * 2
    for (let i = 0; i < localStart; i += 2)
      expect(mesh.surface[data.adjacent[i]! * 4 + 3]).toBe(EXTERIOR_FACE)
    for (let node = 0; node < count; node++) {
      const start = data.ranges[(count + node) * 2]! * 2
      const end = start + data.ranges[(count + node) * 2 + 1]! * 2
      for (let i = start; i < end; i += 2) {
        expect(data.adjacent[i + 1]).toBe(node)
        const face = data.adjacent[i]! * 4
        expect(Array.from(mesh.surface.slice(face, face + 3))).toContain(node)
      }
    }
  })
})
