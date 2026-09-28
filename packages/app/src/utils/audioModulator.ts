// One modulation stream's per-frame step: settles the audio mappings, then
// holds every target to the comfort caps. The live overlay and both export
// paths each own one, so a preview and an export of the same frames agree.
import { createComfortGovernor } from '@/comfort/comfortGovernor'
import { resolveAudioMappingValues } from './audioMapping'
import { readTargetValue } from './audioTargets'
import type { AudioMappingEntry, AudioTargetValue, FrameData, MappingSmoothingState, } from './audioMapping'
import type { ComfortPreset } from '@/comfort/comfortPresets'

export type AudioModulator = {
  /**
   * Settles `mappings` for one frame, `dt` seconds after the previous one.
   * `baseline` is the flame as authored: a target's first step eases in from
   * its value there instead of cutting to the mapped value.
   */
  step(
    frame: FrameData & { isBeat: boolean },
    mappings: readonly AudioMappingEntry[],
    dt: number,
    baseline?: object,
  ): { values: AudioTargetValue[]; changed: boolean }
  /** Takes effect on the next step, from where every target is now. */
  setPreset(preset: ComfortPreset): void
  /** Forgets envelopes, the dirty check and the governor. */
  reset(): void
}

export function createAudioModulator(preset: ComfortPreset): AudioModulator {
  const smoothing: MappingSmoothingState = new Map()
  const governor = createComfortGovernor(preset)
  return {
    step(frame, mappings, dt, baseline) {
      return resolveAudioMappingValues(
        frame,
        mappings,
        smoothing,
        dt,
        (target, key, value) =>
          governor.step(
            target,
            key,
            value,
            dt,
            baseline === undefined
              ? undefined
              : () => readTargetValue(baseline, target),
          ),
      )
    },
    setPreset(next) {
      governor.setPreset(next)
    },
    reset() {
      smoothing.clear()
      governor.reset()
    },
  }
}
