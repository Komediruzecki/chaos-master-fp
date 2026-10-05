/** Objective, mesh-scale regularized tensile strain for mixed-mode tetrahedral face failure. */
import { writeGummyDeformation, writeGummyLeftTensor, } from './gummyMaterialMath'
import type { GummyMesh } from './gummyMesh'

type StrainGeometry = {
  gradients: Float64Array | Float32Array
  regularization: Float64Array
}
const cross = (a: number[], b: number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
]

/** Shape gradients are constant in material coordinates; min altitude resolves clipped slivers. */
export function prepareGummyFractureStrain(
  mesh: GummyMesh,
  bandSpacing: number,
): StrainGeometry {
  const count = mesh.tetrahedra.length / 4
  const gradients = new Float64Array(count * 9),
    regularization = new Float64Array(count)
  for (let tet = 0; tet < count; tet++) {
    const p = Array.from({ length: 4 }, (_, i) =>
      Array.from(
        mesh.positions.subarray(
          mesh.tetrahedra[tet * 4 + i]! * 4,
          mesh.tetrahedra[tet * 4 + i]! * 4 + 3,
        ),
      ),
    )
    const e = p.slice(1).map((v) => v.map((x, a) => x - p[0]![a]!))
    const rows = [cross(e[1]!, e[2]!), cross(e[2]!, e[0]!), cross(e[0]!, e[1]!)]
    const determinant = e[0]!.reduce((s, x, a) => s + x * rows[0]![a]!, 0)
    for (let row = 0; row < 3; row++)
      for (let a = 0; a < 3; a++)
        gradients[tet * 9 + row * 3 + a] = rows[row]![a]! / determinant
    let maxArea2 = 0
    for (const ids of [
      [1, 2, 3],
      [0, 3, 2],
      [0, 1, 3],
      [0, 2, 1],
    ]) {
      const a = p[ids[0]!]!,
        b = p[ids[1]!]!,
        c = p[ids[2]!]!
      maxArea2 = Math.max(
        maxArea2,
        Math.hypot(
          ...cross(
            b.map((x, i) => x - a[i]!),
            c.map((x, i) => x - a[i]!),
          ),
        ),
      )
    }
    const minimumAltitude = determinant / maxArea2
    regularization[tet] = Math.min(
      1,
      minimumAltitude / (mesh.spacing * bandSpacing),
    )
  }
  return { gradients, regularization }
}

/** Spectral positive part of FF^T, regularized in principal stretch before squaring.
 * Output is xx,yy,zz,xy,yz,zx. No hydrostatic-pressure estimate is used: this is a
 * strain-based failure indicator, not a calibrated stress or fracture energy.
 */
export function gummyPositiveTensileStrain(
  f: ArrayLike<number>,
  regularization = 1,
) {
  const tensor = new Float64Array(6)
  writePositiveTensileStrain(
    f,
    regularization,
    tensor,
    0,
    new Float64Array(9),
    new Float64Array(9),
  )
  return tensor
}

