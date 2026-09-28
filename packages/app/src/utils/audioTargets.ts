// Flame writers for the audio mapping stage: resolves each FlameTarget in a
// flame the caller owns and writes the settled value, held to the domain
// the flame schema gives it. Never the open document.

import { projectFlameValue } from '@chaos-master/core'
import { resolveAudioMappingValues } from './audioMapping'
import type { AudioMappingEntry, AudioTargetValue, FlameTarget, FrameData, MappingSmoothingState, RenderSettingKey, TransformPropertyKey, TransformTarget, } from './audioMapping'

/**
 * A modulated render setting held to the domain the flame schema gives it.
 *
 * A mapping whose range exceeds the schema does not merely look wrong — a
 * flame carrying the result is INVALID, and `validateFlame` then throws for
 * everything downstream: breeding it, exporting it, opening the ancestry tree.
 * Observed in the wild as `palettePhase: Expected <=1 but received 1.589`,
 * back when modulation wrote the open document and left that flame unable to
 * be bred again. The live path is a render-time overlay now, but an export
 * still embeds the modulated flame in the file it writes, so an out-of-range
 * value would ship inside it.
 *
 * A range is authored by hand in the wiring editor and shipped in presets, so
 * neither can be trusted to respect a bound it never sees. The projection is
 * the schema's own (`projectFlameValue`), the one the timeline and the
 * commands use: skipIters floors as the renderer reads it, palettePhase wraps
 * as fract() reads it, and every other bound clamps.
 */
function heldRenderSetting(
  param: RenderSettingKey,
  value: number,
  dimensions: unknown,
): number {
  const path = param === 'zoom' ? ['camera', 'zoom'] : [param]
  // NaN would fail validation as surely as an out-of-range number, and can
  // arrive from a degenerate range. Its stand-in, 0, is projected like any
  // other value: it is below gamma's and contrast's minimum.
  return projectFlameValue(
    ['renderSettings', ...path],
    Number.isFinite(value) ? value : 0,
    dimensions,
  ) as number
}

