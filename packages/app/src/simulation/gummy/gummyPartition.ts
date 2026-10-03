/** Deterministic, manifold whole-cell fracture regions and damage-based volume connectivity. */
import type { GummyMesh, GummyVec3 } from './gummyMesh'

type Tet = readonly [number, number, number, number]
type Face = readonly [number, number, number]
const TET_FACES = [
  [1, 2, 3],
  [0, 3, 2],
  [0, 1, 3],
  [0, 2, 1],
] as const
const faceKey = (face: Face) => [...face].sort((a, b) => a - b).join(':')

function disjointSets(count: number) {
  const parents = Array.from({ length: count }, (_, i) => i)
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!
      index = parents[index]!
    }
    return index
  }
  const join = (a: number, b: number) => {
    a = find(a)
    b = find(b)
    if (a !== b) parents[Math.max(a, b)] = Math.min(a, b)
  }
  return { find, join }
}

/** Closed triangle boundaries require a single circular link at every vertex, not just two faces per edge. */
export function isManifoldGummyBoundary(faces: Iterable<Face>) {
  const edges = new Map<string, number>()
  const links = new Map<number, Map<number, Set<number>>>()
  for (const face of faces) {
    for (let i = 0; i < 3; i++) {
      const vertex = face[i]!,
        a = face[(i + 1) % 3]!,
        b = face[(i + 2) % 3]!
      if (vertex === a || a === b || b === vertex) return false
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
      const link = links.get(vertex) ?? new Map<number, Set<number>>()
      const from = link.get(a) ?? new Set<number>()
      const to = link.get(b) ?? new Set<number>()
      from.add(b)
      to.add(a)
      link.set(a, from)
      link.set(b, to)
      links.set(vertex, link)
    }
  }
  if (!edges.size || [...edges.values()].some((count) => count !== 2))
    return false
  for (const link of links.values()) {
    if ([...link.values()].some((neighbors) => neighbors.size !== 2))
      return false
    const seen = new Set<number>()
    const pending = [link.keys().next().value!]
    while (pending.length) {
      const vertex = pending.pop()!
      if (seen.has(vertex)) continue
      seen.add(vertex)
      pending.push(...link.get(vertex)!)
    }
    if (seen.size !== link.size) return false
  }
  return true
}