function writePositiveTensileStrain(
  f: ArrayLike<number>,
  regularization: number,
  tensor: Float64Array,
  offset: number,
  b: Float64Array,
  vectors: Float64Array,
) {
  vectors.fill(0)
  vectors[0] = vectors[4] = vectors[8] = 1
  tensor.fill(0, offset, offset + 6)
  writeGummyLeftTensor(f, b)
  // Symmetric Jacobi eigenvectors are objective, including arbitrary rigid rotations.
  for (let iteration = 0; iteration < 12; iteration++) {
    let p = 0,
      q = 1
    if (Math.abs(b[2]!) > Math.abs(b[p * 3 + q]!)) {
      p = 0
      q = 2
    }
    if (Math.abs(b[5]!) > Math.abs(b[p * 3 + q]!)) {
      p = 1
      q = 2
    }
    const off = b[p * 3 + q]!
    if (Math.abs(off) < 1e-12 * Math.max(1, b[0]!, b[4]!, b[8]!)) break
    const theta = (b[q * 3 + q]! - b[p * 3 + p]!) / (2 * off)
    const t =
      (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta))
    const c = 1 / Math.sqrt(1 + t * t),
      s = t * c
    b[p * 3 + p]! -= t * off
    b[q * 3 + q]! += t * off
    b[p * 3 + q] = 0
    b[q * 3 + p] = 0
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const a = b[k * 3 + p]!,
          d = b[k * 3 + q]!
        b[k * 3 + p] = b[p * 3 + k] = c * a - s * d
        b[k * 3 + q] = b[q * 3 + k] = s * a + c * d
      }
      const vp = vectors[k * 3 + p]!,
        vq = vectors[k * 3 + q]!
      vectors[k * 3 + p] = c * vp - s * vq
      vectors[k * 3 + q] = s * vp + c * vq
    }
  }
  for (let i = 0; i < 3; i++) {
    const stretch =
      1 +
      Math.max(0, Math.sqrt(Math.max(0, b[i * 3 + i]!)) - 1) * regularization
    const weight = stretch * stretch - 1
    const x = vectors[i]!,
      y = vectors[3 + i]!,
      z = vectors[6 + i]!
    tensor[offset + 0]! += weight * x * x
    tensor[offset + 1]! += weight * y * y
    tensor[offset + 2]! += weight * z * z
    tensor[offset + 3]! += weight * x * y
    tensor[offset + 4]! += weight * y * z
    tensor[offset + 5]! += weight * z * x
  }
}

/** Caller-owned scratch keeps the assessment hot path allocation-free per element. */
export function createGummyTensileWorkspace(tetCount: number) {
  return {
    f: new Float64Array(9),
    b: new Float64Array(9),
    vectors: new Float64Array(9),
    output: new Float64Array(tetCount * 6),
  }
}

/** Current tensors in world coordinates; original gradients follow each unchanged tetrahedron. */
export function evaluateGummyTensileStrain(
  positions: Float32Array,
  tets: Uint32Array,
  geometry: StrainGeometry,
  workspace = createGummyTensileWorkspace(tets.length / 4),
) {
  const { output, f, b, vectors } = workspace
  if (output.length !== (tets.length / 4) * 6)
    throw new Error('Tensile workspace must match the tetrahedron count')
  for (let tet = 0; tet < tets.length / 4; tet++) {
    writeGummyDeformation(positions, tets, geometry.gradients, tet, f)
    writePositiveTensileStrain(
      f,
      geometry.regularization[tet]!,
      output,
      tet * 6,
      b,
      vectors,
    )
  }
  return output
}

/** Effective tensile stretch includes shear on oblique facets but vanishes for all-compressive strain. */
export function gummyMixedTensileOpening(
  tensor: ArrayLike<number>,
  normal: readonly number[],
  offset = 0,
) {
  const x = normal[0]!,
    y = normal[1]!,
    z = normal[2]!
  const tx =
    tensor[offset]! * x + tensor[offset + 3]! * y + tensor[offset + 5]! * z
  const ty =
    tensor[offset + 3]! * x + tensor[offset + 1]! * y + tensor[offset + 4]! * z
  const tz =
    tensor[offset + 5]! * x + tensor[offset + 4]! * y + tensor[offset + 2]! * z
  return Math.sqrt(1 + Math.hypot(tx, ty, tz) / Math.hypot(x, y, z))
}

/** Normal tensile stretch selects a separating crack plane rather than mixed oblique traction. */
export function gummyNormalTensileOpening(
  tensor: ArrayLike<number>,
  normal: readonly number[],
) {
  const [x, y, z] = normal as readonly [number, number, number]
  const positive =
    tensor[0]! * x * x +
    tensor[1]! * y * y +
    tensor[2]! * z * z +
    2 * (tensor[3]! * x * y + tensor[4]! * y * z + tensor[5]! * z * x)
  return Math.sqrt(1 + Math.max(0, positive) / (x * x + y * y + z * z))
}
