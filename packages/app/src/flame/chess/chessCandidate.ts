/** Immutable native-flame snapshots and a separate, inspection-only chess placement. */
import { composeAffine, IDENTITY_AFFINE } from '../clash/placement'
import { flameComplexityError, MAX_FLAME_TRANSFORMS, MAX_FLAME_VARIATIONS, validateFlame, } from '../schema/flameSchema'
import { toAffine3D } from '../transformFunction3D'
import { collectFlameCustomVariations } from '../variations/custom/CustomVariationRegistry'
import { MAX_CUSTOM_WGSL_LENGTH } from '../variations/custom/runtimeCompiler'
import type { Affine3 } from '../clash/placement'
import type { FlameDescriptor, TransformFunction } from '../schema/flameSchema'
import type { CustomVariationDef } from '../variations/custom/types'

export type ChessCandidateRole =
  | 'pawn'
  | 'rook'
  | 'knight'
  | 'bishop'
  | 'queen'
  | 'king'
export type ChessCandidate = {
  format: 'chess-piece-candidate'
  version: 1
  id: string
  name: string
  role: ChessCandidateRole
  source: { flame: FlameDescriptor; customVariations: CustomVariationDef[] }
  placement: {
    /** Radians, applied about X, then Y, then Z in the source coordinate system. */
    rotation: [number, number, number]
    scale: number
    offset: [number, number, number]
  }
}

