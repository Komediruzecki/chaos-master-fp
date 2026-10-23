/** Watertight procedural gummy solid, clipped tetrahedra and paired cohesive tear faces. */
import { clipTetrahedron, CUBE_TETS, fieldNormal, gummyBearField, TET_FACES, tetrahedronVolume, } from './gummyBearGeometry'
import { EXTERIOR_FACE, GUMMY_DEMO_GRIP } from './gummyMeshContracts'
import { partitionGummyCells } from './gummyPartition'
import type { Face, Tet } from './gummyBearGeometry'
import type { GummyMesh, GummyVec3 } from './gummyMeshContracts'

export { gummyBearField, tetrahedronVolume } from './gummyBearGeometry'
export {
  EXTERIOR_FACE,
  EXPOSED_TEAR_FACE,
  GUMMY_DEMO_GRIP,
} from './gummyMeshContracts'
export type { GummyMesh, GummyVec3 } from './gummyMeshContracts'

function tearRegion(p: GummyVec3) {
  if (p[0] > 0.455 && p[1] > 0.74 && p[1] < 1.6) return 1
  if (p[1] > 2.25 && p[0] > 0.16) return 2
  if (p[1] > 2.25 && p[0] < -0.16) return 3
  if (p[0] < -0.455 && p[1] > 0.74 && p[1] < 1.6) return 4
  return 0
}

function sampleGummyBearCells(spacing: number) {
  const min: GummyVec3 = [-0.84, -0.035, -0.49]
  const max: GummyVec3 = [0.84, 2.66, 0.63]
  const size = min.map((x, k) => Math.ceil((max[k]! - x) / spacing) + 1)
  const points: GummyVec3[] = []
  const values: number[] = []
  const idAt = (x: number, y: number, z: number) =>
    x + size[0]! * (y + size[1]! * z)
  for (let z = 0; z < size[2]!; z++)
    for (let y = 0; y < size[1]!; y++)
      for (let x = 0; x < size[0]!; x++) {
        const p: GummyVec3 = [
          min[0] + x * spacing,
          min[1] + y * spacing,
          min[2] + z * spacing,
        ]
        points.push(p)
        values.push(gummyBearField(p))
      }
  const edges = new Map<string, number>()
  const sourceTets: Tet[] = []
  const sourceRegions: number[] = []
  const sourceCells: number[] = []
  const cellCenters = new Map<number, GummyVec3>()
  for (let z = 0; z < size[2]! - 1; z++)
    for (let y = 0; y < size[1]! - 1; y++)
      for (let x = 0; x < size[0]! - 1; x++) {
        const corners = [
          idAt(x, y, z),
          idAt(x + 1, y, z),
          idAt(x, y + 1, z),
          idAt(x + 1, y + 1, z),
          idAt(x, y, z + 1),
          idAt(x + 1, y, z + 1),
          idAt(x, y + 1, z + 1),
          idAt(x + 1, y + 1, z + 1),
        ]
        // A tear plane follows whole cell faces. Classifying individual clipped
        // tetrahedra by their centroids can leave pinched, non-manifold edges.
        const center: GummyVec3 = [
          min[0] + (x + 0.5) * spacing,
          min[1] + (y + 0.5) * spacing,
          min[2] + (z + 0.5) * spacing,
        ]
        const region = tearRegion(center)
        const cell = idAt(x, y, z)
        cellCenters.set(cell, center)
        for (const local of CUBE_TETS) {
          const tet = local.map((index) => corners[index]!) as Tet
          const clipped = clipTetrahedron(tet, points, values, edges)
          sourceTets.push(...clipped)
          sourceRegions.push(...clipped.map(() => region))
          sourceCells.push(...clipped.map(() => cell))
        }
      }
  return { points, sourceTets, sourceRegions, sourceCells, cellCenters }
}

