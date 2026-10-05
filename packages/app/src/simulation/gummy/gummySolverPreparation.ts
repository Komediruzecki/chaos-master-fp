/** Exact-order constraint coloring and reusable rest geometry for topology-only node splits. */
import { prepareGummyJellyTets } from './gummyJelly'
import type { GummySolverMesh } from './gummySolver'

const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
] as const

/** Greedy colors include every written node, including pinned nodes: no write/write races. */
export function colorGummyConstraints(
  indices: Uint32Array,
  stride: number,
  active: number,
) {
  if (stride < active || active < 1 || indices.length % stride)
    throw new Error('Invalid gummy constraint stride')
  let nodeCount = 0
  for (let i = 0; i < indices.length; i++)
    if (i % stride < active) nodeCount = Math.max(nodeCount, indices[i]! + 1)
  // Normal meshes need 48 colors. Union two bitsets per node instead of probing
  // all preceding colors through nested Map/Set lookups. Overflow keeps the
  // original greedy order for unusual meshes needing more than 64 colors.
  const low = new Uint32Array(nodeCount)
  const high = new Uint32Array(nodeCount)
  const overflow = new Map<number, Set<number>>()
  const batches: number[][] = []
  for (let id = 0; id < indices.length / stride; id++) {
    let usedLow = 0
    let usedHigh = 0
    for (let n = 0; n < active; n++) {
      const node = indices[id * stride + n]!
      usedLow |= low[node]!
      usedHigh |= high[node]!
    }
    const freeLow = ~usedLow
    const freeHigh = ~usedHigh
    let color = freeLow
      ? 31 - Math.clz32(freeLow & -freeLow)
      : freeHigh
        ? 63 - Math.clz32(freeHigh & -freeHigh)
        : 64
    if (color === 64)
      while (true) {
        let conflict = false
        for (let n = 0; n < active; n++)
          if (overflow.get(indices[id * stride + n]!)?.has(color))
            conflict = true
        if (!conflict) break
        color++
      }
    ;(batches[color] ??= []).push(id)
    for (let n = 0; n < active; n++) {
      const node = indices[id * stride + n]!
      if (color < 32) low[node]! |= 1 << color
      else if (color < 64) high[node]! |= 1 << (color - 32)
      else {
        const colors = overflow.get(node) ?? new Set<number>()
        colors.add(color)
        overflow.set(node, colors)
      }
    }
  }
  const order = new Uint32Array(indices.length / stride)
  let offset = 0
  const ranges = batches.map((ids) => {
    order.set(ids, offset)
    const range = { offset, count: ids.length }
    offset += ids.length
    return range
  })
  return { order, ranges }
}

/** Rest geometry is CPU preprocessing; all evolving positions and constraints live on GPU. */
export function prepareGummyTets(mesh: GummySolverMesh) {
  validateGummyMesh(mesh)
  const data = new Float32Array((mesh.tetrahedra.length / 4) * 12)
  const ids = new Uint32Array(data.buffer)
  for (let tet = 0; tet < mesh.tetrahedra.length / 4; tet++) {
    const vertices = Array.from(mesh.tetrahedra.subarray(tet * 4, tet * 4 + 4))
    ids.set(vertices, tet * 12)
    for (let edge = 0; edge < EDGES.length; edge++) {
      const pair = EDGES[edge]!
      const a = vertices[pair[0]]! * 4,
        b = vertices[pair[1]]! * 4
      data[tet * 12 + 4 + edge] = Math.hypot(
        mesh.positions[a]! - mesh.positions[b]!,
        mesh.positions[a + 1]! - mesh.positions[b + 1]!,
        mesh.positions[a + 2]! - mesh.positions[b + 2]!,
      )
    }
    const a = vertices[0]! * 4
    const e = vertices
      .slice(1)
      .map((v) => [
        mesh.positions[v * 4]! - mesh.positions[a]!,
        mesh.positions[v * 4 + 1]! - mesh.positions[a + 1]!,
        mesh.positions[v * 4 + 2]! - mesh.positions[a + 2]!,
      ])
    const [b, c, f] = e as [number[], number[], number[]]
    const volume =
      (b[0]! * (c[1]! * f[2]! - c[2]! * f[1]!) +
        b[1]! * (c[2]! * f[0]! - c[0]! * f[2]!) +
        b[2]! * (c[0]! * f[1]! - c[1]! * f[0]!)) /
      6
    if (volume <= 0.0000000000000001)
      throw new Error('Gummy tets must have positive nonzero rest volume')
    data[tet * 12 + 10] = volume
  }
  return data
}