export const CHESS_CANDIDATE_JSON_LIMIT = 512 * 1024
export const CHESS_CANDIDATE_ROLES: readonly ChessCandidateRole[] = [
  'pawn',
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
]
const MAX_BLEND_DEPTH = 4
const MAX_LAYERS = 16
const MAX_CUSTOM_VARIATIONS = 32
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
type RecordValue = Record<string, unknown>

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`)
  return value as RecordValue
}

/** Clone proxies/plain data without silently converting Infinity to null as JSON does. */
function cloneData(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
  budget = { nodes: 0, text: 0 },
): unknown {
  if (++budget.nodes > 100_000 || depth > 64)
    throw new Error('This chess source is too complex to inspect.')
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Chess source settings must contain finite numbers.')
  if (typeof value === 'string') {
    budget.text += value.length
    if (budget.text > CHESS_CANDIDATE_JSON_LIMIT)
      throw new Error('This chess source is too large to inspect.')
  }
  if (
    value === null ||
    value === undefined ||
    ['string', 'number', 'boolean'].includes(typeof value)
  )
    return value
  if (typeof value !== 'object')
    throw new Error('Chess sources must contain plain data.')
  if (seen.has(value))
    throw new Error('Chess sources cannot contain circular references.')
  const prototype = Object.getPrototypeOf(value)
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new Error('Chess sources must contain plain objects.')
  seen.add(value)
  const output = Array.isArray(value)
    ? value.map((item) => cloneData(item, seen, depth + 1, budget))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (['__proto__', 'constructor', 'prototype'].includes(key))
            throw new Error('Chess source contains an unsafe property name.')
          return [key, cloneData(item, seen, depth + 1, budget)]
        }),
      )
  seen.delete(value)
  return output
}

function validateSource(value: unknown): FlameDescriptor {
  const budget = { transforms: 0, variations: 0 }
  const visit = (raw: unknown, depth: number): FlameDescriptor => {
    if (depth > MAX_BLEND_DEPTH)
      throw new Error('This chess source contains too many nested blends.')
    const data = record(raw, 'Chess source')
    const layers = data.layers
    if (
      layers !== undefined &&
      (!Array.isArray(layers) || layers.length > MAX_LAYERS)
    )
      throw new Error('A chess source can contain at most 16 layers.')
    const groups = [
      data.transforms,
      ...(Array.isArray(layers)
        ? layers.map((layer) => record(layer, 'Flame layer').transforms)
        : []),
    ]
    for (const transforms of groups) {
      const error = flameComplexityError({ transforms })
      if (error) throw new Error(error)
      const maps = record(transforms, 'Flame transforms')
      budget.transforms += Object.keys(maps).length
      for (const transform of Object.values(maps))
        budget.variations += Object.keys(
          record(
            record(transform, 'Flame transform').variations,
            'Flame variations',
          ),
        ).length
    }
    if (
      budget.transforms > MAX_FLAME_TRANSFORMS ||
      budget.variations > MAX_FLAME_VARIATIONS
    )
      throw new Error(
        'Combined chess source layers and blends exceed renderer limits.',
      )
    const flame = validateFlame(data)
    const blend = flame.renderSettings.blendFlame
    if (blend !== undefined)
      flame.renderSettings.blendFlame = visit(blend, depth + 1)
    return flame
  }
  return visit(cloneData(value), 0)
}

/** Visit all stored maps, including hidden layers and nested blends, without dropping source data. */
export function forEachChessCandidateTransform(
  flame: FlameDescriptor,
  visit: (transform: TransformFunction) => void,
): void {
  Object.values(flame.transforms).forEach(visit)
  for (const layer of flame.layers ?? [])
    Object.values(layer.transforms).forEach(visit)
  const blend = flame.renderSettings.blendFlame
  if (blend !== undefined)
    forEachChessCandidateTransform(blend as FlameDescriptor, visit)
}

function requiredCustomIds(flame: FlameDescriptor): Set<string> {
  const ids = new Set<string>()
  forEachChessCandidateTransform(flame, (transform) => {
    for (const variation of Object.values(transform.variations))
      if (variation.type.startsWith('custom_')) ids.add(variation.type)
  })
  return ids
}

function validateDefinitions(
  value: unknown,
  flame: FlameDescriptor,
): CustomVariationDef[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_VARIATIONS)
    throw new Error('A chess source can contain at most 32 custom variations.')
  const required = requiredCustomIds(flame)
  const seen = new Set<string>()
  const definitions = value.map((raw): CustomVariationDef => {
    const def = record(raw, 'Custom variation')
    if (
      typeof def.id !== 'string' ||
      !SAFE_ID.test(def.id) ||
      !def.id.startsWith('custom_') ||
      seen.has(def.id)
    )
      throw new Error(
        'Chess source custom variation IDs must be valid and unique.',
      )
    if (
      typeof def.name !== 'string' ||
      !def.name.trim() ||
      def.name.length > 256 ||
      typeof def.wgsl !== 'string' ||
      !def.wgsl.trim() ||
      def.wgsl.length > MAX_CUSTOM_WGSL_LENGTH
    )
      throw new Error(
        'Chess source contains an invalid custom variation definition.',
      )
    if (!required.has(def.id))
      throw new Error(`Custom variation ${def.id} is not used by this source.`)
    for (const key of ['createdAt', 'updatedAt'])
      if (
        typeof def[key] !== 'number' ||
        !Number.isSafeInteger(def[key]) ||
        def[key] < 0
      )
        throw new Error('Custom variation dates must be valid timestamps.')
    seen.add(def.id)
    return {
      id: def.id,
      name: def.name,
      wgsl: def.wgsl,
      createdAt: def.createdAt as number,
      updatedAt: def.updatedAt as number,
    }
  })
  const missing = [...required].filter((id) => !seen.has(id))
  if (missing.length)
    throw new Error(
      `This source is missing custom variations: ${missing.join(', ')}.`,
    )
  return definitions
}

function triple(
  value: unknown,
  label: string,
  max: number,
): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (item) =>
        typeof item === 'number' &&
        Number.isFinite(item) &&
        Math.abs(item) <= max,
    )
  )
    throw new Error(
      `${label} must contain three finite values between ${-max} and ${max}.`,
    )
  return [value[0] as number, value[1] as number, value[2] as number]
}

/** Validation returns new owned data; imports cannot mutate an editor draft or a saved candidate. */
export function validateChessCandidate(value: unknown): ChessCandidate {
  const data = record(value, 'Chess candidate')
  if (data.format !== 'chess-piece-candidate' || data.version !== 1)
    throw new Error('This chess candidate format or version is not supported.')
  if (typeof data.id !== 'string' || !SAFE_ID.test(data.id))
    throw new Error('This chess candidate has an invalid ID.')
  if (
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 64
  )
    throw new Error('Name this chess candidate using 1 to 64 characters.')
  const source = record(data.source, 'Chess source')
  const flame = validateSource(source.flame)
  const customVariations = validateDefinitions(
    cloneData(source.customVariations),
    flame,
  )
  const placement = record(data.placement, 'Chess placement')
  if (!CHESS_CANDIDATE_ROLES.includes(data.role as ChessCandidateRole))
    throw new Error('Choose a valid chess role.')
  if (
    typeof placement.scale !== 'number' ||
    !Number.isFinite(placement.scale) ||
    placement.scale < 0.01 ||
    placement.scale > 100
  )
    throw new Error('Inspection scale must be between 0.01 and 100.')
  const result: ChessCandidate = {
    format: 'chess-piece-candidate',
    version: 1,
    id: data.id,
    name: data.name,
    role: data.role as ChessCandidateRole,
    source: { flame, customVariations },
    placement: {
      rotation: triple(placement.rotation, 'Rotation', Math.PI * 2),
      scale: placement.scale,
      offset: triple(placement.offset, 'Offset', 100),
    },
  }
  if (JSON.stringify(result).length > CHESS_CANDIDATE_JSON_LIMIT)
    throw new Error('This chess candidate is too large to save.')
  return result
}

/** Capture definitions now, including transient shared ones, rather than referencing a mutable library later. */
export function createChessCandidate(
  flame: FlameDescriptor,
  name?: string,
): ChessCandidate {
  const source = validateSource(flame)
  const definitions = new Map<string, CustomVariationDef>()
  forEachChessCandidateTransform(source, (transform) => {
    const oneMap = {
      ...source,
      transforms: { candidate: transform },
    } as FlameDescriptor
    for (const def of collectFlameCustomVariations(oneMap))
      definitions.set(def.id, def)
  })
  return validateChessCandidate({
    format: 'chess-piece-candidate',
    version: 1,
    id: window.crypto.randomUUID(),
    name:
      name ?? (source.metadata.name.trim().slice(0, 64) || 'Chess candidate'),
    role: 'pawn',
    source: { flame: source, customVariations: [...definitions.values()] },
    placement: { rotation: [0, 0, 0], scale: 1, offset: [0, 0, 0] },
  })
}

export function serializeChessCandidate(candidate: ChessCandidate): string {
  const text = JSON.stringify(validateChessCandidate(candidate), null, 2)
  if (text.length > CHESS_CANDIDATE_JSON_LIMIT)
    throw new Error('This chess candidate file is too large.')
  return text
}

export function parseChessCandidate(text: string): ChessCandidate {
  if (text.length > CHESS_CANDIDATE_JSON_LIMIT)
    throw new Error('This chess candidate file is too large.')
  return validateChessCandidate(JSON.parse(text) as unknown)
}

/** Uniform scale, X then Y then Z rotation, followed by translation; all independent of the source IFS. */
export function chessCandidatePlacementAffine(
  placement: ChessCandidate['placement'],
): Affine3 {
  const [x, y, z] = placement.rotation
  const [sx, cx, sy, cy, sz, cz] = [
    Math.sin(x),
    Math.cos(x),
    Math.sin(y),
    Math.cos(y),
    Math.sin(z),
    Math.cos(z),
  ]
  const rotateX = { ...IDENTITY_AFFINE, f: cx, g: -sx, j: sx, k: cx }
  const rotateY = { ...IDENTITY_AFFINE, a: cy, c: sy, i: -sy, k: cy }
  const rotateZ = { ...IDENTITY_AFFINE, a: cz, b: -sz, e: sz, f: cz }
  const [d, h, l] = placement.offset
  return composeAffine(
    {
      ...IDENTITY_AFFINE,
      a: placement.scale,
      f: placement.scale,
      k: placement.scale,
      d,
      h,
      l,
    },
    composeAffine(rotateZ, composeAffine(rotateY, rotateX)),
  )
}

/** Place native 3D output after its authored final affine. Flat sources retain their exact 2D interpretation. */
export function candidateRenderFlame(
  candidate: ChessCandidate,
  sourceOverride?: FlameDescriptor,
): FlameDescriptor {
  const flame = cloneData(
    sourceOverride ?? candidate.source.flame,
  ) as FlameDescriptor
  const place = (source: FlameDescriptor) => {
    if (source.renderSettings.dimensions === 3)
      source.finalTransform = composeAffine(
        chessCandidatePlacementAffine(candidate.placement),
        toAffine3D(source.finalTransform),
      )
    const blend = source.renderSettings.blendFlame
    if (blend !== undefined) place(blend as FlameDescriptor)
  }
  place(flame)
  return flame
}