function assembleGummyMesh(
  points: GummyVec3[],
  sourceTets: Tet[],
  regions: ArrayLike<number>,
) {
  const positions: number[] = [],
    normals: number[] = [],
    nodeRegions: number[] = []
  const masses: number[] = []
  const mapped = new Map<string, number>()
  const remap = (source: number, region: number) => {
    const key = `${source}:${region}`
    const found = mapped.get(key)
    if (found !== undefined) return found
    const id = positions.length / 4
    positions.push(...points[source]!, 0)
    normals.push(...fieldNormal(points[source]!), 0)
    nodeRegions.push(region)
    masses.push(0)
    mapped.set(key, id)
    return id
  }
  type FaceRecord = { source: Face; target: Face; region: number }
  const faces = new Map<string, FaceRecord>()
  const interfaces: number[] = [],
    surface: number[] = [],
    tetrahedra: number[] = []
  let restVolume = 0
  for (let tetId = 0; tetId < sourceTets.length; tetId++) {
    const tet = sourceTets[tetId]!
    const region = regions[tetId]!
    const target = tet.map((id) => remap(id, region)) as Tet
    const volume = tetrahedronVolume(
      ...(tet.map((id) => points[id]!) as [
        GummyVec3,
        GummyVec3,
        GummyVec3,
        GummyVec3,
      ]),
    )
    if (volume <= 0)
      throw new Error('Gummy tetrahedron has non-positive volume')
    restVolume += volume
    tetrahedra.push(...target)
    for (const id of target) masses[id]! += volume * 0.25
    for (const corners of TET_FACES) {
      const source = corners.map((i) => tet[i]) as Face
      const face = corners.map((i) => target[i]) as Face
      const key = [...source].sort((a, b) => a - b).join(':')
      const previous = faces.get(key)
      if (previous) {
        faces.delete(key)
        if (previous.region !== region) {
          const interfaceId = interfaces.length / 8
          for (let i = 0; i < 3; i++)
            interfaces.push(
              previous.target[i]!,
              face[source.indexOf(previous.source[i]!)]!,
            )
          interfaces.push(0, 0)
          surface.push(...previous.target, interfaceId, ...face, interfaceId)
        }
      } else faces.set(key, { source, target: face, region })
    }
  }
  for (const face of faces.values()) surface.push(...face.target, EXTERIOR_FACE)
  return {
    positions,
    normals,
    nodeRegions,
    masses,
    interfaces,
    surface,
    tetrahedra,
    restVolume,
  }
}

/** Build a conforming solid once on CPU; all subsequent deformation runs on the GPU. */
export function buildGummyBearMesh(
  options:
    | {
        spacing?: number
        fracture?: 'fine' | 'limbs' | 'none'
        pinnedFeet?: boolean
        /** Height of the fixed lower fixture. The original limb study uses 0.065. */
        pinHeight?: number
      }
    | number = {},
): GummyMesh {
  if (typeof options === 'number') options = { spacing: options }
  const spacing = options.spacing ?? 0.14
  const pinHeight = options.pinHeight ?? 0.065
  if (!Number.isFinite(pinHeight) || pinHeight < 0 || pinHeight > 0.5)
    throw new RangeError(
      'The gummy lower fixture height must be between 0 and 0.5 metres',
    )
  if (!Number.isFinite(spacing) || spacing < 0.07 || spacing > 0.3)
    throw new RangeError(
      'Gummy mesh spacing must be between 0.07 and 0.3 metres',
    )
  const { points, sourceTets, sourceRegions, sourceCells, cellCenters } =
    sampleGummyBearCells(spacing)
  const regions =
    options.fracture === 'fine'
      ? partitionGummyCells(
          sourceTets,
          sourceCells,
          cellCenters,
          sourceTets.map((tet) =>
            tetrahedronVolume(
              points[tet[0]]!,
              points[tet[1]]!,
              points[tet[2]]!,
              points[tet[3]]!,
            ),
          ),
        )
      : options.fracture === 'none'
        ? sourceRegions.map(() => 0)
        : sourceRegions
  const {
    positions,
    normals,
    nodeRegions,
    masses,
    interfaces,
    surface,
    tetrahedra,
    restVolume,
  } = assembleGummyMesh(points, sourceTets, regions)
  const averageMass = restVolume / masses.length
  const bounds = {
    min: [Infinity, Infinity, Infinity] as GummyVec3,
    max: [-Infinity, -Infinity, -Infinity] as GummyVec3,
  }
  for (let i = 0; i < masses.length; i++) {
    // Normalized lumped mass avoids extreme inverse masses in clipped slivers.
    positions[i * 4 + 3] =
      options.pinnedFeet !== false && positions[i * 4 + 1]! < pinHeight
        ? 0
        : averageMass / Math.max(masses[i]!, averageMass * 0.1)
    for (let k = 0; k < 3; k++) {
      bounds.min[k] = Math.min(bounds.min[k]!, positions[i * 4 + k]!)
      bounds.max[k] = Math.max(bounds.max[k]!, positions[i * 4 + k]!)
    }
  }
  return {
    positions: new Float32Array(positions),
    tetrahedra: new Uint32Array(tetrahedra),
    interfaces: new Uint32Array(interfaces),
    surface: new Uint32Array(surface),
    restNormals: new Float32Array(normals),
    nodeRegions: new Uint32Array(nodeRegions),
    spacing,
    restVolume,
    bounds,
    demoGrip: GUMMY_DEMO_GRIP,
  }
}
