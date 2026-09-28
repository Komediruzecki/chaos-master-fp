// The audio mapping stage: turns one analysed audio frame into settled
// target values (feature, envelope, dirty check) without touching a flame.
// Shared by the live overlay and both export paths; audioTargets.ts writes
// the values into a flame.

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

/** Encodes the exact target path in a FlameDescriptor to drive from audio. */
export type FlameTarget =
  | { kind: 'renderSetting'; param: RenderSettingKey }
  | {
      kind: 'transformAffine'
      transformIdx: number
      matrix: 'preAffine' | 'postAffine'
      param: AffineKey
    }
  | {
      kind: 'transformProperty'
      transformIdx: number
      property: TransformPropertyKey
    }
  | {
      kind: 'variationWeight'
      transformIdx: number
      variationType: string
    }
  | { kind: 'finalAffine'; param: AffineKey }

/** Stable string key for dirty-check state (keyed by target identity). */
export function flameTargetKey(target: FlameTarget): string {
  switch (target.kind) {
    case 'renderSetting':
      return `render.${target.param}`
    case 'transformAffine':
      return `tx.${target.transformIdx}.${target.matrix}.${target.param}`
    case 'transformProperty':
      return `tx.${target.transformIdx}.prop.${target.property}`
    case 'variationWeight':
      return `tx.${target.transformIdx}.var.${target.variationType}.weight`
    case 'finalAffine':
      return `final.${target.param}`
  }
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

/** Per-mapping smoothing + dirty-check state, keyed by target identity. */
export type MappingSmoothingState = Map<
  string,
  { smoothed: number; lastApplied: number }
>

const DIRTY_THRESHOLD = 0.005 // 0.5% change threshold

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
  const attackMs = mapping.attackMs ?? 0
  const releaseMs = mapping.releaseMs ?? 0
  if (attackMs <= 0 && releaseMs <= 0) {
    return clamped
  }

  const prev = smoothingState?.get(targetKey)?.smoothed ?? clamped
  const rising = clamped > prev
  const tc =
    (rising
      ? (mapping.attackMs ?? mapping.releaseMs ?? 0)
      : (mapping.releaseMs ?? mapping.attackMs ?? 0)) / 1000
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
 * still — the smoothed value keeps creeping, the written one does not.
 */
function settleTargetValue(
  smoothed: number,
  targetKey: string,
  smoothingState: MappingSmoothingState | undefined,
): { applied: number; changed: boolean } {
  const prevApplied = smoothingState?.get(targetKey)?.lastApplied
  if (
    prevApplied !== undefined &&
    Math.abs(smoothed - prevApplied) < DIRTY_THRESHOLD
  ) {
    if (smoothingState) {
      smoothingState.set(targetKey, { smoothed, lastApplied: prevApplied })
    }
    return { applied: prevApplied, changed: false }
  }

  if (smoothingState) {
    smoothingState.set(targetKey, { smoothed, lastApplied: smoothed })
  }
  return { applied: smoothed, changed: true }
}

/** One mapping's settled value for one frame. */
export type AudioTargetValue = {
  target: FlameTarget
  value: number
}

/**
 * Settles every mapping for one audio frame, touching no flame at all.
 *
 * Split out of `applyAudioMappingsToFlame` for the live path, which no longer
 * writes the document: it hands these values to a render-time overlay that
 * rebuilds them onto a copy of the authored flame. The envelope state stays
 * here so it advances exactly once per audio frame — an overlay recomputed
 * because the user edited the flame mid-track must not age the envelopes a
 * second time.
 *
 * `changed` is false when every target held still, so the caller can drop the
 * frame instead of publishing one nothing would look different for.
 */
export function resolveAudioMappingValues(
  frameData: FrameData & { isBeat: boolean },
  mappings: AudioMappingEntry[],
  smoothingState?: MappingSmoothingState,
  deltaTime?: number,
): { values: AudioTargetValue[]; changed: boolean } {
  const dt = deltaTime ?? 1 / 30
  const values: AudioTargetValue[] = []
  let changed = false

  for (const mapping of mappings) {
    const raw = getAudioFeatureNormalized(frameData, mapping.audioFeature)
    const clamped = Math.max(0, Math.min(1, raw))
    const targetKey = flameTargetKey(mapping.target)

    const smoothed = computeSmoothedEnvelope(
      clamped,
      targetKey,
      mapping,
      smoothingState,
      dt,
    )
    const settled = settleTargetValue(smoothed, targetKey, smoothingState)
    if (settled.changed) changed = true
    values.push({
      target: mapping.target,
      value: mappingToVal(settled.applied, mapping),
    })
  }

  return { values, changed }
}
