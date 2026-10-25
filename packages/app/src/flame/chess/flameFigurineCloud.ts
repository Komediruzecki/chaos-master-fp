/**
 * Finite coloured samples of the nonlinear figurine studies' native 3D maps.
 * Geometry and structural OkLab recurrence follow the IFS pipeline; exported
 * linear RGB uses an explicit fixed lightness, not view-dependent GPU grading.
 */
import { selectWalkGroup, selectWalkGroupTransform, transformAffine3D, walkGroupMasses, walkGroupProbability, walkGroupsOf, } from '@chaos-master/core'
import { oklabToLinearRgb } from '@typegpu/color'
import { vec3f } from 'typegpu/data'
import { clashTeamsOf } from '../clashTeams'
import { createSeededRandomSource } from '../randomSource'
import type { AffineParams3D, WalkGroup } from '@chaos-master/core'
import type { Vec3 } from '../clash/placement'
import type { RandomSource } from '../randomSource'
import type { FlameDescriptor, TransformFunction } from '../schema/flameSchema'

type Colour = readonly [number, number]
type NativeVariation = 'linear3D' | 'sinusoidal3D' | 'swirl3D' | 'curl3D'
type CompiledMap = {
  pre: AffineParams3D
  post: AffineParams3D
  variations: { type: NativeVariation; weight: number }[]
  colour: Colour
  colourSpeed: number
}

export const FLAME_FIGURINE_EXPORT_LIGHTNESS = 0.78
const CURL_EPSILON = 0.000001 // flame/constants.ts EPS, used by native curl3D.
const SUPPORTED = new Set<string>([
  'linear3D',
  'sinusoidal3D',
  'swirl3D',
  'curl3D',
])

export type FlameFigurineCloud = {
  points: Float32Array // Packed xyzw, w=1.
  colors: Float32Array // Linear RGBA COLOR_0, alpha=1.
  colorCoordinates: Float32Array // Native structural OkLab a/b before vibrancy.
  componentIds: Uint16Array
  components: (string | undefined)[]
  count: number
  bounds: { min: Vec3; max: Vec3 }
}
export type FlameFigurineCloudOptions = {
  count?: number
  seed?: number
  burnIn?: number
  lightness?: number
}

