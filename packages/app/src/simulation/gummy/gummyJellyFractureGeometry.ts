/** Rest-volume, face adjacency, and mechanical connectivity for extrinsic jelly fracture. */
import { createGummyTensileWorkspace, prepareGummyFractureStrain, } from './gummyJellyFractureStrain'
import type { GummyMesh } from './gummyMeshContracts'

const FACES = [
  [1, 2, 3],
  [0, 3, 2],
  [0, 1, 3],
  [0, 2, 1],
] as const
export const GUMMY_JELLY_TEAR_OPENING = 1.4
export const GUMMY_JELLY_TEAR_RATE = 3
/** Interactive hot-gummy preset; callers can retain the original response with fragility 0. */
export const GUMMY_JELLY_DEFAULT_FRAGILITY = 0.88

/** Independent tensile strength and failure time, without changing intact elasticity. */
export function gummyJellyFractureParameters(fragility = 0) {
  if (!Number.isFinite(fragility))
    throw new Error('Runtime fracture fragility must be finite')
  const amount = Math.max(0, Math.min(1, fragility))
  const strengthLoss = 1 - (1 - amount) * (1 - amount)
  const opening = GUMMY_JELLY_TEAR_OPENING - 0.1 * amount
  const rate = GUMMY_JELLY_TEAR_RATE + 117 * amount
  return {
    // Uncracked material retains the validated gravity-settling endurance threshold.
    opening,
    // Mesh-scale crack-tip process-zone heuristic, not calibrated fracture energy
    // or a temperature law. Only edge-neighbours of existing failed facets weaken.
    propagationOpening: opening - 0.19 * strengthLoss,
    rate,
    propagationRate: rate * (1 + 4 * amount),
  }
}
/** Resolve tensile extension over a finite crack band, not arbitrarily thin clipped cells. */
export const GUMMY_JELLY_CRACK_BAND_SPACING = 0.25

export type Facet = {
  a: number[]
  b?: number[]
  tetA: number
  tetB: number
  area: number
  gap: number
}
export type JellyFractureComponent = {
  tetCount: number
  nodeCount: number
  restVolume: number
  mass: number
  pinnedNodes: number
}
export type JellyFractureDiagnostics = {
  topologyVersion: number
  originalVertexCount: number
  vertexCount: number
  tetCount: number
  candidateFaceCount: number
  brokenFaceCount: number
  exposedFaceCount: number
  addedVertices: number
  maxOpening: number
  totalMass: number
  freeMass: number
  pinnedMass: number
  restVolume: number
  components: JellyFractureComponent[]
}

export function unionFind(count: number) {
  const parent = Uint32Array.from({ length: count }, (_, id) => id)
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]!]!
      id = parent[id]!
    }
    return id
  }
  return {
    find,
    join(a: number, b: number) {
      a = find(a)
      b = find(b)
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
    },
  }
}

export function volume(
  positions: Float32Array,
  ids: Uint32Array,
  offset: number,
) {
  const a = ids[offset]! * 4
  const b = ids[offset + 1]! * 4
  const c = ids[offset + 2]! * 4
  const e = ids[offset + 3]! * 4
  const bx = positions[b]! - positions[a]!,
    by = positions[b + 1]! - positions[a + 1]!,
    bz = positions[b + 2]! - positions[a + 2]!
  const cx = positions[c]! - positions[a]!,
    cy = positions[c + 1]! - positions[a + 1]!,
    cz = positions[c + 2]! - positions[a + 2]!
  const ex = positions[e]! - positions[a]!,
    ey = positions[e + 1]! - positions[a + 1]!,
    ez = positions[e + 2]! - positions[a + 2]!
  return (
    (bx * (cy * ez - cz * ey) +
      by * (cz * ex - cx * ez) +
      bz * (cx * ey - cy * ex)) /
    6
  )
}

export function centers(positions: Float32Array, ids: Uint32Array) {
  const result = new Float64Array((ids.length / 4) * 3)
  for (let tet = 0; tet < ids.length / 4; tet++)
    for (let corner = 0; corner < 4; corner++)
      for (let axis = 0; axis < 3; axis++)
        result[tet * 3 + axis]! +=
          positions[ids[tet * 4 + corner]! * 4 + axis]! * 0.25
  return result
}

