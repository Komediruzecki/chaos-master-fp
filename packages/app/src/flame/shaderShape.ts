/**
 * What of a flame's transforms its compiled IFS shader bakes in: each
 * transform's id (a uniform struct member name) and each variation's id and
 * type. Probabilities, weights, affines and colours reach the shader through
 * uniform buffers and are left out, so a change to them never recompiles.
 *
 * The IFS pipelines key their shader cache on this and Flam3 rebuilds its
 * pipeline when it changes, so all of them read it from here. A Flame Clash
 * flame adds its team partition beside it (clashTeamsSignature).
 */
import { recordEntries } from '@/utils/record'
import type { TransformRecord } from './schema/flameSchema'

export function shaderShapeOf(transforms: TransformRecord) {
  return recordEntries(transforms).map(([tid, transform]) => ({
    tid,
    variations: recordEntries(transform.variations).map(([vid, v]) => ({
      vid,
      type: v.type,
    })),
  }))
}
