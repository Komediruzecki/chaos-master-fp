/** Independent geometric and mechanical checks for runtime tetrahedral jelly fracture snapshots. */
import assert from 'node:assert/strict'

const FACES = [
  [0, 2, 1],
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
]
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
]
const key = (ids) => [...ids].sort((a, b) => a - b).join(':')
const point = (packed, id) => packed.slice(id * 4, id * 4 + 3)
const sub = (a, b) => a.map((v, i) => v - b[i])
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)
const distance = (a, b) => Math.hypot(...sub(a, b))
const volume = (a, b, c, d) => dot(sub(b, a), cross(sub(c, a), sub(d, a))) / 6

function disjointSets(count) {
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (id) => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]]
      id = parent[id]
    }
    return id
  }
  return {
    find,
    join(a, b) {
      parent[find(a)] = find(b)
    },
  }
}

/** Face connectivity alone misses point/edge ties. Measure both and inspect the actual exposed boundary. */
export function analyzeRuntimeJelly(state, initialTopology) {
  const topology = state.topology
  assert.ok(topology, 'Snapshot must include current topology')
  const p = Array.from(state.positions)
  const rest = Array.from(topology.restPositions)
  const tets = Array.from(topology.tetrahedra)
  const surface = Array.from(topology.surface)
  const original = Array.from(topology.originalNodeIds)
  const normals = Array.from(topology.restNormals)
  let originalMaterialMismatch = 0
  let materialCornerMismatches = 0
  if (initialTopology) {
    assert.equal(tets.length, initialTopology.tetrahedra.length)
    for (let corner = 0; corner < tets.length; corner++) {
      if (original[tets[corner]] !== initialTopology.tetrahedra[corner])
        materialCornerMismatches++
    }
    for (let id = 0; id < original.length; id++) {
      assert.ok(original[id] < initialTopology.initialVertexCount)
      for (let axis = 0; axis < 3; axis++) {
        originalMaterialMismatch = Math.max(
          originalMaterialMismatch,
          Math.abs(
            rest[id * 4 + axis] -
              initialTopology.restPositions[original[id] * 4 + axis],
          ),
          Math.abs(
            normals[id * 4 + axis] -
              initialTopology.restNormals[original[id] * 4 + axis],
          ),
        )
      }
    }
  }
  const velocities = Array.from(
    state.dynamic?.velocities ?? state.velocities ?? [],
  )
  const count = p.length / 4
  assert.equal(p.length, rest.length)
  assert.equal(normals.length, rest.length)
  assert.equal(original.length, count)
  assert.equal(tets.length % 4, 0)
  assert.equal(surface.length % 4, 0)
  assert.ok(tets.every((id) => Number.isInteger(id) && id >= 0 && id < count))
  const tetCount = tets.length / 4
  const mechanical = disjointSets(tetCount)
  const faceConnected = disjointSets(tetCount)
  const firstNode = new Map()
  const faces = new Map()
  const tetVolumes = []
  let restVolume = 0,
    signedVolume = 0,
    invertedVolume = 0,
    edgeStrain = 0
  for (let i = 0; i < tetCount; i++) {
    const ids = tets.slice(i * 4, i * 4 + 4)
    const v0 = volume(...ids.map((id) => point(rest, id)))
    const v = volume(...ids.map((id) => point(p, id)))
    assert.ok(v0 > 0, 'Every tetrahedron retains positive rest orientation')
    tetVolumes.push(v0)
    restVolume += v0
    signedVolume += v
    if (v < 0) invertedVolume -= v
    for (const id of ids) {
      if (firstNode.has(id)) mechanical.join(i, firstNode.get(id))
      else firstNode.set(id, i)
    }
    for (const corners of FACES) {
      const tri = corners.map((c) => ids[c])
      const k = key(tri)
      const prior = faces.get(k)
      if (prior) {
        faceConnected.join(i, prior.tet)
        prior.count++
      } else faces.set(k, { tet: i, tri, count: 1 })
    }
    for (const [a, b] of EDGES) {
      const strain =
        distance(point(p, ids[a]), point(p, ids[b])) /
          distance(point(rest, ids[a]), point(rest, ids[b])) -
        1
      edgeStrain += (v0 * strain * strain) / 6
    }
  }
  const components = new Map()
  for (let i = 0; i < tetCount; i++) {
    const root = mechanical.find(i)
    const c = components.get(root) ?? {
      tetCount: 0,
      restVolume: 0,
      nodes: new Set(),
      firstTet: i,
    }
    c.tetCount++
    c.restVolume += tetVolumes[i]
    for (const id of tets.slice(i * 4, i * 4 + 4)) c.nodes.add(id)
    components.set(root, c)
  }
  const measured = [...components.values()]
    .map((c) => {
      const centre = [0, 0, 0]
      const meanVelocity = [0, 0, 0]
      let freeMass = 0,
        pinned = 0
      for (const id of c.nodes) {
        for (let a = 0; a < 3; a++) centre[a] += p[id * 4 + a] / c.nodes.size
        if (p[id * 4 + 3] === 0) pinned++
        else {
          const m = 1 / p[id * 4 + 3]
          freeMass += m
          if (velocities.length)
            for (let a = 0; a < 3; a++)
              meanVelocity[a] += m * velocities[id * 4 + a]
        }
      }
      if (freeMass) for (let a = 0; a < 3; a++) meanVelocity[a] /= freeMass
      return {
        tetCount: c.tetCount,
        firstTet: c.firstTet,
        restVolume: c.restVolume,
        vertexCount: c.nodes.size,
        pinned,
        freeMass,
        centre,
        meanVelocity,
      }
    })
    .sort((a, b) => b.restVolume - a.restVolume)
  const drawnFaces = new Map()
  const caps = new Map()
  const surfaceEdges = new Map()
  let orientationErrors = 0
  for (let i = 0; i < surface.length; i += 4) {
    const tri = surface.slice(i, i + 3)
    assert.ok(tri.every((id) => Number.isInteger(id) && id >= 0 && id < count))
    const k = key(tri)
    drawnFaces.set(k, (drawnFaces.get(k) ?? 0) + 1)
    const expected = faces.get(k)
    if (expected?.count === 1) {
      const normal = (ids) =>
        cross(
          sub(point(rest, ids[1]), point(rest, ids[0])),
          sub(point(rest, ids[2]), point(rest, ids[0])),
        )
      if (dot(normal(tri), normal(expected.tri)) <= 0) orientationErrors++
    }
    if (surface[i + 3] === 0xfffffffe) {
      const source = tri.map((id) => original[id])
      const ck = key(source)
      const pair = caps.get(ck) ?? []
      pair.push(source)
      caps.set(ck, pair)
    }
    for (const [a, b] of [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ]) {
      const ek = key([a, b])
      const edge = surfaceEdges.get(ek) ?? { count: 0, winding: 0 }
      edge.count++
      edge.winding += a < b ? 1 : -1
      surfaceEdges.set(ek, edge)
    }
  }
  let missingBoundaryFaces = 0,
    extraSurfaceFaces = 0
  for (const [k, face] of faces)
    if (face.count === 1 && drawnFaces.get(k) !== 1) missingBoundaryFaces++
  for (const [k, drawn] of drawnFaces)
    if (faces.get(k)?.count !== 1 || drawn !== 1) extraSurfaceFaces++
  let invalidCapPairs = 0
  for (const pair of caps.values()) {
    if (pair.length !== 2) {
      invalidCapPairs++
      continue
    }
    const [a, b] = pair
    const index = b.indexOf(a[0])
    if (b[(index + 1) % 3] !== a[2]) invalidCapPairs++
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  let pinnedMovement = 0,
    floorPenetration = 0,
    mass = 0,
    dyeMismatch = 0,
    freeRms = 0,
    freeCount = 0
  const originalRest = new Map()
  for (let id = 0; id < count; id++) {
    const xyz = point(p, id),
      xyz0 = point(rest, id)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], xyz[a])
      max[a] = Math.max(max[a], xyz[a])
    }
    if (p[id * 4 + 3] === 0)
      pinnedMovement = Math.max(pinnedMovement, distance(xyz, xyz0))
    else {
      mass += 1 / p[id * 4 + 3]
      freeRms += distance(xyz, xyz0) ** 2
      freeCount++
    }
    floorPenetration = Math.max(floorPenetration, -xyz[1])
    const previous = originalRest.get(original[id])
    if (previous) dyeMismatch = Math.max(dyeMismatch, distance(previous, xyz0))
    else originalRest.set(original[id], xyz0)
  }
  return {
    finite: [...p, ...rest, ...normals, ...velocities].every(Number.isFinite),
    vertexCount: count,
    tetCount,
    initialVertexCount: topology.initialVertexCount,
    revision: topology.revision,
    failedFaces: topology.failedFaces.length,
    restVolume,
    freeMass: mass,
    signedVolume,
    volumeRatio: signedVolume / restVolume,
    invertedVolumeFraction: invertedVolume / restVolume,
    edgeStrainRms: Math.sqrt(edgeStrain / restVolume),
    freeDisplacementRms: Math.sqrt(freeRms / Math.max(1, freeCount)),
    pinnedMovement,
    floorPenetration,
    min,
    max,
    span: max.map((v, a) => v - min[a]),
    mechanicalComponents: measured,
    // Shared-node components include point and edge ties. Only material with
    // no mechanical path to a pin counts, independently of individual chip size.
    detachedRestVolumeFraction:
      measured
        .filter((component) => component.pinned === 0)
        .reduce((sum, component) => sum + component.restVolume, 0) /
      (initialTopology?.restVolume ?? restVolume),
    faceComponents: new Set(
      Array.from({ length: tetCount }, (_, i) => faceConnected.find(i)),
    ).size,
    missingBoundaryFaces,
    extraSurfaceFaces,
    orientationErrors,
    capPairs: caps.size,
    invalidCapPairs,
    dyeMismatch,
    originalMaterialMismatch,
    materialCornerMismatches,
    openSurfaceEdges: [...surfaceEdges.values()].filter((e) => e.count === 1)
      .length,
    nonManifoldEdges: [...surfaceEdges.values()].filter((e) => e.count > 2)
      .length,
    windingErrors: [...surfaceEdges.values()].filter((e) => e.winding !== 0)
      .length,
  }
}