export function areaNormal(
  positions: Float32Array,
  ids: Uint32Array,
  corners: number[],
  result: [number, number, number] = [0, 0, 0],
) {
  const a = ids[corners[0]!]! * 4,
    b = ids[corners[1]!]! * 4,
    c = ids[corners[2]!]! * 4
  const ux = positions[b]! - positions[a]!,
    uy = positions[b + 1]! - positions[a + 1]!,
    uz = positions[b + 2]! - positions[a + 2]!
  const vx = positions[c]! - positions[a]!,
    vy = positions[c + 1]! - positions[a + 1]!,
    vz = positions[c + 2]! - positions[a + 2]!
  result[0] = uy * vz - uz * vy
  result[1] = uz * vx - ux * vz
  result[2] = ux * vy - uy * vx
  return result
}

/** A process zone reaches only facets incident to the same original material edge. */
export function edgeNeighbourFacets(faces: Facet[], tets: Uint32Array) {
  const edges = new Map<string, number[]>()
  for (let id = 0; id < faces.length; id++) {
    const corners = faces[id]!.a
    for (let corner = 0; corner < 3; corner++) {
      const a = tets[corners[corner]!]!,
        b = tets[corners[(corner + 1) % 3]!]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const ids = edges.get(key)
      if (ids) ids.push(id)
      else edges.set(key, [id])
    }
  }
  const neighbours = Array.from(
    { length: faces.length },
    () => new Set<number>(),
  )
  for (const ids of edges.values())
    for (const id of ids)
      for (const other of ids) if (other !== id) neighbours[id]!.add(other)
  return neighbours.map((ids) => Uint32Array.from(ids))
}

/** Exact mechanical components: even one shared live vertex connects two tetrahedra. */
export function mechanicalComponents(
  mesh: GummyMesh,
  masses: Float64Array,
  volumes: Float64Array,
) {
  const groups = unionFind(volumes.length)
  const first = new Int32Array(masses.length).fill(-1)
  for (let tet = 0; tet < volumes.length; tet++)
    for (let corner = 0; corner < 4; corner++) {
      const node = mesh.tetrahedra[tet * 4 + corner]!
      if (first[node] === -1) first[node] = tet
      else groups.join(tet, first[node]!)
    }
  const map = new Map<
    number,
    { nodes: Set<number>; tets: number; volume: number }
  >()
  for (let tet = 0; tet < volumes.length; tet++) {
    const key = groups.find(tet)
    const part = map.get(key) ?? {
      nodes: new Set<number>(),
      tets: 0,
      volume: 0,
    }
    part.tets++
    part.volume += volumes[tet]!
    for (let corner = 0; corner < 4; corner++)
      part.nodes.add(mesh.tetrahedra[tet * 4 + corner]!)
    map.set(key, part)
  }
  const nodeRegions = new Uint32Array(masses.length)
  const components: JellyFractureComponent[] = []
  for (const part of map.values()) {
    let mass = 0,
      pinnedNodes = 0
    for (const node of part.nodes) {
      nodeRegions[node] = components.length
      mass += masses[node]!
      if (mesh.positions[node * 4 + 3] === 0) pinnedNodes++
    }
    components.push({
      tetCount: part.tets,
      nodeCount: part.nodes.size,
      restVolume: part.volume,
      mass,
      pinnedNodes,
    })
  }
  components.sort((a, b) => b.tetCount - a.tetCount)
  return { components, nodeRegions }
}

function validateFractureMesh(initialMesh: GummyMesh) {
  const originalCount = initialMesh.positions.length / 4
  const tetCount = initialMesh.tetrahedra.length / 4
  if (
    !Number.isInteger(originalCount) ||
    !originalCount ||
    !Number.isInteger(tetCount) ||
    !tetCount ||
    initialMesh.interfaces.length
  )
    throw new Error('Runtime jelly fracture requires a welded tetrahedral mesh')
  if (
    initialMesh.restNormals.length !== initialMesh.positions.length ||
    !Number.isFinite(initialMesh.spacing) ||
    initialMesh.spacing <= 0 ||
    (initialMesh.massReferenceVolume !== undefined &&
      (!Number.isFinite(initialMesh.massReferenceVolume) ||
        initialMesh.massReferenceVolume <= 0)) ||
    initialMesh.restNormals.some((value) => !Number.isFinite(value)) ||
    [...initialMesh.positions].some((value) => !Number.isFinite(value))
  )
    throw new Error('Invalid runtime jelly rest data')
  return { originalCount, tetCount }
}

