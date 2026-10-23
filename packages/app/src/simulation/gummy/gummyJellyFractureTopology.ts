/** Vertex-star partitioning with conservative mass transfer for newly failed jelly faces. */
import { unionFind } from './gummyJellyFractureGeometry'
import type { prepareJellyFractureGeometry } from './gummyJellyFractureGeometry'
import type { GummyMesh } from './gummyMeshContracts'

export function partitionJellyFractureNodes(
  geometry: ReturnType<typeof prepareJellyFractureGeometry>,
  mesh: GummyMesh,
  failed: Uint8Array,
  nodeMasses: Float64Array,
  originalNodeIds: Uint32Array,
) {
  const { originalTets, interior, restVolumes } = geometry
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
        throw new Error('Runtime fracture produced nonpositive partition mass')
      masses[id] = mass
      usedMass += mass
      for (const corner of group.corners) tetrahedra[corner] = id
      index++
    }
  }
  return { sources, masses, ids, tetrahedra }
}
