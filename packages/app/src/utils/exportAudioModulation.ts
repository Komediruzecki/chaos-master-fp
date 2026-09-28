// Audio modulation for an export: the live modulation step replayed over
// every analyzer frame from a fresh state, each output frame showing the
// analyzer frame of its own time, so an export shows the envelopes and
// comfort caps the preview showed.
import { analyzerFrameRate, createAudioModulator } from './audioModulator'
import { applyAudioTargetValues } from './audioTargets'
import type { AudioAnalyzer } from './audioAnalysis'
import type { AudioMappingEntry, AudioTargetValue } from './audioMapping'
import type { ComfortPreset } from '@/comfort/comfortPresets'

export type ExportAudioModulation = {
  /**
   * The values for output frame `outputFrame`, counted from the export's
   * first frame: those of the analyzer frame at its time. Every analyzer
   * frame up to that one is stepped in order, one analyzer frame long each,
   * as the live file path steps them, so no beat between two output frames
   * is lost. Asking twice for one frame (motion blur sub-frames) returns the
   * same values, and asking for an earlier frame replays from the start.
   * `baseline` is the flame as authored for that frame: the first frame
   * eases in from it.
   */
  valuesAt(outputFrame: number, baseline?: object): AudioTargetValue[]
  /**
   * Writes output frame `outputFrame`'s values into `flame`: the export's own
   * copy of that frame, timeline applied, which is also the baseline the
   * first frame eases in from. What both export paths call for every frame
   * and sub-frame.
   */
  applyTo(flame: Record<string, unknown>, outputFrame: number): void
}

/**
 * `source` is a file analyzer built for `fps`, the export's frame rate, as
 * both export paths build theirs.
 */
export function createExportAudioModulation(
  source: Pick<AudioAnalyzer, 'getFrameData' | 'totalFrames' | 'sampleRate'>,
  mappings: readonly AudioMappingEntry[],
  fps: number,
  preset: ComfortPreset,
): ExportAudioModulation {
  const modulator = createAudioModulator(preset)
  const analyzerFps = analyzerFrameRate(source.sampleRate, fps)
  const dt = 1 / analyzerFps
  /** The next analyzer frame to step, counted from the export's start. */
  let next = 0
  let latest: AudioTargetValue[] = []

  function valuesAt(outputFrame: number, baseline?: object) {
    const frame = Math.max(0, Math.floor(outputFrame))
    // By time: output frame n shows at n / fps, inside analyzer frame
    // floor(n / fps * analyzerFps). Multiplying first keeps a whole-frame
    // ratio exact.
    const wanted = Math.floor((frame * analyzerFps) / fps)
    if (wanted < next - 1) {
      modulator.reset()
      next = 0
    }
    while (next <= wanted) {
      // The track loops when the export outlasts it, as it does live.
      const audioFrame = source.totalFrames > 0 ? next % source.totalFrames : 0
      latest = modulator.step(
        source.getFrameData(audioFrame),
        mappings,
        dt,
        baseline,
      ).values
      next++
    }
    return latest
  }

  return {
    valuesAt,
    applyTo(flame, outputFrame) {
      applyAudioTargetValues(flame, valuesAt(outputFrame, flame))
    },
  }
}
