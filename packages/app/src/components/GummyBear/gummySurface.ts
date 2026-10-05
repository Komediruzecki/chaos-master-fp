/** Rest-welded exterior adjacency and exact-node exposed tear-surface adjacency. */
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'
import { prepareGummyPatchSamples } from './gummyPatchSamples'
import { gummyRoundingWeight } from './gummyRoundedSurface'
import { prepareRuntimeGummyMetadata } from './gummyRuntimeSurface'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'

/** Legacy rest welding rejects separated copies; runtime cracks use exact shared-node identity. */
export function prepareGummySurface(
  mesh: Pick<
    GummyMesh,
    'positions' | 'surface' | 'restNormals' | 'interfaces' | 'runtimeFracture'
  > &
    Partial<Pick<GummyMesh, 'tetrahedra'>>,
) {
  const count = mesh.positions.length / 4
  if (
    !count ||
    !Number.isInteger(count) ||
    !mesh.surface.length ||
    mesh.surface.length % 4 ||
    mesh.interfaces.length % 8 ||
    mesh.restNormals.length !== mesh.positions.length
  )
    throw new Error('Invalid gummy surface buffer lengths')
  const keys: string[] = []
  const coincident = new Map<string, { face: number; node: number }[]>()
  const local: { face: number; node: number }[][] = Array.from(
    { length: count },
    () => [],
  )
  const cutEdges = new Map<string, Set<number>>()
  const edgeKey = (a: number, b: number) =>
    [keys[a]!, keys[b]!].sort().join('|')
  for (let id = 0; id < count; id++) {
    const o = id * 4
    if (
      ![mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]].every(
        Number.isFinite,
      )
    )
      throw new Error('Invalid gummy surface position')
    // The tetra mesh duplicates exactly coincident rest vertices at tear seams.
    const key = mesh.runtimeFracture
      ? `node:${id}`
      : `${mesh.positions[o]}:${mesh.positions[o + 1]}:${mesh.positions[o + 2]}`
    keys.push(key)
    if (!coincident.has(key)) coincident.set(key, [])
  }
  for (let face = 0; face < mesh.surface.length / 4; face++) {
    const o = face * 4
    const interfaceId = mesh.surface[o + 3]!
    for (let corner = 0; corner < 3; corner++)
      if (mesh.surface[o + corner]! >= count)
        throw new Error('Gummy surface node index out of range')
    for (let corner = 0; corner < 3; corner++) {
      const node = mesh.surface[o + corner]!
      local[node]!.push({ face, node })
    }
    if (interfaceId !== EXTERIOR_FACE) {
      if (
        interfaceId !== EXPOSED_TEAR_FACE &&
        interfaceId >= mesh.interfaces.length / 8
      )
        throw new Error('Gummy surface interface index out of range')
      const a = mesh.surface[o]!,
        b = mesh.surface[o + 1]!,
        c = mesh.surface[o + 2]!
      for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
        const interfaces = cutEdges.get(key) ?? new Set<number>()
        interfaces.add(interfaceId)
        cutEdges.set(key, interfaces)
      }
      continue
    }
    for (let corner = 0; corner < 3; corner++) {
      const node = mesh.surface[o + corner]!
      coincident.get(keys[node]!)!.push({ face, node })
    }
  }
  // First N ranges retain legacy rest welding or runtime shared-node identity.
  // Second N use exact node IDs for exposed boundaries, never welding tear copies.
  const runtime = mesh.runtimeFracture
    ? prepareRuntimeGummyMetadata(
        mesh.positions,
        mesh.tetrahedra ?? new Uint32Array(),
        mesh.surface,
      )
    : undefined
  const ranges = new Uint32Array(count * (runtime ? 8 : 4))
  const pairs: number[] = []
  for (let id = 0; id < count; id++) {
    const adjacent = coincident.get(keys[id]!)!
    ranges[id * 2] = pairs.length / 2
    ranges[id * 2 + 1] = adjacent.length
    for (const pair of adjacent) pairs.push(pair.face, pair.node)
  }
  if (runtime)
    for (let id = 0; id < count; id++) {
      const neighbors = runtime.rounding[id]!
      ranges[(count * 3 + id) * 2] = pairs.length / 2
      ranges[(count * 3 + id) * 2 + 1] = neighbors.length
      const weight = Math.round(
        gummyRoundingWeight(neighbors.length) * 16777216,
      )
      for (const neighbor of neighbors) pairs.push(neighbor, weight)
    }
  if (runtime)
    for (let id = 0; id < count; id++) {
      const tets = runtime.incident[id]!
      ranges[(count * 2 + id) * 2] = pairs.length / 2
      ranges[(count * 2 + id) * 2 + 1] = tets.length
      for (const tet of tets) pairs.push(...tet)
    }
  for (let id = 0; id < count; id++) {
    const adjacent = local[id]!
    ranges[(count + id) * 2] = pairs.length / 2
    ranges[(count + id) * 2 + 1] = adjacent.length
    for (const pair of adjacent) pairs.push(pair.face, pair.node)
  }
  // Storage bindings must be non-empty even for an entirely interior node set.
  const adjacent = new Uint32Array(pairs.length ? pairs : [0, 0])
  return {
    ranges,
    adjacent,
    metadata: runtime?.metadata ?? new Uint32Array(mesh.surface.length),
    ...preparePatches(mesh.surface, cutEdges, edgeKey, runtime?.metadata),
  }
}

function preparePatches(
  surface: Uint32Array,
  cutEdges: Map<string, Set<number>>,
  edgeKey: (a: number, b: number) => string,
  metadata?: Uint32Array,
) {
  // The face prefix stores three list heads (AB, BC, CA). Tail vec4u records
  // store [interface ID + 1, next head, 0, 0], or EXTERIOR_FACE for permanent
  // runtime caps; head 0 means no tear boundary.
  // Multiple region interfaces may meet on one rest edge, so a single ID
  // cannot represent every cap that could become visible there.
  const edgeRecords = new Array<number>(surface.length).fill(0)
  const heads = new Map<string, number>()
  const headFor = (key: string) => {
    const existing = heads.get(key)
    if (existing !== undefined) return existing
    const interfaces = cutEdges.get(key)
    if (!interfaces) return 0
    const ids = [...interfaces].sort((a, b) => a - b)
    const head = edgeRecords.length / 4
    for (let i = 0; i < ids.length; i++) {
      const next = i + 1 < ids.length ? edgeRecords.length / 4 + 1 : 0
      // A permanent cap uses the reserved maximum word explicitly; never increment an exterior marker.
      const marker = ids[i] === EXPOSED_TEAR_FACE ? EXTERIOR_FACE : ids[i]! + 1
      edgeRecords.push(marker, next, 0, 0)
    }
    heads.set(key, head)
    return head
  }
  for (let face = 0; face < surface.length / 4; face++) {
    if (surface[face * 4 + 3] !== EXTERIOR_FACE && !metadata) continue
    const a = surface[face * 4]!,
      b = surface[face * 4 + 1]!,
      c = surface[face * 4 + 2]!
    // The shader keeps joined seams curved and flattens only broken cap edges.
    edgeRecords[face * 4] = headFor(edgeKey(a, b))
    edgeRecords[face * 4 + 1] = headFor(edgeKey(b, c))
    edgeRecords[face * 4 + 2] = headFor(edgeKey(c, a))
  }
  return {
    ...prepareGummyPatchSamples(surface, metadata),
    flatEdges: new Uint32Array(edgeRecords),
  }
}
