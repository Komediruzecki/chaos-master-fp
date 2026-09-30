// Three bounded iterative specimens shared by CPU reference sampling and GPU generation.
import { d, std, tgpu } from 'typegpu'
import { sphere3D, swirl3D } from '@/flame/variations/simple3D'
import { VariationInfo3D } from '@/flame/variations/simple3D/types'
import { variationInfo } from '../../../typegpu-gl/src/variations'
import { advanceSeed } from '../flameMath'

export const SAMPLE_STEPS = 32
export const BURN_IN = 64
export const BENCH_SEED = 73129

export const BENCH_RECIPES = [
  {
    id: 'rosette',
    index: 0,
    name: 'Aureole',
    description:
      'Six curled petals, with smaller petals growing inside each one.',
    formula: 'Six contracting branches + swirl3D',
  },
  {
    id: 'branching',
    index: 1,
    name: 'Thicket',
    description:
      'A branching frond that turns its leaves into the third dimension.',
    formula: 'Four affine branches, adapted from the Barnsley fern',
  },
  {
    id: 'shell',
    index: 2,
    name: 'Vesper',
    description: 'Folded outer lobes shelter a smaller repeating shell.',
    formula: 'Octant folds + sphere3D + inner contraction',
  },
] as const

const info = tgpu.const(VariationInfo3D, variationInfo)

const rosetteStep = tgpu.fn(
  [d.vec3f, d.u32],
  d.vec3f,
)((point, choice) => {
  'use gpu'
  const p = swirl3D.fn(point, info.$).mul(0.48)
  // Tilt the copied structure before arranging its six children around the ring.
  const x = p.x * 0.83646265 + p.z * 0.54802394
  const z = -p.x * 0.54802394 + p.z * 0.83646265
  const angle = d.f32(choice) * 1.04719755
  const c = std.cos(angle)
  const s = std.sin(angle)
  return d.vec3f(
    x * c - p.y * s + c * 0.5,
    x * s + p.y * c + s * 0.5,
    z + std.cos(angle * 3) * 0.09,
  )
})

const branchStep = tgpu.fn(
  [d.vec3f, d.u32],
  d.vec3f,
)((point, choice) => {
  'use gpu'
  // Work in the familiar fern coordinates, then recenter its 0..10 height.
  const x = point.x * 5
  const y = (point.y + 1) * 5
  const z = point.z * 5
  let next = d.vec3f(0, 0.16 * y, 0.1 * z)
  if (choice >= 1 && choice <= 6) {
    next = d.vec3f(
      0.85 * x + 0.04 * y,
      -0.04 * x + 0.85 * y + 1.6,
      0.78 * z + 0.075 * x,
    )
  } else if (choice === 7 || choice === 8) {
    next = d.vec3f(
      0.2 * x - 0.26 * y,
      0.23 * x + 0.22 * y + 1.6,
      0.4 * z + 0.24 * y + 0.15 * x,
    )
  } else if (choice === 9) {
    next = d.vec3f(
      -0.15 * x + 0.28 * y,
      0.26 * x + 0.24 * y + 0.44,
      0.4 * z - 0.24 * y + 0.15 * x,
    )
  }
  return d.vec3f(next.x * 0.2, next.y * 0.2 - 1, next.z * 0.2)
})

const shellStep = tgpu.fn(
  [d.vec3f, d.u32],
  d.vec3f,
)((point, choice) => {
  'use gpu'
  if (choice >= 8) {
    // An inner copy stays part of the same attractor; it is not authored geometry.
    return d.vec3f(point.z, point.x, point.y).mul(0.47)
  }
  // Mix signed axes before folding. Folding first would collapse the attractor
  // into eight nearly identical radial spokes instead of a detailed surface.
  const tilted = d.vec3f(
    point.x * 0.76484219 - point.z * 0.64421769,
    point.y,
    point.x * 0.64421769 + point.z * 0.76484219,
  )
  const curled = swirl3D.fn(tilted, info.$)
  const folded = d.vec3f(
    std.abs(curled.y) * 0.55 + 0.24,
    std.abs(curled.z) * 0.55 + 0.24,
    std.abs(curled.x) * 0.55 + 0.24,
  )
  let sx = d.f32(-1)
  let sy = d.f32(-1)
  let sz = d.f32(-1)
  if ((choice & 1) !== 0) sx = d.f32(1)
  if ((choice & 2) !== 0) sy = d.f32(1)
  if ((choice & 4) !== 0) sz = d.f32(1)
  const q = d.vec3f(folded.x * sx, folded.y * sy, folded.z * sz)
  return sphere3D.fn(q, info.$).mul(0.68).add(q.mul(0.32))
})

/** A deliberately small recipe set, not arbitrary editor-flame compatibility. */
export const advanceSpecimen = tgpu.fn(
  [d.vec4f, d.u32, d.u32],
  d.vec4f,
)((point, seed, recipeIndex) => {
  'use gpu'
  let p = d.vec3f(point.xyz)
  let color = d.f32(0)
  if (recipeIndex === 0) {
    const choice = seed % 6
    p = rosetteStep(p, choice)
    color = d.f32(choice) / 5
  } else if (recipeIndex === 1) {
    const choice = seed % 10
    p = branchStep(p, choice)
    color = d.f32(choice) / 9
  } else {
    const choice = seed % 10
    p = shellStep(p, choice)
    color = d.f32(choice) / 9
  }
  return d.vec4f(p, point.w * 0.6 + color * 0.4)
})

/** Reference cloud with the same seed schedule and retained steps as the GPU. */
export function sampleSpecimen(
  recipeIndex: number,
  pointCount: number,
  seed = BENCH_SEED,
): Float32Array {
  if (
    !Number.isInteger(recipeIndex) ||
    recipeIndex < 0 ||
    recipeIndex >= BENCH_RECIPES.length
  )
    throw new RangeError('Unknown specimen recipe')
  if (
    !Number.isSafeInteger(pointCount) ||
    pointCount <= 0 ||
    pointCount % SAMPLE_STEPS !== 0
  )
    throw new RangeError('Point count must be a positive multiple of 32')
  if (
    !Number.isInteger(seed) ||
    seed <= 0 ||
    seed > 0xffffffff - pointCount / SAMPLE_STEPS
  )
    throw new RangeError(
      'Seed must keep every chain inside the nonzero u32 range',
    )
  const output = new Float32Array(pointCount * 4)
  for (let chain = 0; chain < pointCount / SAMPLE_STEPS; chain++) {
    let point = d.vec4f(0.17, -0.23, 0.31, 0)
    let chainSeed = seed + chain
    for (let step = -BURN_IN; step < SAMPLE_STEPS; step++) {
      chainSeed = advanceSeed(chainSeed)
      point = advanceSpecimen(point, chainSeed, recipeIndex)
      if (step >= 0)
        output.set(
          [point.x, point.y, point.z, point.w],
          (chain * SAMPLE_STEPS + step) * 4,
        )
    }
  }
  return output
}
