// The audio mapping stage: turns one analysed audio frame into settled
// target values (feature, envelope, dirty check) without touching a flame.
// Shared by the live overlay and both export paths; audioTargets.ts writes
// the values into a flame.

import { effectiveEnvelope } from './audioEnvelope'

export type FrameData = {
  bands: number[]
  rms: number
  centroid: number
  flatness: number
  onsetStrength: number
}

export type AudioFeature =
  | 'subBass'
  | 'bass'
  | 'lowMid'
  | 'mid'
  | 'hiMid'
  | 'presence'
  | 'brilliance'
  | 'fullSpectrum'
  | 'rms'
  | 'centroid'
  | 'flatness'
  | 'beat'
  | 'onset'

export type RenderSettingKey =
  | 'vibrancy'
  | 'exposure'
  | 'palettePhase'
  | 'paletteSpeed'
  | 'contrast'
  | 'gamma'
  | 'highlightPower'
  | 'lightPower'
  | 'depthColorPower'
  | 'zoom'
  | 'skipIters'

export type AffineKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

export type TransformPropertyKey =
  | 'probability'
  | 'colorX'
  | 'colorY'
  | 'colorSpeed'

/**
 * Encodes the exact target path in a FlameDescriptor to drive from audio. A
 * transform target names its transform by key (`transformId`) and a variation
 * weight its variation (`variationId`) when it carries them; the id wins over
 * the position. Wiring saved before targets carried ids has positions and
 * variation types only, and still resolves by them.
 */
export type FlameTarget =
  | { kind: 'renderSetting'; param: RenderSettingKey }
  | {
      kind: 'transformAffine'
      transformIdx: number
      transformId?: string
      matrix: 'preAffine' | 'postAffine'
      param: AffineKey
    }
  | {
      kind: 'transformProperty'
      transformIdx: number
      transformId?: string
      property: TransformPropertyKey
    }
  | {
      kind: 'variationWeight'
      transformIdx: number
      transformId?: string
      variationType: string
      variationId?: string
    }
  | { kind: 'finalAffine'; param: AffineKey }

/** The targets that live on one transform. */
export type TransformTarget = Extract<FlameTarget, { transformIdx: number }>

function transformPart(target: TransformTarget, byId: boolean): string {
  return byId && target.transformId !== undefined
    ? `@${target.transformId}`
    : `${target.transformIdx}`
}

function targetString(target: FlameTarget, byId: boolean): string {
  switch (target.kind) {
    case 'renderSetting':
      return `render.${target.param}`
    case 'transformAffine':
      return `tx.${transformPart(target, byId)}.${target.matrix}.${target.param}`
    case 'transformProperty':
      return `tx.${transformPart(target, byId)}.prop.${target.property}`
    case 'variationWeight': {
      const variation =
        byId && target.variationId !== undefined
          ? `@${target.variationId}`
          : target.variationType
      return `tx.${transformPart(target, byId)}.var.${variation}.weight`
    }
    case 'finalAffine':
      return `final.${target.param}`
  }
}

/**
 * Stable key for per-target state: smoothing, the comfort limiter and the
 * editor's wires. A target that carries ids is keyed by them, so two
 * variations of one type keep separate state and state follows a transform
 * that moves. A target without ids keeps the positional key it always had.
 */
export function flameTargetKey(target: FlameTarget): string {
  return targetString(target, true)
}

/**
 * Where a target sits, by position and variation type: the text the editor
 * shows. Not an identity, so never a key for state.
 */
export function flameTargetPath(target: FlameTarget): string {
  return targetString(target, false)
}

export type AudioMappingEntry = {
  audioFeature: AudioFeature
  target: FlameTarget
  sensitivity: number
  range: [number, number]
  attackMs?: number
  releaseMs?: number
}

/**
 * Lightweight transform info passed from MainWorkspace so the panel can
 * show per-transform dropdowns without carrying the full flame descriptor.
 */