function validateGummyMesh(mesh: GummySolverMesh) {
  if (
    !mesh.positions.length ||
    mesh.positions.length % 4 ||
    !mesh.tetrahedra.length ||
    mesh.tetrahedra.length % 4 ||
    mesh.interfaces.length % 8
  )
    throw new Error('Invalid gummy mesh buffer lengths')
  const count = mesh.positions.length / 4
  for (let i = 0; i < mesh.positions.length; i++)
    if (
      !Number.isFinite(mesh.positions[i]) ||
      (i % 4 === 3 && mesh.positions[i]! < 0)
    )
      throw new Error('Invalid gummy position or inverse mass')
  for (const id of mesh.tetrahedra)
    if (id >= count) throw new Error('Gummy tet node index out of range')
  for (let i = 0; i < mesh.interfaces.length; i++)
    if (i % 8 < 6 && mesh.interfaces[i]! >= count)
      throw new Error('Gummy interface node index out of range')
}

export function prepareGummySolverGeometry(
  mesh: GummySolverMesh,
  jelly: boolean,
) {
  return {
    restTets: prepareGummyTets(mesh),
    jellyTets: jelly ? prepareGummyJellyTets(mesh) : undefined,
  }
}

/** A cache belongs to one scene, so its previous rest state cannot outlive that scene. */
export function createGummySolverPreparationCache() {
  let previous:
    | {
        positions: Float32Array
        tetrahedra: Uint32Array
        prepared: ReturnType<typeof prepareGummySolverGeometry>
      }
    | undefined
  return {
    prepare(mesh: GummySolverMesh, jelly: boolean, sourceNodes?: Uint32Array) {
      validateGummyMesh(mesh)
      let reusable =
        !!previous &&
        !!sourceNodes &&
        sourceNodes.length * 4 === mesh.positions.length &&
        previous.tetrahedra.length === mesh.tetrahedra.length &&
        (!jelly || !!previous.prepared.jellyTets)
      if (reusable && previous && sourceNodes) {
        // Validate ancestry rather than equating coincident positions: merging
        // previously independent nodes must never be mistaken for a split.
        for (let node = 0; node < sourceNodes.length && reusable; node++) {
          const source = sourceNodes[node]! * 4
          if (source >= previous.positions.length) reusable = false
          else
            for (let axis = 0; axis < 3; axis++)
              if (
                mesh.positions[node * 4 + axis] !==
                previous.positions[source + axis]
              )
                reusable = false
        }
        for (
          let corner = 0;
          corner < mesh.tetrahedra.length && reusable;
          corner++
        )
          if (
            sourceNodes[mesh.tetrahedra[corner]!] !==
            previous.tetrahedra[corner]
          )
            reusable = false
      }
      const prepared =
        reusable && previous
          ? {
              restTets: previous.prepared.restTets.slice(),
              jellyTets: jelly
                ? previous.prepared.jellyTets!.slice()
                : undefined,
            }
          : prepareGummySolverGeometry(mesh, jelly)
      if (reusable) {
        const restIds = new Uint32Array(prepared.restTets.buffer)
        const jellyIds =
          prepared.jellyTets && new Uint32Array(prepared.jellyTets.buffer)
        for (let corner = 0; corner < mesh.tetrahedra.length; corner++) {
          const tet = Math.floor(corner / 4)
          const lane = corner % 4
          restIds[tet * 12 + lane] = mesh.tetrahedra[corner]!
          if (jellyIds) jellyIds[tet * 16 + lane] = mesh.tetrahedra[corner]!
        }
      }
      // Public results and source meshes are mutable. Own copies make a later
      // caller's mutation harmless to future cache hits.
      previous = {
        positions: mesh.positions.slice(),
        tetrahedra: mesh.tetrahedra.slice(),
        prepared: {
          restTets: prepared.restTets.slice(),
          jellyTets: prepared.jellyTets?.slice(),
        },
      }
      return prepared
    },
  }
}

export type GummySolverPreparationCache = ReturnType<
  typeof createGummySolverPreparationCache
>
