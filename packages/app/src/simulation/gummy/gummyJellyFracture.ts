/** Extrinsic tetrahedral fracture: intact shared DOFs split only after local tensile opening history fails. */
import { assessJellyFractureDamage } from './gummyJellyFractureAssessment'
import { mechanicalComponents, prepareJellyFractureGeometry, } from './gummyJellyFractureGeometry'
import { partitionJellyFractureNodes } from './gummyJellyFractureTopology'
import { EXPOSED_TEAR_FACE, EXTERIOR_FACE } from './gummyMeshContracts'
import type { GummyJellyFractureAssessment } from './gummyJellyFractureAssessment'
import type { JellyFractureDiagnostics } from './gummyJellyFractureGeometry'
import type { GummyMesh } from './gummyMeshContracts'

export {
  GUMMY_JELLY_TEAR_OPENING,
  GUMMY_JELLY_TEAR_RATE,
  GUMMY_JELLY_DEFAULT_FRAGILITY,
  GUMMY_JELLY_CRACK_BAND_SPACING,
  gummyJellyFractureParameters,
} from './gummyJellyFractureGeometry'
export type {
  JellyFractureComponent,
  JellyFractureDiagnostics,
} from './gummyJellyFractureGeometry'
const CHECKPOINT = Symbol('Jelly fracture checkpoint')
export type JellyFractureCheckpoint = Readonly<{ [CHECKPOINT]: true }>

/** Facets are possible mesh-aligned cracks, never pre-separated limbs or compliant intact seams. */
export function createGummyJellyFracture(initialMesh: GummyMesh) {
  const geometry = prepareJellyFractureGeometry(initialMesh)
  const {
    originalCount,
    tetCount,
    restVolumes,
    interior,
    exterior,
    actualRestVolume,
    initialMasses,
  } = geometry
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
    const { sources, masses, ids, tetrahedra } = partitionJellyFractureNodes(
      geometry,
      mesh,
      failed,
      nodeMasses,
      originalNodeIds,
    )
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
    options: GummyJellyFractureAssessment,
  ) {
    const result = assessJellyFractureDamage(
      geometry,
      mesh,
      positions,
      elapsedSeconds,
      options,
      failed,
      history,
      peakElasticOpening,
      maxOpening,
    )
    if (!result) return undefined
    maxOpening = result.maxOpening
    diagnostics = { ...diagnostics, maxOpening }
    if (!result.failedChanged) return undefined
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