export type TransformInfo = {
  id: string
  index: number
  label: string
  /** Available variation IDs and types for this transform (for pill picker). */
  variations: { id: string; type: string }[]
}

export function getAudioFeatureNormalized(
  frameData: FrameData & { isBeat: boolean },
  feature: AudioFeature,
): number {
  if (feature === 'beat') return frameData.isBeat ? 1 : 0
  if (feature === 'onset') return frameData.onsetStrength
  if (feature === 'rms') return Math.min(1, frameData.rms)
  if (feature === 'centroid') return Math.min(1, frameData.centroid / 20000)
  if (feature === 'flatness') return frameData.flatness
  const bandMap: Record<string, number> = {
    subBass: 0,
    bass: 1,
    lowMid: 2,
    mid: 3,
    hiMid: 4,
    presence: 5,
    brilliance: 6,
    fullSpectrum: 7,
  }
  const idx = bandMap[feature]
  if (idx !== undefined) return Math.min(1, frameData.bands[idx]!)
  return 0
}

function mappingToVal(
  normalizedValue: number,
  mapping: AudioMappingEntry,
): number {
  const [lo, hi] = mapping.range
  return lo + normalizedValue * mapping.sensitivity * (hi - lo)
}

/**
 * Per-mapping smoothing and dirty-check state, keyed by target identity.
 * `lastOutput` is the value last reported in a changed frame, after any
 * limiter.
 */
export type MappingSmoothingState = Map<
  string,
  { smoothed: number; lastApplied: number; lastOutput?: number }
>

/**
 * The smallest move of a target worth a new frame: 0.2% of the mapping's
 * output range, never below 1e-6. Relative, because one absolute step is a
 * visible jump on a zoom range of [1, 1.1] and noise on an exposure range of
 * [0, 10].
 */
export function dirtyThreshold(mapping: AudioMappingEntry): number {
  const [lo, hi] = mapping.range
  return Math.max(1e-6, 0.002 * Math.abs(hi - lo))
}

/** How far the mapped output moves when the settled feature goes `from` -> `to`. */
function outputDelta(
  mapping: AudioMappingEntry,
  from: number,
  to: number,
): number {
  const [lo, hi] = mapping.range
  return Math.abs((to - from) * mapping.sensitivity * (hi - lo))
}

/**
 * Holds one mapped value to what the screen may show this frame; the app's
 * comfort governor. Called once per target per frame, for the mapping that
 * wins the target (the last one naming it), and on every frame, because a
 * limiter still catching up moves while its input holds still.
 */
export type TargetLimiter = (
  target: FlameTarget,
  key: string,
  value: number,
) => number

/**
 * Calculates attack/release envelope smoothing for a normalized feature.
 */
function computeSmoothedEnvelope(
  clamped: number,
  targetKey: string,
  mapping: AudioMappingEntry,
  smoothingState: MappingSmoothingState | undefined,
  dt: number,
): number {
  const { attackMs, releaseMs } = effectiveEnvelope(mapping)
  if (attackMs <= 0 && releaseMs <= 0) {
    return clamped
  }

  const prev = smoothingState?.get(targetKey)?.smoothed ?? clamped
  const tc = (clamped > prev ? attackMs : releaseMs) / 1000
  if (tc <= 0) {
    return clamped
  }

  const coeff = dt / (tc + dt)
  return prev + coeff * (clamped - prev)
}

/**
 * Settles one target's value for this frame, and says whether it moved.
 *
 * Two answers, not one, because the overlay needs both. The value is written
 * EVERY frame: the overlay is rebuilt from the authored flame each time, so a
 * target left out snaps back to what the user authored and the picture
 * judders between modulated and unmodulated. `changed` is the separate
 * question of whether this frame is worth publishing at all.
 *
 * Holding `lastApplied` below the threshold is what keeps a still target
 * still — the smoothed value keeps creeping, the written one does not. The
 * threshold is measured on the output (`dirtyThreshold`), not on the
 * normalised feature.
 */
