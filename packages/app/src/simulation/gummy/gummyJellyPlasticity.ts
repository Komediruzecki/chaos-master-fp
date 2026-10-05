/** Isochoric finite-strain creep: material yields before tearing while original mass, volume and dye stay fixed. */
import { prepareGummyJellyTets } from './gummyJelly'
import { writeGummyDeformation, writeGummyRightTensor, } from './gummyMaterialMath'
import type { GummySolverMesh } from './gummySolver'

/** Effective inverse rest frames, in stable tetrahedron order; rows are tightly packed. */
export type JellyPlasticState = {
  gradients: Float32Array
  equivalentPlasticStrain: Float32Array
}

export function copyJellyPlasticState(
  state: JellyPlasticState,
): JellyPlasticState {
  return {
    gradients: state.gradients.slice(),
    equivalentPlasticStrain: state.equivalentPlasticStrain.slice(),
  }
}

export function gummyJellyPlasticMaterial(softness: number) {
  const s = Math.max(
    0,
    Math.min(1, Number.isFinite(softness) ? softness : 0.55),
  )
  return {
    yieldStrain: 0.26 - 0.08 * s,
    creepRate: 8,
    hardening: 0.03,
    plasticLimit: 1.2,
  }
}

const determinant = (m: ArrayLike<number>, offset = 0) =>
  m[offset]! *
    (m[offset + 4]! * m[offset + 8]! - m[offset + 5]! * m[offset + 7]!) -
  m[offset + 1]! *
    (m[offset + 3]! * m[offset + 8]! - m[offset + 5]! * m[offset + 6]!) +
  m[offset + 2]! *
    (m[offset + 3]! * m[offset + 7]! - m[offset + 4]! * m[offset + 6]!)

/** Symmetric Jacobi rotation, returning eigenvalues on the diagonal and eigenvectors in columns. */
function diagonalize(a: Float64Array, v: Float64Array) {
  v.fill(0)
  v[0] = v[4] = v[8] = 1
  for (let iteration = 0; iteration < 16; iteration++) {
    let p = 0,
      q = 1
    if (Math.abs(a[2]!) > Math.abs(a[p * 3 + q]!)) {
      p = 0
      q = 2
    }
    if (Math.abs(a[5]!) > Math.abs(a[p * 3 + q]!)) {
      p = 1
      q = 2
    }
    const off = a[p * 3 + q]!
    if (Math.abs(off) < 1e-12 * Math.max(1, a[0]!, a[4]!, a[8]!)) break
    const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * off)
    const t =
      (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta))
    const c = 1 / Math.sqrt(1 + t * t),
      s = t * c
    a[p * 3 + p]! -= t * off
    a[q * 3 + q]! += t * off
    a[p * 3 + q] = a[q * 3 + p] = 0
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const x = a[k * 3 + p]!,
          y = a[k * 3 + q]!
        a[k * 3 + p] = a[p * 3 + k] = c * x - s * y
        a[k * 3 + q] = a[q * 3 + k] = s * x + c * y
      }
      const x = v[k * 3 + p]!,
        y = v[k * 3 + q]!
      v[k * 3 + p] = c * x - s * y
      v[k * 3 + q] = s * x + c * y
    }
  }
}

/** Multiplicative Fe=Ds Be; trace-free log-stretch return keeps det(Be) fixed.
 * This graphics material follows finite-strain plasticity, not measured gummy rheology.
 * References: Irving 2007, section 2.6.3; Bargteil et al. 2007 viscoplastic FEM.
 */
