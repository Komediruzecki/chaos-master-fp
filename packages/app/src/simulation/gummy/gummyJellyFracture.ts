/** Extrinsic tetrahedral fracture: intact shared DOFs split only after local tensile opening history fails. */
import { createGummyTensileWorkspace, evaluateGummyTensileStrain, gummyMixedTensileOpening, gummyNormalTensileOpening, prepareGummyFractureStrain, } from './gummyJellyFractureStrain'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from './gummyMesh'
import type { GummyMesh } from './gummyMesh'

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
const MAX_FACES_PER_EVENT = 64
/** Resolve tensile extension over a finite crack band, not arbitrarily thin clipped cells. */
export const GUMMY_JELLY_CRACK_BAND_SPACING = 0.25
const CHECKPOINT = Symbol('Jelly fracture checkpoint')
export type JellyFractureCheckpoint = Readonly<{ [CHECKPOINT]: true }>

type Facet = {
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

function unionFind(count: number) {
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

function volume(positions: Float32Array, ids: Uint32Array, offset: number) {
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

function centers(positions: Float32Array, ids: Uint32Array) {
  const result = new Float64Array((ids.length / 4) * 3)
  for (let tet = 0; tet < ids.length / 4; tet++)
    for (let corner = 0; corner < 4; corner++)
      for (let axis = 0; axis < 3; axis++)
        result[tet * 3 + axis]! +=
          positions[ids[tet * 4 + corner]! * 4 + axis]! * 0.25
  return result
}

function areaNormal(
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
function edgeNeighbourFacets(faces: Facet[], tets: Uint32Array) {
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
function mechanicalComponents(
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

/** Facets are possible mesh-aligned cracks, never pre-separated limbs or compliant intact seams. */
export function createGummyJellyFracture(initialMesh: GummyMesh) {
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
  const failed = new Uint8Array(interior.length)
  const history = new Float64Array(interior.length)
  const peakElasticOpening = new Float64Array(interior.length).fill(1)
  let mesh = initialMesh
  let originalNodeIds = Uint32Array.from(
    { length: originalCount },
    (_, id) => id,
  )
  let nodeMasses = new Float64Array(initialMasses)
  let topologyVersion = 0
  let maxOpening = 1
  let diagnostics: JellyFractureDiagnostics

  function makeDiagnostics(exposedFaceCount: number) {
    let freeMass = 0,
      pinnedMass = 0
    for (let id = 0; id < nodeMasses.length; id++) {
      if (mesh.positions[id * 4 + 3]! > 0) freeMass += nodeMasses[id]!
      else pinnedMass += nodeMasses[id]!
    }
    const components = mechanicalComponents(mesh, nodeMasses, restVolumes)
    return {
      topologyVersion,
      originalVertexCount: originalCount,
      vertexCount: nodeMasses.length,
      tetCount,
      candidateFaceCount: interior.length,
      brokenFaceCount: failed.reduce((sum, value) => sum + value, 0),
      exposedFaceCount,
      addedVertices: nodeMasses.length - originalCount,
      maxOpening,
      totalMass: freeMass + pinnedMass,
      freeMass,
      pinnedMass,
      restVolume: actualRestVolume,
      components: components.components,
    }
  }
  diagnostics = makeDiagnostics(0)

  const saveState = () => ({
    mesh,
    originalNodeIds,
    nodeMasses,
    topologyVersion,
    maxOpening,
    diagnostics,
    failed: failed.slice(),
    history: history.slice(),
    peakElasticOpening: peakElasticOpening.slice(),
  })
  const checkpoints = new WeakMap<
    JellyFractureCheckpoint,
    ReturnType<typeof saveState>
  >()

  function checkpoint(): JellyFractureCheckpoint {
    const token = Object.freeze({ [CHECKPOINT]: true as const })
    checkpoints.set(token, saveState())
    return token
  }

  function restore(token: JellyFractureCheckpoint) {
    const saved = checkpoints.get(token)
    if (!saved)
      throw new Error('Fracture checkpoint belongs to a different controller')
    mesh = saved.mesh
    originalNodeIds = saved.originalNodeIds
    nodeMasses = saved.nodeMasses
    topologyVersion = saved.topologyVersion
    maxOpening = saved.maxOpening
    diagnostics = saved.diagnostics
    failed.set(saved.failed)
    history.set(saved.history)
    peakElasticOpening.set(saved.peakElasticOpening)
  }

  function split() {
    // Each original vertex's incident-tet star is connected through its surviving faces.
    const stars = unionFind(originalTets.length)
    for (let faceId = 0; faceId < interior.length; faceId++) {
      if (failed[faceId]) continue
      const face = interior[faceId]!
      for (const a of face.a) {
        const b = face.b!.find(
          (corner) => originalTets[corner] === originalTets[a],
        )!
        stars.join(a, b)
      }
    }
    const groups = new Map<
      number,
      Map<number, { corners: number[]; weight: number }>
    >()
    for (let corner = 0; corner < originalTets.length; corner++) {
      const node = mesh.tetrahedra[corner]!
      const root = stars.find(corner)
      const components =
        groups.get(node) ??
        new Map<number, { corners: number[]; weight: number }>()
      const group = components.get(root) ?? { corners: [], weight: 0 }
      group.corners.push(corner)
      group.weight += restVolumes[Math.floor(corner / 4)]! * 0.25
      components.set(root, group)
      groups.set(node, components)
    }
    const sources = Array.from({ length: nodeMasses.length }, (_, id) => id)
    const masses = [...nodeMasses]
    const ids = [...originalNodeIds]
    const tetrahedra = new Uint32Array(mesh.tetrahedra)
    for (const [parent, components] of groups) {
      if (components.size <= 1) continue
      const weight = [...components.values()].reduce(
        (sum, group) => sum + group.weight,
        0,
      )
      let usedMass = 0,
        index = 0
      for (const group of components.values()) {
        const id = index === 0 ? parent : sources.length
        if (index > 0) {
          sources.push(parent)
          ids.push(originalNodeIds[parent]!)
        }
        const mass =
          index === components.size - 1
            ? nodeMasses[parent]! - usedMass
            : (nodeMasses[parent]! * group.weight) / weight
        if (!(mass > 0))
          throw new Error(
            'Runtime fracture produced nonpositive partition mass',
          )
        masses[id] = mass
        usedMass += mass
        for (const corner of group.corners) tetrahedra[corner] = id
        index++
      }
    }
    if (sources.length === nodeMasses.length) {
      // A failed facet can still lie inside connected vertex stars. Keep its history,
      // but no DOF or boundary changed, so no GPU topology transaction is necessary.
      diagnostics = makeDiagnostics(diagnostics.exposedFaceCount)
      return undefined
    }
    const positions = new Float32Array(sources.length * 4)
    const restNormals = new Float32Array(sources.length * 4)
    for (let id = 0; id < sources.length; id++) {
      const source = sources[id]! * 4
      positions.set(mesh.positions.subarray(source, source + 4), id * 4)
      restNormals.set(mesh.restNormals.subarray(source, source + 4), id * 4)
      positions[id * 4 + 3] =
        mesh.positions[source + 3] === 0 ? 0 : 1 / masses[id]!
    }
    const surface: number[] = []
    for (const face of exterior)
      surface.push(
        ...face.a.map((corner) => tetrahedra[corner]!),
        EXTERIOR_FACE,
      )
    let exposedFaceCount = 0
    for (let faceId = 0; faceId < interior.length; faceId++) {
      if (!failed[faceId]) continue
      const face = interior[faceId]!
      const a = face.a.map((corner) => tetrahedra[corner]!)
      const b = face.b!.map((corner) => tetrahedra[corner]!)
      if (a.every((node) => b.includes(node))) continue
      surface.push(...a, EXPOSED_TEAR_FACE, ...b, EXPOSED_TEAR_FACE)
      exposedFaceCount++
    }
    nodeMasses = Float64Array.from(masses)
    originalNodeIds = Uint32Array.from(ids)
    mesh = {
      ...initialMesh,
      positions,
      restNormals,
      tetrahedra,
      surface: Uint32Array.from(surface),
      interfaces: new Uint32Array(0),
      runtimeFracture: true,
      nodeRegions: new Uint32Array(sources.length),
    }
    mesh.nodeRegions = mechanicalComponents(
      mesh,
      nodeMasses,
      restVolumes,
    ).nodeRegions
    topologyVersion++
    diagnostics = makeDiagnostics(exposedFaceCount)
    return {
      mesh,
      sourceNodes: Uint32Array.from(sources),
      originalNodeIds,
      nodeMasses,
      failedFaceIds: failedFaceIds(),
      diagnostics,
    }
  }

  function failedFaceIds() {
    const ids: number[] = []
    for (let id = 0; id < failed.length; id++) if (failed[id]) ids.push(id)
    return Uint32Array.from(ids)
  }

  function assess(
    positions: Float32Array,
    elapsedSeconds: number,
    options: {
      tearing: boolean
      softness: number
      fragility?: number
      response?: 'soft' | 'crumble'
      plasticStrain?: Float32Array
      plasticGradients?: Float32Array
      plasticIncrement?: Float32Array
    },
  ) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
      throw new Error('Invalid runtime fracture elapsed time')
    if (
      positions.length !== mesh.positions.length ||
      positions.some((value) => !Number.isFinite(value))
    )
      throw new Error('Runtime fracture snapshot must match its live mesh')
    const material = gummyJellyFractureParameters(options.fragility)
    const soft = options.response === 'soft'
    const fragility = Math.max(0, Math.min(1, options.fragility ?? 0))
    const plasticLimit = 0.04 + 0.15 * (1 - fragility)
    const workCapacity = 0.006 + 0.025 * (1 - fragility) ** 2
    if (
      soft &&
      options.plasticStrain &&
      (options.plasticStrain.length !== tetCount ||
        options.plasticStrain.some(
          (value) => !Number.isFinite(value) || value < 0,
        ))
    )
      throw new Error(
        'Ductile fracture requires finite plastic strain per tetrahedron',
      )
    if (
      soft &&
      options.plasticGradients &&
      (options.plasticGradients.length !== tetCount * 9 ||
        options.plasticGradients.some((value) => !Number.isFinite(value)))
    )
      throw new Error(
        'Ductile fracture requires a finite elastic frame per tetrahedron',
      )
    if (
      soft &&
      options.plasticIncrement &&
      (options.plasticIncrement.length !== tetCount ||
        options.plasticIncrement.some(
          (value) => !Number.isFinite(value) || value < 0,
        ))
    )
      throw new Error(
        'Ductile fracture requires finite positive plastic increments per tetrahedron',
      )
    if (
      soft &&
      (!options.plasticStrain ||
        !options.plasticGradients ||
        !options.plasticIncrement)
    )
      return undefined
    if (!soft && (!options.tearing || elapsedSeconds === 0)) return undefined
    const tension = evaluateGummyTensileStrain(
      positions,
      mesh.tetrahedra,
      soft && options.plasticGradients
        ? { ...strainGeometry, gradients: options.plasticGradients }
        : strainGeometry,
      strainWorkspace,
    )
    for (let tet = 0; tet < tetCount; tet++)
      ratios[tet] =
        volume(positions, mesh.tetrahedra, tet * 4) / restVolumes[tet]!
    const pending: { id: number; opening: number }[] = []
    for (let id = 0; id < interior.length; id++) {
      if (failed[id]) continue
      const face = interior[id]!
      // Inverted or strongly compressed elements cannot initiate tensile cracks.
      if (ratios[face.tetA]! < 0.35 || ratios[face.tetB]! < 0.35) continue
      const normal = areaNormal(
        positions,
        mesh.tetrahedra,
        face.a,
        normalScratch,
      )
      const length = Math.hypot(normal[0], normal[1], normal[2])
      if (length < 1e-12) continue
      const volumeA = restVolumes[face.tetA]!,
        volumeB = restVolumes[face.tetB]!
      for (let axis = 0; axis < 6; axis++)
        averageScratch[axis] =
          (volumeA * tension[face.tetA * 6 + axis]! +
            volumeB * tension[face.tetB * 6 + axis]!) /
          (volumeA + volumeB)
      const opening = soft
        ? gummyNormalTensileOpening(averageScratch, normal)
        : gummyMixedTensileOpening(averageScratch, normal)
      maxOpening = Math.max(maxOpening, opening)
      let threshold = material.opening
      let rate = material.rate
      let dose = 0
      if (soft) {
        const previousPeak = peakElasticOpening[id]!
        peakElasticOpening[id] = Math.max(previousPeak, opening)
        // Disabled or paused loading is observed but never banked for later tearing.
        if (!options.tearing || elapsedSeconds === 0) continue
        const plasticA = options.plasticStrain![face.tetA]!,
          plasticB = options.plasticStrain![face.tetB]!
        const plastic =
          (volumeA * plasticA + volumeB * plasticB) / (volumeA + volumeB)
        if (plastic <= plasticLimit) continue
        const increment =
          (volumeA * options.plasticIncrement![face.tetA]! +
            volumeB * options.plasticIncrement![face.tetB]!) /
          (volumeA + volumeB)
        // Spend new plastic work, never elapsed time at an old permanently yielded
        // shape. Count only the part crossing above the initial ductility allowance.
        const workIncrement = Math.min(increment, plastic - plasticLimit)
        // The finite plastic limit enters a second elastic regime. Only a NEW
        // historical maximum opening can spend its loading budget, not held stress.
        const saturated =
          (volumeA * (plasticA >= 1.2 - 1e-6 ? 1 : 0) +
            volumeB * (plasticB >= 1.2 - 1e-6 ? 1 : 0)) /
          (volumeA + volumeB)
        const tensileExcess = Math.max(0, opening - 1.015)
        const saturatedWork =
          0.5 *
          saturated *
          Math.max(
            0,
            tensileExcess ** 2 - Math.max(0, previousPeak - 1.015) ** 2,
          )
        // Preserve the same local graphics-material law at every resolution.
        // This dimensionless work proxy is not calibrated fracture energy;
        // whole-body crack patterns and dissipation can still depend on the mesh.
        dose = (workIncrement * tensileExcess + saturatedWork) / workCapacity
      } else {
        if (material.propagationOpening < threshold)
          for (const neighbour of neighbours[id]!)
            if (failed[neighbour]) {
              threshold = material.propagationOpening
              rate = material.propagationRate
              break
            }
        dose = elapsedSeconds * rate * Math.max(0, opening - threshold)
      }
      // Strain history is independent of UI softness; deformation already reflects that material choice.
      history[id] = Math.min(1, history[id]! + dose)
      if (history[id]! >= 1) pending.push({ id, opening })
    }
    diagnostics = { ...diagnostics, maxOpening }
    if (!pending.length) return undefined
    pending.sort((a, b) => b.opening - a.opening || a.id - b.id)
    // Commit together: this event can weaken neighbours only on the next assessment.
    for (const face of pending.slice(0, MAX_FACES_PER_EVENT))
      failed[face.id] = 1
    return split()
  }

  return {
    assess,
    checkpoint,
    restore,
    get mesh() {
      return mesh
    },
    get originalNodeIds() {
      return originalNodeIds
    },
    get nodeMasses() {
      return nodeMasses
    },
    get failedFaceIds() {
      return failedFaceIds()
    },
    get diagnostics() {
      return diagnostics
    },
    reset() {
      failed.fill(0)
      history.fill(0)
      peakElasticOpening.fill(1)
      mesh = initialMesh
      originalNodeIds = Uint32Array.from(
        { length: originalCount },
        (_, id) => id,
      )
      nodeMasses = new Float64Array(initialMasses)
      topologyVersion = 0
      maxOpening = 1
      diagnostics = makeDiagnostics(0)
    },
  }
}
