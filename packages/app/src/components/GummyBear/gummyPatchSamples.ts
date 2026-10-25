/** Indexed barycentric grids preserve each patch triangle while sharing repeated samples. */
import { EXTERIOR_FACE } from '@/simulation/gummy/gummyMesh'

function grid(subdivisions: number, step = 1) {
  const samples: number[] = []
  const indices: number[] = []
  const at = (i: number, j: number) =>
    i * (subdivisions + 1) - (i * (i - 1)) / 2 + j
  for (let i = 0; i <= subdivisions; i++)
    for (let j = 0; j <= subdivisions - i; j++) {
      const v = i / subdivisions
      const w = j / subdivisions
      samples.push(1 - v - w, v, w)
    }
  for (let i = 0; i < subdivisions; i += step)
    for (let j = 0; j < subdivisions - i; j += step) {
      indices.push(at(i, j), at(i + step, j), at(i, j + step))
      if (i + j < subdivisions - step)
        indices.push(at(i + step, j), at(i + step, j + step), at(i, j + step))
    }
  return {
    samples: new Float32Array(samples),
    indices: new Uint32Array(indices),
  }
}

const linear = grid(1)
const smooth = grid(4)
const rounded = grid(8)
const roundedOriginal = grid(8, 2).indices

export function prepareGummyPatchSamples(
  surface: Uint32Array,
  metadata?: Uint32Array,
) {
  const faceCount = surface.length / 4
  const patchFor = (face: number) =>
    metadata?.[face * 4 + 2] === 2
      ? rounded
      : surface[face * 4 + 3] !== EXTERIOR_FACE && !metadata
        ? linear
        : smooth
  let sampleCount = 0
  let originalCount = 0
  let roundedCount = 0
  for (let face = 0; face < faceCount; face++) {
    const patch = patchFor(face)
    sampleCount += patch.samples.length / 3
    originalCount +=
      patch === rounded ? roundedOriginal.length : patch.indices.length
    roundedCount += patch.indices.length
  }
  const corners = new Float32Array(sampleCount * 4)
  const indices = new Uint32Array(originalCount)
  const roundedIndices =
    roundedCount === originalCount ? indices : new Uint32Array(roundedCount)
  let first = 0
  let originalOffset = 0
  let roundedOffset = 0
  for (let face = 0; face < faceCount; face++) {
    const patch = patchFor(face)
    const count = patch.samples.length / 3
    for (let sample = 0; sample < count; sample++) {
      const offset = (first + sample) * 4
      corners[offset] = patch.samples[sample * 3]!
      corners[offset + 1] = patch.samples[sample * 3 + 1]!
      corners[offset + 2] = patch.samples[sample * 3 + 2]!
      corners[offset + 3] = face
    }
    const original = patch === rounded ? roundedOriginal : patch.indices
    for (const index of original) indices[originalOffset++] = first + index
    if (roundedIndices !== indices)
      for (const index of patch.indices)
        roundedIndices[roundedOffset++] = first + index
    first += count
  }
  return { corners, indices, roundedIndices }
}