export function prepareJellyFractureGeometry(initialMesh: GummyMesh) {
  const { originalCount, tetCount } = validateFractureMesh(initialMesh)
  const originalTets = new Uint32Array(initialMesh.tetrahedra)
  if (originalTets.some((node) => node >= originalCount))
    throw new Error('Runtime jelly tet node index out of range')
  const restCenters = centers(initialMesh.positions, originalTets)
  const strainGeometry = prepareGummyFractureStrain(
    initialMesh,
    GUMMY_JELLY_CRACK_BAND_SPACING,
  )
  const strainWorkspace = createGummyTensileWorkspace(tetCount)
  const normalScratch: [number, number, number] = [0, 0, 0]
  const averageScratch = new Float64Array(6)
  const ratios = new Float64Array(tetCount)
  const restVolumes = new Float64Array(tetCount)
  const incidentVolumes = new Float64Array(originalCount)
  const faces = new Map<string, Facet>()
  const interior: Facet[] = []
  const paired = new Set<string>()
  for (let tet = 0; tet < tetCount; tet++) {
    const v = volume(initialMesh.positions, originalTets, tet * 4)
    if (!(v > 1e-15))
      throw new Error('Runtime jelly tets require positive rest volume')
    restVolumes[tet] = v
    for (let corner = 0; corner < 4; corner++)
      incidentVolumes[originalTets[tet * 4 + corner]!]! += v * 0.25
    for (const local of FACES) {
      const corners = local.map((corner) => tet * 4 + corner)
      const key = corners
        .map((corner) => originalTets[corner]!)
        .sort((a, b) => a - b)
        .join(':')
      if (paired.has(key))
        throw new Error(
          'Runtime jelly mesh has a non-manifold tetrahedral face',
        )
      const other = faces.get(key)
      if (!other) {
        faces.set(key, { a: corners, tetA: tet, tetB: -1, area: 0, gap: 0 })
        continue
      }
      faces.delete(key)
      paired.add(key)
      other.b = corners
      other.tetB = tet
      const normal = areaNormal(initialMesh.positions, originalTets, other.a)
      const length = Math.hypot(...normal)
      other.area = length * 0.5
      other.gap =
        normal.reduce(
          (sum, n, axis) =>
            sum +
            n *
              (restCenters[tet * 3 + axis]! -
                restCenters[other.tetA * 3 + axis]!),
          0,
        ) / length
      if (!(other.gap > 1e-12) || !(length > 1e-12))
        throw new Error('Invalid oriented runtime jelly face')
      interior.push(other)
    }
  }
  const exterior = [...faces.values()]
  const neighbours = edgeNeighbourFacets(interior, originalTets)
  const actualRestVolume = restVolumes.reduce((sum, value) => sum + value, 0)
  const averageMass = actualRestVolume / originalCount
  const initialMasses = Float64Array.from(incidentVolumes, (mass, id) => {
    const inverse = initialMesh.positions[id * 4 + 3]!
    if (inverse < 0 || !mass)
      throw new Error(
        'Runtime jelly requires used nodes with nonnegative inverse mass',
      )
    if (inverse > 0) return 1 / inverse
    // Pins have zero inverse mass, but their diagnostic mass must use the same
    // density and local sliver floor as free nodes in a refined continuous mesh.
    return initialMesh.massReferenceVolume === undefined
      ? Math.max(mass / averageMass, 0.1)
      : Math.max(mass, averageMass * 0.1) / initialMesh.massReferenceVolume
  })
  return {
    originalCount,
    tetCount,
    originalTets,
    strainGeometry,
    strainWorkspace,
    normalScratch,
    averageScratch,
    ratios,
    restVolumes,
    interior,
    exterior,
    neighbours,
    actualRestVolume,
    initialMasses,
  }
}