function settleTargetValue(
  smoothed: number,
  targetKey: string,
  mapping: AudioMappingEntry,
  smoothingState: MappingSmoothingState | undefined,
): { applied: number; changed: boolean } {
  const entry = smoothingState?.get(targetKey)
  if (
    entry !== undefined &&
    outputDelta(mapping, entry.lastApplied, smoothed) < dirtyThreshold(mapping)
  ) {
    entry.smoothed = smoothed
    return { applied: entry.lastApplied, changed: false }
  }

  if (entry) {
    entry.smoothed = smoothed
    entry.lastApplied = smoothed
  } else {
    smoothingState?.set(targetKey, { smoothed, lastApplied: smoothed })
  }
  return { applied: smoothed, changed: true }
}

/** Has a limited output moved a threshold since the last changed frame? */
function outputMoved(
  value: number,
  mapping: AudioMappingEntry,
  lastOutput: number | undefined,
): boolean {
  return (
    lastOutput === undefined ||
    Math.abs(value - lastOutput) >= dirtyThreshold(mapping)
  )
}

/** One mapping's settled value for one frame. */
export type AudioTargetValue = {
  target: FlameTarget
  value: number
}

/**
 * Settles every mapping for one audio frame, touching no flame at all.
 *
 * The mapping stage of the modulator (`createAudioModulator`), which the live
 * overlay and both exports share. It writes nothing: the values go to a
 * render-time overlay, or into an export's copy of the frame, both built on
 * the authored flame. The envelope state stays here so it advances exactly
 * once per audio frame — an overlay recomputed because the user edited the
 * flame mid-track must not age the envelopes a second time.
 *
 * `changed` is false when every target held still, so the caller can drop the
 * frame instead of publishing one nothing would look different for. With a
 * `limit`, a target also counts as moved while its limited output is still
 * travelling toward a value its input settled on earlier.
 */
export function resolveAudioMappingValues(
  frameData: FrameData & { isBeat: boolean },
  mappings: readonly AudioMappingEntry[],
  smoothingState?: MappingSmoothingState,
  deltaTime?: number,
  limit?: TargetLimiter,
): { values: AudioTargetValue[]; changed: boolean } {
  const dt = deltaTime ?? 1 / 30
  const keys = mappings.map((mapping) => flameTargetKey(mapping.target))
  // A target named twice is written twice and the last write wins, so only
  // the last mapping for a target is limited: limiting both would step the
  // limiter twice a frame.
  const winners = new Map<string, number>()
  keys.forEach((key, index) => {
    winners.set(key, index)
  })
  const values: AudioTargetValue[] = []
  let changed = false

  mappings.forEach((mapping, index) => {
    const targetKey = keys[index]!
    const raw = getAudioFeatureNormalized(frameData, mapping.audioFeature)
    // A non-finite feature (a bad analysis frame) reads as silence for this
    // frame only. Passing it through would write NaN into the smoothing
    // state below, and every later frame reads that back as `prev` — once in,
    // the mapping never recovers even after the feature is finite again.
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0

    const smoothed = computeSmoothedEnvelope(
      clamped,
      targetKey,
      mapping,
      smoothingState,
      dt,
    )
    const settled = settleTargetValue(
      smoothed,
      targetKey,
      mapping,
      smoothingState,
    )
    const mapped = mappingToVal(settled.applied, mapping)
    const wins = winners.get(targetKey) === index
    const value =
      limit && wins ? limit(mapping.target, targetKey, mapped) : mapped
    const lastOutput = smoothingState?.get(targetKey)?.lastOutput
    if (settled.changed || (wins && outputMoved(value, mapping, lastOutput))) {
      changed = true
    }
    values.push({ target: mapping.target, value })
  })

  if (changed && smoothingState) {
    values.forEach(({ value }, index) => {
      const entry = smoothingState.get(keys[index]!)
      if (entry) entry.lastOutput = value
    })
  }
  return { values, changed }
}
