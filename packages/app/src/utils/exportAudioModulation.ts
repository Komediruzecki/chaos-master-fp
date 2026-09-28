// Audio modulation for an export: the live modulation step replayed frame by
// frame at the export's own frame rate from a fresh state, so an export shows
// the envelopes and comfort caps the preview showed.
import { createAudioModulator } from './audioModulator'
import type { AudioAnalyzer } from './audioAnalysis'
import type { AudioMappingEntry, AudioTargetValue } from './audioMapping'
import type { ComfortPreset } from '@/comfort/comfortPresets'

export type ExportAudioModulation = {
  /**
   * The values for output frame `outputFrame`, counted from the export's
   * first frame. Every frame up to it is stepped in order, so asking twice
   * for one frame (motion blur sub-frames) returns the same values, and
   * asking for an earlier frame replays from the start. `baseline` is the
   * flame as authored for that frame: the first frame eases in from it.
   */
  valuesAt(outputFrame: number, baseline?: object): AudioTargetValue[]
}

export function createExportAudioModulation(
  source: Pick<AudioAnalyzer, 'getFrameData' | 'totalFrames'>,
  mappings: readonly AudioMappingEntry[],
  fps: number,
  preset: ComfortPreset,
): ExportAudioModulation {
  const modulator = createAudioModulator(preset)
  const dt = 1 / fps
  let next = 0
  let latest: AudioTargetValue[] = []

  return {
    valuesAt(outputFrame, baseline) {
      const wanted = Math.max(0, Math.floor(outputFrame))
      if (wanted < next - 1) {
        modulator.reset()
        next = 0
      }
      while (next <= wanted) {
        // The track loops when the export outlasts it, as it does live.
        const audioFrame =
          source.totalFrames > 0 ? next % source.totalFrames : 0
        latest = modulator.step(
          source.getFrameData(audioFrame),
          mappings,
          dt,
          baseline,
        ).values
        next++
      }
      return latest
    },
  }
}