/** Cells follow a distributed, warped Voronoi assignment; a merge is accepted only if the closed boundary remains manifold. */
export function partitionGummyCells(
  tetrahedra: readonly Tet[],
  cellIds: readonly number[],
  centers: ReadonlyMap<number, GummyVec3>,
  tetrahedronVolumes: readonly number[],
  desiredCount = 96,
): Uint32Array {
  if (
    tetrahedra.length !== cellIds.length ||
    tetrahedra.length !== tetrahedronVolumes.length ||
    tetrahedronVolumes.some(
      (volume) => !Number.isFinite(volume) || volume <= 0,
    ) ||
    !Number.isInteger(desiredCount) ||
    desiredCount < 1
  )
    throw new RangeError('Invalid gummy partition input')
  const faces: Face[] = []
  const faceIds = new Map<string, number>()
  const owners: number[][] = []
  const tetFaces: number[][] = []
  const neighbors = tetrahedra.map(() => [] as number[])
  for (let tet = 0; tet < tetrahedra.length; tet++) {
    const ids: number[] = []
    for (const corners of TET_FACES) {
      const source = tetrahedra[tet]!
      const face: Face = [
        source[corners[0]],
        source[corners[1]],
        source[corners[2]],
      ]
      const key = faceKey(face)
      let id = faceIds.get(key)
      if (id === undefined) {
        id = faces.length
        faceIds.set(key, id)
        faces.push(face)
        owners.push([])
      }
      owners[id]!.push(tet)
      if (owners[id]!.length > 2)
        throw new Error('Non-manifold source tetrahedra')
      ids.push(id)
    }
    tetFaces.push(ids)
  }
  for (const faceOwners of owners)
    if (faceOwners.length === 2) {
      neighbors[faceOwners[0]!]!.push(faceOwners[1]!)
      neighbors[faceOwners[1]!]!.push(faceOwners[0]!)
    }

  // A clipped cell can have more than one face-connected part. Never tie those parts through a point alone.
  const membership = new Int32Array(tetrahedra.length).fill(-1)
  const groups: { center: GummyVec3; boundary: Set<number>; volume: number }[] =
    []
  for (let tet = 0; tet < tetrahedra.length; tet++) {
    if (membership[tet] !== -1) continue
    const center = centers.get(cellIds[tet]!)
    if (!center) throw new Error('Missing gummy cell center')
    const group = groups.length
    const boundary = new Set<number>()
    let volume = 0
    const pending = [tet]
    while (pending.length) {
      const current = pending.pop()!
      if (membership[current] !== -1) continue
      membership[current] = group
      volume += tetrahedronVolumes[current]!
      for (const face of tetFaces[current]!) {
        if (boundary.has(face)) boundary.delete(face)
        else boundary.add(face)
      }
      for (const adjacent of neighbors[current]!)
        if (membership[adjacent] === -1 && cellIds[adjacent] === cellIds[tet])
          pending.push(adjacent)
    }
    if (!isManifoldGummyBoundary([...boundary].map((id) => faces[id]!)))
      throw new Error('A clipped gummy cell has a non-manifold boundary')
    groups.push({ center, boundary, volume })
  }
  if (!groups.length) return new Uint32Array()

  const warped = groups.map(({ center: [x, y, z] }) => [
    x + 0.055 * Math.sin(4.3 * y + 2.1 * z),
    y + 0.045 * Math.sin(5.2 * x - 3.3 * z),
    z + 0.04 * Math.sin(4.1 * y + 3.7 * x),
  ])
  const distance = (a: number[], b: number[]) =>
    a.reduce((sum, value, axis) => sum + (value - b[axis]!) ** 2, 0)
  const seeds = [0]
  const nearest = warped.map((point) => distance(point, warped[0]!))
  while (seeds.length < Math.min(desiredCount, groups.length)) {
    let next = 0
    for (let i = 1; i < nearest.length; i++)
      if (nearest[i]! > nearest[next]!) next = i
    if (nearest[next]! <= 1e-15) break
    seeds.push(next)
    for (let i = 0; i < warped.length; i++)
      nearest[i] = Math.min(nearest[i]!, distance(warped[i]!, warped[next]!))
  }
  const labels = warped.map((point) => {
    let label = 0,
      best = Infinity
    for (let i = 0; i < seeds.length; i++) {
      const candidate = distance(point, warped[seeds[i]!]!)
      if (candidate < best) {
        best = candidate
        label = i
      }
    }
    return label
  })
  const pairs = new Map<string, [number, number]>()
  for (let tet = 0; tet < tetrahedra.length; tet++)
    for (const adjacent of neighbors[tet]!) {
      const a = membership[tet]!,
        b = membership[adjacent]!
      if (a !== b)
        pairs.set(a < b ? `${a}:${b}` : `${b}:${a}`, [
          Math.min(a, b),
          Math.max(a, b),
        ])
    }
  const adjacentPairs = [...pairs.values()]
  const joins = adjacentPairs
    .filter(([a, b]) => labels[a] === labels[b])
    .sort(
      (a, b) =>
        nearest[a[0]]! + nearest[a[1]]! - nearest[b[0]]! - nearest[b[1]]! ||
        a[0] - b[0] ||
        a[1] - b[1],
    )
  const sets = disjointSets(groups.length)
  const merge = (left: number, right: number) => {
    const a = sets.find(left),
      b = sets.find(right)
    if (a === b) return false
    const boundary = new Set(groups[a]!.boundary)
    for (const face of groups[b]!.boundary) {
      if (boundary.has(face)) boundary.delete(face)
      else boundary.add(face)
    }
    if (!isManifoldGummyBoundary([...boundary].map((id) => faces[id]!)))
      return false
    const volume = groups[a]!.volume + groups[b]!.volume
    sets.join(a, b)
    const merged = groups[sets.find(a)]!
    merged.boundary = boundary
    merged.volume = volume
    return true
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [left, right] of joins) {
      if (merge(left, right)) changed = true
    }
  }
  // Do not turn a tiny clipped exterior cell into an independent grain. Prefer the
  // neighboring region sharing the most faces, subject to the same manifold test.
  const minimumVolume =
    (tetrahedronVolumes.reduce((sum, volume) => sum + volume, 0) /
      desiredCount) *
    0.05
  const orderedGroups = groups
    .map((_, i) => i)
    .sort((a, b) => groups[a]!.volume - groups[b]!.volume || a - b)
  for (const group of orderedGroups) {
    const current = sets.find(group)
    if (groups[current]!.volume >= minimumVolume) continue
    const candidates = new Map<number, number>()
    for (const [left, right] of adjacentPairs) {
      const a = sets.find(left),
        b = sets.find(right)
      const neighbor =
        a === current && b !== current
          ? b
          : b === current && a !== current
            ? a
            : undefined
      if (neighbor !== undefined)
        candidates.set(neighbor, (candidates.get(neighbor) ?? 0) + 1)
    }
    for (const [neighbor] of [...candidates].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    ))
      if (merge(current, neighbor)) break
  }
  const dense = new Map<number, number>()
  return new Uint32Array(
    [...membership].map((group) => {
      const parent = sets.find(group)
      if (!dense.has(parent)) dense.set(parent, dense.size)
      return dense.get(parent)!
    }),
  )
}

