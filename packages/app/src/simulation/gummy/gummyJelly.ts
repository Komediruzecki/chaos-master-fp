/** Rest-state continuum geometry and study-unit elasticity for the unsegmented jelly comparison. */
import type { GummySolverMesh } from './gummySolver'

export const GUMMY_JELLY_SOLVER_ITERATIONS = 24

/** Normalized nodal masses are retained: these moduli are study units, not measured pascals. */
export function gummyJellyMaterial(softness: number) {
  const s = Number.isFinite(softness) ? Math.max(0, Math.min(1, softness)) : 0.5
  // The tall upright specimen needs enough shear resistance to avoid gravity buckling.
  const shearModulus = 780000 * 0.12 ** s
  const bulkModulus = shearModulus * 800
  return {
    shearModulus,
    bulkModulus,
    stretchCompliance: 1 / shearModulus,
    volumeCompliance: 1 / bulkModulus,
    damping: 0.95,
  }
}

/** Each 64-byte record packs indices and the three rest shape-function gradients; b0.w holds volume. */
export function prepareGummyJellyTets(mesh: GummySolverMesh) {
  if (
    !mesh.positions.length ||
    mesh.positions.length % 4 ||
    !mesh.tetrahedra.length ||
    mesh.tetrahedra.length % 4
  )
    throw new Error('Invalid jelly mesh buffer lengths')
  const result = new Float32Array((mesh.tetrahedra.length / 4) * 16)
  const ids = new Uint32Array(result.buffer)
  for (let offset = 0; offset < mesh.tetrahedra.length; offset += 4) {
    const vertices = [...mesh.tetrahedra.subarray(offset, offset + 4)]
    if (vertices.some((id) => id * 4 >= mesh.positions.length))
      throw new Error('Jelly tet node index out of range')
    const p = vertices.map((id) => [
      ...mesh.positions.subarray(id * 4, id * 4 + 3),
    ])
    if (p.some((v) => v.some((value) => !Number.isFinite(value))))
      throw new Error('Invalid jelly rest position')
    const e = p
      .slice(1)
      .map((v) => v.map((value, axis) => value - p[0]![axis]!))
    const cross = (a: number[], b: number[]) => [
      a[1]! * b[2]! - a[2]! * b[1]!,
      a[2]! * b[0]! - a[0]! * b[2]!,
      a[0]! * b[1]! - a[1]! * b[0]!,
    ]
    const rows = [cross(e[1]!, e[2]!), cross(e[2]!, e[0]!), cross(e[0]!, e[1]!)]
    const determinant = e[0]!.reduce(
      (sum, value, axis) => sum + value * rows[0]![axis]!,
      0,
    )
    if (!(determinant > 1e-15))
      throw new Error('Jelly tets must have positive nonzero rest volume')
    const base = offset * 4
    ids.set(vertices, base)
    for (let row = 0; row < 3; row++)
      result.set(
        rows[row]!.map((value) => value / determinant),
        base + 4 + row * 4,
      )
    result[base + 7] = determinant / 6
  }
  return result
}
