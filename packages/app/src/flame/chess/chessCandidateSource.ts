/** Clone and place native source snapshots without loading the renderer or its UI registry. */
import { toAffine3D } from '../affine3D'
import { composeAffine, IDENTITY_AFFINE } from '../clash/placement'
import type { Affine3 } from '../clash/placement'
import type { FlameDescriptor } from '../schema/flameSchema'
import type { ChessCandidate } from './chessCandidate'

export const CHESS_CANDIDATE_JSON_LIMIT = 512 * 1024

/** Clone proxies/plain data without silently converting Infinity to null as JSON does. */
export function cloneChessCandidateData(
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
    ? value.map((item) =>
        cloneChessCandidateData(item, seen, depth + 1, budget),
      )
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (['__proto__', 'constructor', 'prototype'].includes(key))
            throw new Error('Chess source contains an unsafe property name.')
          return [key, cloneChessCandidateData(item, seen, depth + 1, budget)]
        }),
      )
  seen.delete(value)
  return output
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
  const flame = cloneChessCandidateData(
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