function integer(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`)
  return value
}

function finite(value: number, name: string) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function affineOf(
  raw: TransformFunction['preAffine'] | undefined,
): AffineParams3D {
  if (raw !== undefined && !('g' in raw))
    throw new Error(
      'Flame figurine sampling requires native 3D affine matrices',
    )
  const values = Object.fromEntries(Object.entries(raw ?? {}))
  const result = {
    a: values.a ?? 1,
    b: values.b ?? 0,
    c: values.c ?? 0,
    d: values.d ?? 0,
    e: values.e ?? 0,
    f: values.f ?? 1,
    g: values.g ?? 0,
    h: values.h ?? 0,
    i: values.i ?? 0,
    j: values.j ?? 0,
    k: values.k ?? 1,
    l: values.l ?? 0,
  }
  for (const value of Object.values(result)) finite(value, 'Affine coefficient')
  return result
}

function apply(m: AffineParams3D, point: Vec3): Vec3 {
  const result = transformAffine3D(m, vec3f(...point))
  return [result.x, result.y, result.z]
}

function compile(transform: TransformFunction): CompiledMap {
  if (transform.from2D)
    throw new Error('Flame figurine sampling does not lift 2D maps')
  const variations: CompiledMap['variations'] = []
  for (const variation of Object.values(transform.variations)) {
    if (!variation.visible || variation.weight === 0) continue
    if (!SUPPORTED.has(variation.type))
      throw new Error(`Unsupported flame figurine variation: ${variation.type}`)
    variations.push({
      type: variation.type as NativeVariation,
      weight: finite(variation.weight, 'Variation weight'),
    })
  }
  return {
    pre: affineOf(transform.preAffine),
    post: affineOf(transform.postAffine),
    variations,
    colour: [
      finite(transform.color.x, 'Colour a'),
      finite(transform.color.y, 'Colour b'),
    ],
    colourSpeed: finite(transform.colorSpeed ?? 0.4, 'Colour speed'),
  }
}

/** Same formulas as variations/simple3D; weights are applied once, externally. */
function variation(type: NativeVariation, [x, y, z]: Vec3): Vec3 {
  if (type === 'linear3D') return [x, y, z]
  if (type === 'sinusoidal3D') return [Math.sin(x), Math.sin(y), Math.sin(z)]
  if (type === 'swirl3D') {
    const r2 = x * x + y * y + z * z
    return [
      x * Math.cos(r2) - y * Math.sin(r2),
      x * Math.sin(r2) + y * Math.cos(r2),
      z,
    ]
  }
  const t1 = 1 + x
  const t2 = y * y + z * z
  const denominator = t1 * t1 + t2 + CURL_EPSILON
  return [
    (t1 * t1 - t2) / denominator,
    (2 * y * t1) / denominator,
    (2 * z * t1) / denominator,
  ]
}

function advance(map: CompiledMap, point: Vec3, colour: Colour) {
  const pre = apply(map.pre, point)
  const sum: [number, number, number] = [0, 0, 0]
  for (const entry of map.variations) {
    const position = variation(entry.type, pre)
    for (let axis = 0; axis < 3; axis++)
      sum[axis] = sum[axis]! + entry.weight * position[axis]!
  }
  const position = apply(map.post, sum)
  const nextColour: Colour = [
    colour[0] * (1 - map.colourSpeed) + map.colour[0] * map.colourSpeed,
    colour[1] * (1 - map.colourSpeed) + map.colour[1] * map.colourSpeed,
  ]
  for (const value of [...position, ...nextColour])
    finite(value, 'Flame sample')
  return { position, colour: nextColour }
}

/** A single native map step, useful for independent numerical fixtures. */
export function evaluateFlameFigurineTransform(
  transform: TransformFunction,
  point: Vec3,
  colour: Colour = [0, 0],
) {
  return advance(compile(transform), point, colour)
}

/** Structural colour at a documented fixed L; clamp out-of-gamut linear channels. */
export function flameFigurineLinearColour(
  colour: Colour,
  lightness = FLAME_FIGURINE_EXPORT_LIGHTNESS,
  vibrancy = 1,
): readonly [number, number, number, number] {
  finite(lightness, 'Lightness')
  finite(vibrancy, 'Vibrancy')
  const rgb = oklabToLinearRgb(
    vec3f(
      lightness,
      colour[0] * Math.max(0, vibrancy),
      colour[1] * Math.max(0, vibrancy),
    ),
  )
  const clamp = (value: number) =>
    Math.min(1, Math.max(0, finite(value, 'Linear colour')))
  return [clamp(rgb.x), clamp(rgb.y), clamp(rgb.z), 1]
}

function unitBall(random: RandomSource): Vec3 {
  const y = random() * 2 - 1
  const angle = random() * 2 * Math.PI
  const radius = Math.cbrt(random())
  const ring = Math.sqrt(Math.max(0, 1 - y * y)) * radius
  return [Math.cos(angle) * ring, y * radius, Math.sin(angle) * ring]
}

function supportedSettings(flame: FlameDescriptor) {
  const settings = flame.renderSettings
  if (
    settings.dimensions !== 3 ||
    settings.pointInitMode !== 'pointInitUnitBall'
  )
    throw new Error(
      'Flame figurine sampling requires native 3D unit-ball initialization',
    )
  if (clashTeamsOf(flame.transforms).enabled)
    throw new Error(
      'Flame figurine sampling does not support Clash team walkers',
    )
  if (
    flame.layers?.some((layer) => layer.visible && layer.opacity > 0) ||
    settings.blendFlame
  )
    throw new Error(
      'Flame figurine sampling does not support additional layers or blends',
    )
  if (settings.palette)
    throw new Error(
      'Density-based palettes cannot be baked as structural point colour',
    )
  if (
    settings.colorInitMode !== 'colorInitZero' &&
    settings.colorInitMode !== 'colorInitPosition'
  )
    throw new Error(
      `Unsupported colour initialization: ${settings.colorInitMode}`,
    )
  return settings
}

/** Separate settled chains per fixed component; final affine never feeds back. */
export function sampleFlameFigurineCloud(
  flame: FlameDescriptor,
  options: FlameFigurineCloudOptions = {},
): FlameFigurineCloud {
  const settings = supportedSettings(flame)
  const count = integer(options.count ?? 48_000, 'count', 1, 200_000)
  const burnIn = integer(
    options.burnIn ?? settings.skipIters,
    'burnIn',
    0,
    4096,
  )
  const seed = integer(
    options.seed ?? 0x666c616d,
    'seed',
    -0x8000_0000,
    0xffff_ffff,
  )
  const lightness = finite(
    options.lightness ?? FLAME_FIGURINE_EXPORT_LIGHTNESS,
    'Lightness',
  )
  if (lightness < 0 || lightness > 1)
    throw new RangeError('Lightness must be between zero and one')
  const vibrancy = finite(settings.vibrancy, 'Vibrancy')
  const random = createSeededRandomSource(seed)
  const grouped = walkGroupsOf(flame.transforms)
  const groups: WalkGroup[] = grouped.enabled
    ? grouped.groups
    : [{ name: undefined, ids: Object.keys(flame.transforms) }]
  integer(groups.length, 'Component count', 1, 65536)
  const masses = walkGroupMasses({ enabled: true, groups }, flame.transforms)
  if (!masses.some((mass) => mass > 0))
    throw new Error('Flame figurine needs positive visible map mass')
  const maps = new Map<string, CompiledMap>()
  const authored = Object.fromEntries(Object.entries(flame.transforms))
  const chains = groups.map((group) => {
    const transforms = Object.fromEntries(
      group.ids.map((id) => [id, authored[id]!]),
    )
    for (const [id, transform] of Object.entries(transforms))
      if (walkGroupProbability(transform) > 0) maps.set(id, compile(transform))
    let position = unitBall(random)
    let colour: Colour =
      settings.colorInitMode === 'colorInitPosition'
        ? [position[0], position[1]]
        : [0, 0]
    return () => {
      const id = selectWalkGroupTransform(group, transforms, random())
      if (id === undefined) throw new Error('Flame component has no active map')
      const result = advance(maps.get(id)!, position, colour)
      position = result.position
      colour = result.colour
      return result
    }
  })
  for (let group = 0; group < chains.length; group++)
    if (masses[group]! > 0) for (let n = 0; n < burnIn; n++) chains[group]!()
  const final = affineOf(flame.finalTransform)
  const points = new Float32Array(count * 4)
  const colors = new Float32Array(count * 4)
  const colorCoordinates = new Float32Array(count * 2)
  const componentIds = new Uint16Array(count)
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < count; index++) {
    const group = selectWalkGroup(masses, (index + 0.5) / count)!
    const result = chains[group]!()
    const position = apply(final, result.position)
    for (let axis = 0; axis < 3; axis++) {
      const value = finite(Math.fround(position[axis]!), 'Float32 sample')
      points[index * 4 + axis] = value
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
    points[index * 4 + 3] = 1
    colors.set(
      flameFigurineLinearColour(result.colour, lightness, vibrancy),
      index * 4,
    )
    colorCoordinates.set(
      result.colour.map((value) =>
        finite(Math.fround(value), 'Float32 colour coordinate'),
      ),
      index * 2,
    )
    componentIds[index] = group
  }
  return {
    points,
    colors,
    colorCoordinates,
    componentIds,
    components: groups.map((group) => group.name),
    count,
    bounds: {
      min: [min[0]!, min[1]!, min[2]!],
      max: [max[0]!, max[1]!, max[2]!],
    },
  }
}
