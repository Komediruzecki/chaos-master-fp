/**
 * Deterministic finite samples of the pawn's native linear3D / blur3D IFS.
 * Independent walker components keep separate settled chains; their authored
 * masses allocate samples without composing maps from different components.
 * These are reusable local-space points, not a surface reconstruction.
 */
import { selectWalkGroup, selectWalkGroupTransform, walkGroupMasses, walkGroupProbability, walkGroupsOf, } from '@chaos-master/core'
import { createSeededRandomSource } from '../randomSource'
import type { WalkGroup } from '@chaos-master/core'
import type { Affine3, Vec3 } from '../clash/placement'
import type { RandomSource } from '../randomSource'
import type { FlameDescriptor, TransformFunction } from '../schema/flameSchema'

export type PawnCloud = {
  /** Packed xyzw, with w=1; suitable for a shared GPU vertex buffer. */
  points: Float32Array
  count: number
  bounds: { min: Vec3; max: Vec3 }
}

export type PawnCloudOptions = {
  count?: number
  seed?: number
  burnIn?: number
}

type CompiledMap = {
  pre: Affine3
  post: Affine3
  variations: { type: 'linear3D' | 'blur3D'; weight: number }[]
}

function integer(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`)
  return value
}

/** The same uniform unit-ball distribution as native blur3D, using a CPU seed. */
function unitBall(random: RandomSource): Vec3 {
  const y = random() * 2 - 1
  const angle = random() * 2 * Math.PI
  const radius = Math.cbrt(random())
  const ring = Math.sqrt(Math.max(0, 1 - y * y)) * radius
  return [Math.cos(angle) * ring, y * radius, Math.sin(angle) * ring]
}

function finiteAffine(affine: Affine3) {
  if (!Object.values(affine).every(Number.isFinite))
    throw new Error('Pawn sampling requires finite affine coefficients')
  return affine
}

/** Pawn descriptors carry the native rows (a b c|d), (e f g|h), (i j k|l). */
function affineOf(value: TransformFunction['preAffine'] | undefined): Affine3 {
  if (value !== undefined && !('g' in value))
    throw new Error('Pawn sampling requires native 3D affine matrices')
  const raw = Object.fromEntries(Object.entries(value ?? {}))
  return finiteAffine({
    a: raw.a ?? 1,
    b: raw.b ?? 0,
    c: raw.c ?? 0,
    d: raw.d ?? 0,
    e: raw.e ?? 0,
    f: raw.f ?? 1,
    g: raw.g ?? 0,
    h: raw.h ?? 0,
    i: raw.i ?? 0,
    j: raw.j ?? 0,
    k: raw.k ?? 1,
    l: raw.l ?? 0,
  })
}

function applyAffine(m: Affine3, [x, y, z]: Vec3): Vec3 {
  return [
    m.a * x + m.b * y + m.c * z + m.d,
    m.e * x + m.f * y + m.g * z + m.h,
    m.i * x + m.j * y + m.k * z + m.l,
  ]
}

function compileMap(transform: TransformFunction): CompiledMap {
  const variations: CompiledMap['variations'] = []
  for (const variation of Object.values(transform.variations)) {
    if (!variation.visible || variation.weight === 0) continue
    if (variation.type !== 'linear3D' && variation.type !== 'blur3D')
      throw new Error(`Unsupported pawn sampling variation: ${variation.type}`)
    if (!Number.isFinite(variation.weight))
      throw new Error('Pawn sampling requires finite variation weights')
    variations.push({ type: variation.type, weight: variation.weight })
  }
  return {
    pre: affineOf(transform.preAffine),
    post: affineOf(transform.postAffine),
    variations,
  }
}

function step(map: CompiledMap, point: Vec3, random: RandomSource): Vec3 {
  const pre = applyAffine(map.pre, point)
  const sum = [0, 0, 0]
  for (const variation of map.variations) {
    const position = variation.type === 'linear3D' ? pre : unitBall(random)
    for (let axis = 0; axis < 3; axis++)
      sum[axis] = sum[axis]! + position[axis]! * variation.weight
  }
  const result = applyAffine(map.post, [sum[0]!, sum[1]!, sum[2]!])
  if (!result.every(Number.isFinite))
    throw new Error('Pawn sampling produced a non-finite point')
  return result
}

/**
 * Bake once per recipe and reuse across board instances. Unsupported active
 * variations fail explicitly instead of silently changing the generated form.
 * The final affine affects plotted samples only, never the iterative chain.
 */
export function samplePawnCloud(
  flame: FlameDescriptor,
  options: PawnCloudOptions = {},
): PawnCloud {
  if (flame.renderSettings.dimensions !== 3)
    throw new Error('Pawn sampling requires a native 3D flame')
  if (flame.renderSettings.pointInitMode !== 'pointInitUnitBall')
    throw new Error('Pawn sampling supports pointInitUnitBall only')
  if (flame.layers?.some((layer) => layer.visible && layer.opacity > 0))
    throw new Error('Pawn sampling does not support additional flame layers')
  const count = integer(options.count ?? 24_000, 'count', 1, 120_000)
  const burnIn = integer(
    options.burnIn ?? flame.renderSettings.skipIters,
    'burnIn',
    0,
    4096,
  )
  const seed = integer(
    options.seed ?? 0x7061776e,
    'seed',
    -0x8000_0000,
    0xffff_ffff,
  )
  const random = createSeededRandomSource(seed)
  const grouped = walkGroupsOf(flame.transforms)
  const groups: WalkGroup[] = grouped.enabled
    ? grouped.groups
    : [{ name: undefined, ids: Object.keys(flame.transforms) }]
  const masses = walkGroupMasses({ enabled: true, groups }, flame.transforms)
  if (!masses.some((mass) => mass > 0))
    throw new Error('Pawn sampling requires a visible positive-probability map')
  const maps = new Map<string, CompiledMap>()
  const authoredTransforms = Object.fromEntries(
    Object.entries(flame.transforms),
  )
  const chains = groups.map((group) => {
    const transforms = Object.fromEntries(
      group.ids.map((id) => [id, authoredTransforms[id]!]),
    )
    for (const [id, transform] of Object.entries(transforms)) {
      if (walkGroupProbability(transform) > 0)
        maps.set(id, compileMap(transform))
    }
    let point = unitBall(random)
    const advance = () => {
      const id = selectWalkGroupTransform(group, transforms, random())
      if (id === undefined)
        throw new Error('Pawn walker component has no active maps')
      point = step(maps.get(id)!, point, random)
      return point
    }
    return {
      advance,
      burn: () => {
        for (let n = 0; n < burnIn; n++) advance()
      },
    }
  })
  for (let index = 0; index < chains.length; index++)
    if (masses[index]! > 0) chains[index]!.burn()

  const final = affineOf(flame.finalTransform)
  const points = new Float32Array(count * 4)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < count; index++) {
    const group = selectWalkGroup(masses, (index + 0.5) / count)!
    const point = applyAffine(final, chains[group]!.advance())
    for (let axis = 0; axis < 3; axis++) {
      const value = Math.fround(point[axis]!)
      if (!Number.isFinite(value))
        throw new Error('Pawn sample exceeds finite Float32 range')
      points[index * 4 + axis] = value
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
    points[index * 4 + 3] = 1
  }
  return {
    points,
    count,
    bounds: {
      min: [min[0]!, min[1]!, min[2]!],
      max: [max[0]!, max[1]!, max[2]!],
    },
  }
}
