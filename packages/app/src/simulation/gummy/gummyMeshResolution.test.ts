/** Independent volume and topology checks for finer continuous material geometry. */
import { describe, expect, it } from 'vitest'
import { buildGummyBearMesh, EXTERIOR_FACE, gummyBearField } from './gummyMesh'
import type { GummyMesh, GummyVec3 } from './gummyMesh'

const standard = buildGummyBearMesh({ fracture: 'none', spacing: 0.14 })
const fine = buildGummyBearMesh({ fracture: 'none', spacing: 0.1 })
const point = (mesh: GummyMesh, node: number): GummyVec3 => [
  mesh.positions[node * 4]!,
  mesh.positions[node * 4 + 1]!,
  mesh.positions[node * 4 + 2]!,
]
const subtract = (a: GummyVec3, b: GummyVec3): GummyVec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const cross = (a: GummyVec3, b: GummyVec3): GummyVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: GummyVec3, b: GummyVec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const keyOf = (nodes: number[]) => [...nodes].sort((a, b) => a - b).join(':')
const parity = (nodes: number[]) =>
  nodes.reduce(
    (sign, node, i) =>
      sign *
      nodes.slice(i + 1).reduce((p, next) => p * (node > next ? -1 : 1), 1),
    1,
  )

function volumeFaces(mesh: GummyMesh) {
  const faces = new Map<
    string,
    { nodes: number[]; owners: number[]; winding: number }
  >()
  const signedVolumes: number[] = []
  for (let offset = 0; offset < mesh.tetrahedra.length; offset += 4) {
    const nodes = Array.from(mesh.tetrahedra.subarray(offset, offset + 4))
    const [a, b, c, d] = nodes.map((node) => point(mesh, node)) as [
      GummyVec3,
      GummyVec3,
      GummyVec3,
      GummyVec3,
    ]
    signedVolumes.push(
      dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6,
    )
    for (let opposite = 0; opposite < 4; opposite++) {
      const face = nodes.filter((_, corner) => corner !== opposite)
      const [p, q, r] = face.map((node) => point(mesh, node)) as [
        GummyVec3,
        GummyVec3,
        GummyVec3,
      ]
      const inward = subtract(point(mesh, nodes[opposite]!), p)
      if (dot(cross(subtract(q, p), subtract(r, p)), inward) > 0)
        [face[1], face[2]] = [face[2]!, face[1]!]
      const key = keyOf(face)
      const record = faces.get(key) ?? { nodes: face, owners: [], winding: 0 }
      record.owners.push(offset / 4)
      record.winding += parity(face)
      faces.set(key, record)
    }
  }
  return { faces, signedVolumes }
}

const standardTopology = volumeFaces(standard)
const fineTopology = volumeFaces(fine)