interface AudioMutationContext {
  rs?: Record<string, unknown>
  camera?: Record<string, unknown>
  transforms?: Record<string, unknown>
  txArr?: unknown[]
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The transform a target names: by its key when the target carries one, by
 * its position in `flame`'s own transform order otherwise. A key the flame no
 * longer has names nothing, so wiring to a deleted transform goes inert
 * instead of landing on whichever transform took its place.
 */
function targetTransform(
  flame: object,
  target: TransformTarget,
  ctx: AudioMutationContext = {},
): Record<string, unknown> | undefined {
  ctx.transforms ??= asRecord((flame as Record<string, unknown>).transforms)
  const transforms = ctx.transforms
  if (!transforms) return undefined
  if (target.transformId !== undefined) {
    return Object.hasOwn(transforms, target.transformId)
      ? asRecord(transforms[target.transformId])
      : undefined
  }
  ctx.txArr ??= Object.values(transforms)
  return asRecord(ctx.txArr[target.transformIdx])
}

/**
 * The variation a weight target names: by its key when the target carries
 * one, else the transform's first variation of the target's type.
 */
function targetVariation(
  tx: Record<string, unknown> | undefined,
  target: Extract<FlameTarget, { kind: 'variationWeight' }>,
): Record<string, unknown> | undefined {
  const variations = asRecord(tx?.variations)
  if (!variations) return undefined
  if (target.variationId !== undefined) {
    return Object.hasOwn(variations, target.variationId)
      ? asRecord(variations[target.variationId])
      : undefined
  }
  // By type only. The key of `variations` is the variation's id: looked up by
  // the type's name, it found a variation whose id reads like another's type,
  // and for a type named after an Object member ('__proto__', 'constructor')
  // it wrote the weight onto the prototype chain of every object.
  return Object.values(variations)
    .map(asRecord)
    .find((candidate) => candidate?.type === target.variationType)
}

function readRenderSetting(
  flame: object,
  param: RenderSettingKey,
): number | undefined {
  const rs = asRecord((flame as Record<string, unknown>).renderSettings)
  return param === 'zoom'
    ? finiteNumber(asRecord(rs?.camera)?.zoom)
    : finiteNumber(rs?.[param])
}

function readTransformProperty(
  tx: Record<string, unknown> | undefined,
  property: TransformPropertyKey,
): number | undefined {
  if (property === 'colorX' || property === 'colorY') {
    return finiteNumber(
      asRecord(tx?.color)?.[property === 'colorX' ? 'x' : 'y'],
    )
  }
  return finiteNumber(tx?.[property])
}

/**
 * The value `target` has in `flame` before any modulation, or `undefined`
 * where the flame does not carry it. What the comfort governor starts a
 * target from, so turning audio on eases in from the authored picture.
 */
export function readTargetValue(
  flame: object,
  target: FlameTarget,
): number | undefined {
  switch (target.kind) {
    case 'renderSetting':
      return readRenderSetting(flame, target.param)
    case 'transformAffine': {
      const matrix = asRecord(targetTransform(flame, target)?.[target.matrix])
      return finiteNumber(matrix?.[target.param])
    }
    case 'transformProperty':
      return readTransformProperty(
        targetTransform(flame, target),
        target.property,
      )
    case 'variationWeight':
      return finiteNumber(
        targetVariation(targetTransform(flame, target), target)?.weight,
      )
    case 'finalAffine': {
      const final = asRecord((flame as Record<string, unknown>).finalTransform)
      return finiteNumber(final?.[target.param])
    }
  }
}

function applyRenderSettingTarget(
  flame: Record<string, unknown>,
  ctx: AudioMutationContext,
  tgt: Extract<FlameTarget, { kind: 'renderSetting' }>,
  val: number,
): void {
  ctx.rs ??= (flame.renderSettings as Record<string, unknown>) ?? {}
  const safe = heldRenderSetting(tgt.param, val, ctx.rs.dimensions)
  if (tgt.param === 'zoom') {
    ctx.camera ??= (ctx.rs.camera as Record<string, unknown>) ?? {}
    ;(ctx.camera as Record<string, number>).zoom = safe
  } else {
    ;(ctx.rs as Record<string, number>)[tgt.param] = safe
  }
}

function applyTransformAffineTarget(
  flame: Record<string, unknown>,
  ctx: AudioMutationContext,
  tgt: Extract<FlameTarget, { kind: 'transformAffine' }>,
  val: number,
): void {
  const tx = targetTransform(flame, tgt, ctx)
  if (!tx) return
  const mat = (tx[tgt.matrix] as Record<string, number> | undefined) ?? {}
  mat[tgt.param] = val
  tx[tgt.matrix] = mat
}

function applyTransformPropertyTarget(
  flame: Record<string, unknown>,
  ctx: AudioMutationContext,
  tgt: Extract<FlameTarget, { kind: 'transformProperty' }>,
  val: number,
): void {
  const tx = targetTransform(flame, tgt, ctx)
  if (!tx) return

  if (tgt.property === 'colorX' || tgt.property === 'colorY') {
    const color = (tx.color as Record<string, number>) ?? { x: 0, y: 0 }
    if (tgt.property === 'colorX') color.x = val
    else color.y = val
    tx.color = color
  } else if (tgt.property === 'probability') {
    /*
     * Never let a transform's weight reach zero.
     *
     * The chaos game picks transforms by probability; at zero a branch
     * stops receiving points and vanishes, and if every weight is driven
     * low together the whole picture thins out to noise — the "flame
     * collapsed and looks like nothing" people report mid-track. A
     * negative weight is worse: it makes the cumulative distribution
     * non-monotonic, so selection is meaningless.
     *
     * The schema itself only says `v.number()`, so nothing downstream
     * would have caught either.
     */
    ;(tx as Record<string, number>).probability = Math.max(
      0.001,
      Number.isFinite(val) ? val : 0.001,
    )
  } else {
    ;(tx as Record<string, number>)[tgt.property] = Number.isFinite(val)
      ? val
      : 0
  }
}

function applyVariationWeightTarget(
  flame: Record<string, unknown>,
  ctx: AudioMutationContext,
  tgt: Extract<FlameTarget, { kind: 'variationWeight' }>,
  val: number,
): void {
  const variation = targetVariation(targetTransform(flame, tgt, ctx), tgt)
  if (variation) variation.weight = val
}

function applyFinalAffineTarget(
  flame: Record<string, unknown>,
  tgt: Extract<FlameTarget, { kind: 'finalAffine' }>,
  val: number,
): void {
  const fin = (flame.finalTransform as Record<string, number> | undefined) ?? {}
  fin[tgt.param] = val
  flame.finalTransform = fin
}

function dispatchAudioTargetMapping(
  flame: Record<string, unknown>,
  ctx: AudioMutationContext,
  tgt: FlameTarget,
  val: number,
): void {
  switch (tgt.kind) {
    case 'renderSetting':
      applyRenderSettingTarget(flame, ctx, tgt, val)
      break
    case 'transformAffine':
      applyTransformAffineTarget(flame, ctx, tgt, val)
      break
    case 'transformProperty':
      applyTransformPropertyTarget(flame, ctx, tgt, val)
      break
    case 'variationWeight':
      applyVariationWeightTarget(flame, ctx, tgt, val)
      break
    case 'finalAffine':
      applyFinalAffineTarget(flame, tgt, val)
      break
  }
}

/**
 * Writes settled values into a flame — an export's per-frame clone, or the
 * live overlay's copy of the authored flame. Never the open document.
 */
export function applyAudioTargetValues(
  flame: Record<string, unknown>,
  values: readonly AudioTargetValue[],
): void {
  if (values.length === 0) return
  const ctx: AudioMutationContext = {}
  for (const { target, value } of values) {
    dispatchAudioTargetMapping(flame, ctx, target, value)
  }
  if (ctx.rs) {
    if (ctx.camera) ctx.rs.camera = ctx.camera
    flame.renderSettings = ctx.rs
  }
}

/**
 * Settles the mappings for one frame and writes them into `flame`.
 *
 * Targets can be render settings, transform affine coefficients, transform
 * scalar properties, variation weights, or final-transform affine params.
 *
 * Supports attack/release envelope smoothing via optional `attackMs` /
 * `releaseMs` on each mapping entry, and leaves the flame untouched when no
 * mapped value has moved beyond a tiny threshold.
 *
 * For callers that own the flame outright — the two export paths, each with a
 * per-frame clone. The live path settles and applies in two steps instead, so
 * no part of it can reach the open document.
 *
 * @param flame - a flame the caller owns, never the document.
 * @param smoothingState - persistent per-target state (smoothed value, last applied).
 * @param deltaTime - seconds since the previous frame (default 1/30).
 */
export function applyAudioMappingsToFlame(
  flame: Record<string, unknown>,
  frameData: FrameData & { isBeat: boolean },
  mappings: AudioMappingEntry[],
  smoothingState?: MappingSmoothingState,
  deltaTime?: number,
): void {
  if (mappings.length === 0) return
  const { values, changed } = resolveAudioMappingValues(
    frameData,
    mappings,
    smoothingState,
    deltaTime,
  )
  // Nothing moved: leave the flame exactly as it was. The offscreen and
  // main-canvas exports pass no smoothing state, so every frame is a change
  // for them and this only ever short-circuits a live caller.
  if (!changed) return
  applyAudioTargetValues(flame, values)
}