export type GummyFragmentAnalysis = {
  regionCount: number
  connectedParts: number
  largestComponentVolumeFraction: number
  components: {
    restVolume: number
    volumeFraction: number
    tetrahedronCount: number
    regions: number[]
  }[]
}

/** Actual tetra-face connectivity, joined through every not-yet-broken cohesive interface. Partial damage is still connected. */
export function analyzeGummyFragments(
  mesh: GummyMesh,
  damage?: ArrayLike<number>,
): GummyFragmentAnalysis {
  const interfaceCount = mesh.interfaces.length / 8
  if (damage && damage.length !== interfaceCount)
    throw new RangeError('Gummy damage count does not match interfaces')
  const count = mesh.tetrahedra.length / 4
  const sets = disjointSets(count)
  const faces = new Map<string, number>()
  const volumes: number[] = []
  for (let tet = 0; tet < count; tet++) {
    const ids = [...mesh.tetrahedra.subarray(tet * 4, tet * 4 + 4)]
    for (const corners of TET_FACES) {
      const face: Face = [ids[corners[0]]!, ids[corners[1]]!, ids[corners[2]]!]
      const key = faceKey(face),
        previous = faces.get(key)
      if (previous !== undefined) sets.join(tet, previous)
      else faces.set(key, tet)
    }
    const a = ids[0]! * 4,
      b = ids[1]! * 4,
      c = ids[2]! * 4,
      e = ids[3]! * 4
    const p = mesh.positions
    const x = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!]
    const y = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!]
    const z = [p[e]! - p[a]!, p[e + 1]! - p[a + 1]!, p[e + 2]! - p[a + 2]!]
    volumes.push(
      (x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) +
        x[1]! * (y[2]! * z[0]! - y[0]! * z[2]!) +
        x[2]! * (y[0]! * z[1]! - y[1]! * z[0]!)) /
        6,
    )
  }
  for (let id = 0; id < interfaceCount; id++) {
    const value = damage?.[id] ?? 0
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Invalid gummy interface damage')
    if (value >= 1) continue
    const offset = id * 8
    const a = faceKey([
      mesh.interfaces[offset]!,
      mesh.interfaces[offset + 2]!,
      mesh.interfaces[offset + 4]!,
    ])
    const b = faceKey([
      mesh.interfaces[offset + 1]!,
      mesh.interfaces[offset + 3]!,
      mesh.interfaces[offset + 5]!,
    ])
    const left = faces.get(a),
      right = faces.get(b)
    if (left === undefined || right === undefined)
      throw new Error('Missing gummy cohesive face')
    sets.join(left, right)
  }
  const components = new Map<
    number,
    { restVolume: number; tetrahedronCount: number; regions: Set<number> }
  >()
  for (let tet = 0; tet < count; tet++) {
    const parent = sets.find(tet)
    const component = components.get(parent) ?? {
      restVolume: 0,
      tetrahedronCount: 0,
      regions: new Set<number>(),
    }
    component.restVolume += volumes[tet]!
    component.tetrahedronCount++
    component.regions.add(mesh.nodeRegions[mesh.tetrahedra[tet * 4]!]!)
    components.set(parent, component)
  }
  const ordered = [...components.values()].sort(
    (a, b) => b.restVolume - a.restVolume,
  )
  const total = ordered.reduce(
    (sum, component) => sum + component.restVolume,
    0,
  )
  return {
    regionCount: new Set(mesh.nodeRegions).size,
    connectedParts: ordered.length,
    largestComponentVolumeFraction: total ? ordered[0]!.restVolume / total : 0,
    components: ordered.map((component) => ({
      restVolume: component.restVolume,
      volumeFraction: total ? component.restVolume / total : 0,
      tetrahedronCount: component.tetrahedronCount,
      regions: [...component.regions].sort((a, b) => a - b),
    })),
  }
}