describe('continuous gummy material resolution', () => {
  it('keeps the default continuous geometry identical to the standard comparison', () => {
    const defaultMesh = buildGummyBearMesh({ fracture: 'none' })
    expect(defaultMesh).toEqual(standard)
    expect(standard.positions.length / 4).toBe(2244)
    expect(standard.tetrahedra.length / 4).toBe(7299)
    expect(standard.surface.length / 4).toBe(3592)
  })

  it('adds material degrees of freedom and reduces the largest available fracture facets', () => {
    const largestInteriorFace = (
      mesh: GummyMesh,
      topology: ReturnType<typeof volumeFaces>,
    ) => {
      let largest = 0
      for (const face of topology.faces.values()) {
        if (face.owners.length !== 2) continue
        const [a, b, c] = face.nodes.map((node) => point(mesh, node)) as [
          GummyVec3,
          GummyVec3,
          GummyVec3,
        ]
        largest = Math.max(
          largest,
          Math.hypot(...cross(subtract(b, a), subtract(c, a))) / 2,
        )
      }
      return largest
    }
    expect(fine.positions.length).toBeGreaterThan(standard.positions.length * 2)
    expect(fine.tetrahedra.length).toBeGreaterThan(
      standard.tetrahedra.length * 2,
    )
    expect(fine.tetrahedra.length).toBeLessThan(standard.tetrahedra.length * 3)
    expect(largestInteriorFace(fine, fineTopology)).toBeLessThan(
      largestInteriorFace(standard, standardTopology) * 0.55,
    )
    expect(fine.interfaces).toHaveLength(0)
    expect(new Set(fine.nodeRegions)).toEqual(new Set([0]))
  })

  it('forms one face-connected positive solid with exactly the advertised outward boundary', () => {
    expect(
      fineTopology.signedVolumes.every(
        (volume) => Number.isFinite(volume) && volume > 0,
      ),
    ).toBe(true)
    const adjacency: number[][] = Array.from(
      { length: fine.tetrahedra.length / 4 },
      () => [],
    )
    const boundary = new Map<string, number>()
    for (const [key, face] of fineTopology.faces) {
      expect(face.owners.length).toBeLessThanOrEqual(2)
      if (face.owners.length === 1) boundary.set(key, face.winding)
      else {
        expect(face.winding).toBe(0)
        adjacency[face.owners[0]!]!.push(face.owners[1]!)
        adjacency[face.owners[1]!]!.push(face.owners[0]!)
      }
    }
    const seen = new Set<number>([0])
    const queue = [0]
    for (let i = 0; i < queue.length; i++) {
      for (const next of adjacency[queue[i]!]!) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect(seen.size).toBe(fine.tetrahedra.length / 4)
    expect(boundary.size).toBe(fine.surface.length / 4)
    for (let offset = 0; offset < fine.surface.length; offset += 4) {
      const face = Array.from(fine.surface.subarray(offset, offset + 3))
      const key = keyOf(face)
      expect(fine.surface[offset + 3]).toBe(EXTERIOR_FACE)
      expect(boundary.get(key)).toBe(parity(face))
      boundary.delete(key)
    }
    expect(boundary.size).toBe(0)
  })

  it('has a closed spherical boundary enclosing the same volume as its tetrahedra', () => {
    const edges = new Map<string, { count: number; winding: number }>()
    const vertices = new Set<number>()
    let boundaryVolume = 0
    for (let offset = 0; offset < fine.surface.length; offset += 4) {
      const face = Array.from(fine.surface.subarray(offset, offset + 3))
      const [a, b, c] = face.map((node) => point(fine, node)) as [
        GummyVec3,
        GummyVec3,
        GummyVec3,
      ]
      boundaryVolume += dot(a, cross(b, c)) / 6
      for (let corner = 0; corner < 3; corner++) {
        const start = face[corner]!,
          end = face[(corner + 1) % 3]!
        vertices.add(start)
        const key = keyOf([start, end])
        const edge = edges.get(key) ?? { count: 0, winding: 0 }
        edge.count++
        edge.winding += start < end ? 1 : -1
        edges.set(key, edge)
      }
    }
    expect(
      [...edges.values()].filter(
        (edge) => edge.count !== 2 || edge.winding !== 0,
      ),
    ).toEqual([])
    expect(vertices.size - edges.size + fine.surface.length / 4).toBe(2)
    expect(boundaryVolume).toBeCloseTo(fine.restVolume, 6)
    expect(
      fineTopology.signedVolumes.reduce((sum, volume) => sum + volume, 0),
    ).toBeCloseTo(boundaryVolume, 9)
  })

  it('converges toward the analytic mould volume without changing its world scale', () => {
    // An independent midpoint integration samples the implicit mould directly,
    // rather than using the tetrahedral clipping or boundary implementation.
    const cells = 96,
      step = 3 / cells
    let inside = 0
    for (let x = 0; x < cells; x++)
      for (let y = 0; y < cells; y++)
        for (let z = 0; z < cells; z++)
          if (
            gummyBearField([
              -1.5 + (x + 0.5) * step,
              (y + 0.5) * step,
              -1.5 + (z + 0.5) * step,
            ]) <= 0
          )
            inside++
    const referenceVolume = inside * step ** 3
    const standardError = Math.abs(standard.restVolume - referenceVolume)
    const fineError = Math.abs(fine.restVolume - referenceVolume)
    expect(fineError / referenceVolume).toBeLessThan(0.025)
    expect(fineError).toBeLessThan(standardError * 0.75)
    expect(fine.bounds.min[1]).toBe(0)
    // The ear mould ends at y=2.34+0.22; refinement recovers its round tip.
    expect(fine.bounds.max[1]).toBeCloseTo(2.56, 2)
    expect(Math.abs(fine.bounds.max[1] - standard.bounds.max[1])).toBeLessThan(
      0.04,
    )
    expect(Array.from(fine.positions).every(Number.isFinite)).toBe(true)
    for (let offset = 0; offset < fine.positions.length; offset += 4) {
      const inverseMass = fine.positions[offset + 3]!
      const height = fine.positions[offset + 1]!
      // Pinning is classified before conversion to float32; threshold samples
      // can round to either side of 0.065 when packed for the GPU.
      if (height < 0.065 - 1e-6) expect(inverseMass).toBe(0)
      if (height > 0.065 + 1e-6) expect(inverseMass).toBeGreaterThan(0)
      expect(inverseMass).toBeGreaterThanOrEqual(0)
    }
  })
})
