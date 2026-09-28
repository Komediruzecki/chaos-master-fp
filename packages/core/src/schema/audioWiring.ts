import * as v from 'valibot'
import { processValibotErrors } from '../utils/prettyPrintValibotErrors'
import { isSafeFlameEntityId } from './flameSchema'

/**
 * Validated shape of the audio-reactive wiring.
 */
export const AudioFeature = v.picklist([
  'subBass',
  'bass',
  'lowMid',
  'mid',
  'hiMid',
  'presence',
  'brilliance',
  'fullSpectrum',
  'rms',
  'centroid',
  'flatness',
  'beat',
  'onset',
])

export const RenderSettingKey = v.picklist([
  'vibrancy',
  'exposure',
  'palettePhase',
  'paletteSpeed',
  'contrast',
  'gamma',
  'highlightPower',
  'lightPower',
  'depthColorPower',
  'zoom',
  'skipIters',
])

export const AffineKey = v.picklist(['a', 'b', 'c', 'd', 'e', 'f'])

export const TransformPropertyKey = v.picklist([
  'probability',
  'colorX',
  'colorY',
  'colorSpeed',
])

const TransformIndex = v.pipe(v.number(), v.integer(), v.minValue(0))

/**
 * A transform or variation named by its key in the flame, so a target keeps
 * pointing at the same thing when transforms are reordered or deleted. Always
 * optional: wiring saved before targets carried ids names them by position
 * (`transformIdx`) and variation type only, and still loads.
 */
const EntityId = v.optional(
  v.pipe(
    v.string(),
    v.check((id) => isSafeFlameEntityId(id), 'Expected a flame entity id'),
  ),
)

export const FlameTarget = v.variant('kind', [
  v.object({ kind: v.literal('renderSetting'), param: RenderSettingKey }),
  v.object({
    kind: v.literal('transformAffine'),
    transformIdx: TransformIndex,
    transformId: EntityId,
    matrix: v.picklist(['preAffine', 'postAffine']),
    param: AffineKey,
  }),
  v.object({
    kind: v.literal('transformProperty'),
    transformIdx: TransformIndex,
    transformId: EntityId,
    property: TransformPropertyKey,
  }),
  v.object({
    kind: v.literal('variationWeight'),
    transformIdx: TransformIndex,
    transformId: EntityId,
    variationType: v.string(),
    variationId: EntityId,
  }),
  v.object({ kind: v.literal('finalAffine'), param: AffineKey }),
])

export const AudioMappingEntry = v.object({
  audioFeature: AudioFeature,
  target: FlameTarget,
  sensitivity: v.pipe(v.number(), v.finite()),
  range: v.tuple([
    v.pipe(v.number(), v.finite()),
    v.pipe(v.number(), v.finite()),
  ]),
  attackMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  releaseMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
})

export const AudioPreset = v.picklist([
  'pulse',
  'bloom',
  'drift',
  'structure',
  'morph',
  'swarm',
  'custom',
])

/** Every row of a wiring. One flame's wiring holds at most 512. */
export const AudioMappingEntries = v.pipe(
  v.array(AudioMappingEntry),
  v.maxLength(512),
)
export type AudioMappingEntries = v.InferOutput<typeof AudioMappingEntries>

export const AudioMapping = v.object({
  preset: AudioPreset,
  mappings: AudioMappingEntries,
})
export type AudioMapping = v.InferOutput<typeof AudioMapping>

/**
 * The rows of an imported wiring, or `undefined` with one complaint per
 * problem handed to `errorCallback`, each naming the row and field it is
 * about (`3.audioFeature: ...`). The check the commands and the flame apply,
 * so a wiring the editor accepts is one the workspace takes.
 */
export function validateAudioMappingEntriesWithErrors(
  data: unknown,
  errorCallback: (err: string) => void,
): AudioMappingEntries | undefined {
  const result = v.safeParse(AudioMappingEntries, data)
  if (result.success) return result.output
  processValibotErrors(v.flatten(result.issues), errorCallback)
  return undefined
}

export const AudioWiringSnapshot = v.object({
  mapping: AudioMapping,
  enabled: v.boolean(),
  source: v.picklist(['file', 'mic']),
  trackName: v.optional(v.string()),
})
export type AudioWiringSnapshot = v.InferOutput<typeof AudioWiringSnapshot>
