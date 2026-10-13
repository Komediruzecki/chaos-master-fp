/** Immutable native-flame snapshots and a separate, inspection-only chess placement. */
import { flameComplexityError, MAX_FLAME_TRANSFORMS, MAX_FLAME_VARIATIONS, validateFlame, } from '../schema/flameSchema'
import { collectFlameCustomVariations } from '../variations/custom/CustomVariationRegistry'
import { MAX_CUSTOM_WGSL_LENGTH } from '../variations/custom/runtimeCompiler'
import { validateChessCandidateSolid } from './chessCandidateSolid'
import { CHESS_CANDIDATE_JSON_LIMIT, cloneChessCandidateData, } from './chessCandidateSource'
import type { FlameDescriptor, TransformFunction } from '../schema/flameSchema'
import type { CustomVariationDef } from '../variations/custom/types'
import type { ChessCandidateSolid } from './chessCandidateSolid'

export {
  CHESS_CANDIDATE_SOLID_DEFAULT,
  CHESS_CANDIDATE_SOLID_MIN_THICKNESS,
  CHESS_CANDIDATE_SOLID_MAX_THICKNESS,
  CHESS_CANDIDATE_SOLID_SPACINGS,
} from './chessCandidateSolid'
export type { ChessCandidateSolid } from './chessCandidateSolid'
export {
  CHESS_CANDIDATE_JSON_LIMIT,
  candidateRenderFlame,
  chessCandidatePlacementAffine,
} from './chessCandidateSource'

export type ChessCandidateRole =
  | 'pawn'
  | 'rook'
  | 'knight'
  | 'bishop'
  | 'queen'
  | 'king'

export type ChessCandidate = {
  format: 'chess-piece-candidate'
  version: 1 | 2
  id: string
  name: string
  role: ChessCandidateRole
  source: { flame: FlameDescriptor; customVariations: CustomVariationDef[] }
  /** Only version 2 may carry a finite-solid request. Native source data stays unchanged. */
  solid?: ChessCandidateSolid
  placement: {
    /** Radians, applied about X, then Y, then Z in the source coordinate system. */
    rotation: [number, number, number]
    scale: number
    offset: [number, number, number]
  }
}

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
  return visit(cloneChessCandidateData(value), 0)
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
  if (
    data.format !== 'chess-piece-candidate' ||
    (data.version !== 1 && data.version !== 2)
  )
    throw new Error('This chess candidate format or version is not supported.')
  if (data.version === 1 && data.solid !== undefined)
    throw new Error('Finite solid settings require chess candidate version 2.')
  const solid =
    data.solid === undefined
      ? undefined
      : validateChessCandidateSolid(data.solid)
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
    cloneChessCandidateData(source.customVariations),
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
    version: data.version,
    id: data.id,
    name: data.name,
    role: data.role as ChessCandidateRole,
    source: { flame, customVariations },
    ...(solid === undefined ? {} : { solid }),
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