export function createGummyJellyPlasticity(
  mesh: GummySolverMesh,
  preparedRestTets?: Float32Array,
) {
  const packed = preparedRestTets ?? prepareGummyJellyTets(mesh)
  const count = mesh.tetrahedra.length / 4
  if (packed.length !== count * 16)
    throw new Error('Prepared jelly material must match the tetrahedron count')
  const rest = new Float32Array(count * 9)
  const restDeterminants = new Float64Array(count)
  const regularization = new Float64Array(count)
  const nodalWeight = new Float64Array(mesh.positions.length / 4)
  const nodalEnergy = new Float64Array(nodalWeight.length)
  for (let tet = 0; tet < count; tet++) {
    let largestGradient = 0
    const anchor = [0, 0, 0]
    for (let row = 0; row < 3; row++) {
      let squared = 0
      for (let col = 0; col < 3; col++) {
        const value = packed[tet * 16 + 4 + row * 4 + col]!
        rest[tet * 9 + row * 3 + col] = value
        squared += value * value
        anchor[col]! += value
      }
      largestGradient = Math.max(largestGradient, Math.sqrt(squared))
    }
    largestGradient = Math.max(largestGradient, Math.hypot(...anchor))
    regularization[tet] = Math.min(
      1,
      1 / (largestGradient * (mesh.spacing ?? 0.14) * 0.25),
    )
    restDeterminants[tet] = determinant(rest, tet * 9)
    for (let corner = 0; corner < 4; corner++)
      nodalWeight[mesh.tetrahedra[tet * 4 + corner]!]! += packed[tet * 16 + 7]!
  }
  let state: JellyPlasticState = {
    gradients: rest.slice(),
    equivalentPlasticStrain: new Float32Array(count),
  }
  const f = new Float64Array(9),
    c = new Float64Array(9),
    v = new Float64Array(9)
  const logs = new Float64Array(3),
    q = new Float64Array(9),
    next = new Float64Array(9)
  // Cache the spectral strain used by both patch yielding and the local return.
  // Every valid cell is diagonalized once per assessment, including yielding cells.
  const principalLogs = new Float64Array(count * 3)
  const principalVectors = new Float64Array(count * 9)
  const equivalentStrain = new Float64Array(count)
  const valid = new Uint8Array(count)

  function deformation(positions: Float32Array, tet: number) {
    writeGummyDeformation(positions, mesh.tetrahedra, state.gradients, tet, f)
    return determinant(f)
  }

  function restore(saved?: JellyPlasticState) {
    if (!saved) {
      state = {
        gradients: rest.slice(),
        equivalentPlasticStrain: new Float32Array(count),
      }
      return
    }
    if (
      saved.gradients.length !== rest.length ||
      saved.equivalentPlasticStrain.length !== count ||
      saved.gradients.some((x) => !Number.isFinite(x)) ||
      saved.equivalentPlasticStrain.some(
        (x) => !Number.isFinite(x) || x < 0 || x > 1.21,
      )
    )
      throw new Error('Invalid jelly plastic-state snapshot')
    for (let tet = 0; tet < count; tet++)
      if (
        Math.abs(
          determinant(saved.gradients, tet * 9) / restDeterminants[tet]! - 1,
        ) > 0.002
      )
        throw new Error(
          'Jelly plastic state must preserve original material volume',
        )
    state = copyJellyPlasticState(saved)
  }

  function update(
    positions: Float32Array,
    elapsedSeconds: number,
    options: { softness: number; fragility?: number },
  ) {
    if (
      positions.length !== mesh.positions.length ||
      positions.some((x) => !Number.isFinite(x)) ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds < 0
    )
      throw new Error('Invalid jelly plasticity update')
    const material = gummyJellyPlasticMaterial(options.softness)
    const plasticIncrement = new Float32Array(count)
    // A volume-weighted patch uses the same deviatoric Hencky strain as the
    // local return. A Frobenius energy would amplify a strongly distorted small
    // neighbour far more than the logarithmic material law and falsely yield
    // otherwise elastic cells. This nonlocal gate remains objective.
    nodalEnergy.fill(0)
    valid.fill(0)
    for (let tet = 0; tet < count; tet++) {
      const jacobian = deformation(positions, tet)
      if (jacobian < 0.5 || jacobian > 2) continue
      writeGummyRightTensor(f, c)
      diagonalize(c, v)
      let mean = 0
      for (let axis = 0; axis < 3; axis++) {
        logs[axis] = 0.5 * Math.log(Math.max(1e-12, c[axis * 3 + axis]!))
        mean += logs[axis]! / 3
      }
      for (let axis = 0; axis < 3; axis++) logs[axis]! -= mean
      const equivalent =
        Math.hypot(logs[0]!, logs[1]!, logs[2]!) * regularization[tet]!
      valid[tet] = 1
      principalLogs.set(logs, tet * 3)
      principalVectors.set(v, tet * 9)
      equivalentStrain[tet] = equivalent
      const energy = equivalent ** 2 * packed[tet * 16 + 7]!
      for (let corner = 0; corner < 4; corner++)
        nodalEnergy[mesh.tetrahedra[tet * 4 + corner]!]! += energy
    }
    let changedTets = 0,
      maxPlasticStrain = 0
    for (let tet = 0; tet < count; tet++) {
      const base = tet * 9
      const accumulated = state.equivalentPlasticStrain[tet]!
      maxPlasticStrain = Math.max(maxPlasticStrain, accumulated)
      if (
        !elapsedSeconds ||
        accumulated >= material.plasticLimit ||
        !valid[tet]
      )
        continue
      let patchEnergy = 0
      for (let corner = 0; corner < 4; corner++) {
        const node = mesh.tetrahedra[tet * 4 + corner]!
        patchEnergy += (nodalEnergy[node]! / nodalWeight[node]!) * 0.25
      }
      if (
        Math.sqrt(patchEnergy) <=
        material.yieldStrain + material.hardening * accumulated
      )
        continue
      // Invalid/inverted cells were excluded before constructing the patch.
      const reg = regularization[tet]!
      const equivalent = equivalentStrain[tet]!
      const excess =
        equivalent - material.yieldStrain - material.hardening * accumulated
      if (excess <= 1e-8 || equivalent < 1e-10) continue
      const delta = Math.min(
        0.06,
        0.1 * reg,
        material.plasticLimit - accumulated,
        excess *
          (1 - Math.exp(-material.creepRate * Math.min(elapsedSeconds, 0.05))),
      )
      const fraction = delta / equivalent
      q.fill(0)
      for (let axis = 0; axis < 3; axis++) {
        const weight = Math.exp(-fraction * principalLogs[tet * 3 + axis]!)
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            q[row * 3 + col]! +=
              principalVectors[base + row * 3 + axis]! *
              weight *
              principalVectors[base + col * 3 + axis]!
      }
      next.fill(0)
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++)
          for (let k = 0; k < 3; k++)
            next[row * 3 + col]! +=
              state.gradients[base + row * 3 + k]! * q[k * 3 + col]!
      const correction = Math.cbrt(restDeterminants[tet]! / determinant(next))
      for (let i = 0; i < 9; i++)
        state.gradients[base + i] = next[i]! * correction
      state.equivalentPlasticStrain[tet] = accumulated + delta
      plasticIncrement[tet] = Math.max(
        0,
        state.equivalentPlasticStrain[tet]! - accumulated,
      )
      maxPlasticStrain = Math.max(maxPlasticStrain, accumulated + delta)
      changedTets++
    }
    return {
      state: copyJellyPlasticState(state),
      equivalentPlasticStrain: state.equivalentPlasticStrain.slice(),
      plasticIncrement,
      changedTets,
      maxPlasticStrain,
    }
  }

  function writeTets(target: Float32Array) {
    for (let tet = 0; tet < count; tet++) {
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++)
          target[tet * 16 + 4 + row * 4 + col] =
            state.gradients[tet * 9 + row * 3 + col]!
    }
  }
  return {
    update,
    restore,
    writeTets,
    snapshot: () => copyJellyPlasticState(state),
  }
}
