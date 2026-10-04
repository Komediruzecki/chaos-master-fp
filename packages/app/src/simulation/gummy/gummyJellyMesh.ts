/** Continuous jelly meshes share the Standard study density at every geometric resolution. */
import { buildGummyBearMesh } from './gummyMesh'
import type { GummyMesh } from './gummyMesh'

let standardMassReference: number | undefined

/** Volume represented by one study mass unit, before the clipped-sliver mass floor. */
export type GummyJellyMesh = GummyMesh & { massReferenceVolume: number }

export function buildGummyJellyMesh(
  options: { spacing?: number; pinnedFeet?: boolean; pinHeight?: number } = {},
): GummyJellyMesh {
  const mesh = buildGummyBearMesh({ ...options, fracture: 'none' })
  const averageVolume = mesh.restVolume / (mesh.positions.length / 4)
  if (standardMassReference === undefined) {
    const standard =
      mesh.spacing === 0.14
        ? mesh
        : buildGummyBearMesh({ spacing: 0.14, fracture: 'none' })
    standardMassReference =
      standard.restVolume / (standard.positions.length / 4)
  }
  // The original builder gives every mesh an average nodal mass near one.
  // Retaining that convention on a denser mesh makes the entire bear heavier.
  // Rescale only inverse mass; Standard values and the local sliver floor stay
  // intact, while the existing volume-integrated elastic energy uses one density.
  if (mesh.spacing !== 0.14) {
    const scale = standardMassReference / averageVolume
    for (let i = 3; i < mesh.positions.length; i += 4)
      if (mesh.positions[i]! > 0) mesh.positions[i]! *= scale
  }
  return { ...mesh, massReferenceVolume: standardMassReference }
}
