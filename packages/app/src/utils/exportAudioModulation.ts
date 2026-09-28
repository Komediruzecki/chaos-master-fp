// Audio modulation for an export: the live modulation step replayed over
// every analyzer frame from a fresh state, each output frame showing the
// analyzer frame of its own time and governed on the video's clock, so an
// export shows the envelopes and comfort caps the preview showed.
import { analyzerFrameRate, createAudioModulator } from './audioModulator'
import { applyAudioTargetValues } from './audioTargets'
import type { AudioAnalyzer } from './audioAnalysis'
import type { AudioMappingEntry, AudioTargetValue } from './audioMapping'
import type { ComfortPreset } from '@/comfort/comfortPresets'

export type ExportAudioModulation = {
  /**
   * The values for output frame `outputFrame`, counted from the export's
   * first frame: those of the analyzer frame at its time. Every analyzer
   * frame up to that one is stepped in order, so no beat between two output
   * frames is lost, and the frames one output frame steps share its 1 / fps,
   * so governed time is the video's own. Asking twice for one frame (motion
   * blur sub-frames) returns the same values, and asking for an earlier frame
   * replays from the start. `baseline` is the flame as authored for that
   * frame: the first frame eases in from it.
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
  /** The last output frame stepped, -1 before the first. */
  let shown = -1
  /** The next analyzer frame to step, counted from the export's start. */
  let next = 0
  let latest: AudioTargetValue[] = []

  /** Steps the output frame after `shown`. */
  function stepOutputFrame(baseline?: object): void {
    shown++
    // By time: output frame n shows at n / fps, inside analyzer frame
    // floor(n / fps * analyzerFps). Multiplying first keeps a whole-frame
    // ratio exact. The analyzer runs at least as fast as the video, so every
    // output frame steps one analyzer frame or more, and one a float floor
    // lands a frame early still steps the next.
    const last = Math.max(next, Math.floor((shown * analyzerFps) / fps))
    // The frames an output frame steps share its 1 / fps. Stepped one
    // analyzer frame long each, governed time ran ahead of the video by a
    // frame now and then, and two output frames one window apart in the
    // video fell outside one comfort window.
    const dt = 1 / fps / (last - next + 1)
    for (; next <= last; next++) {
      // The track loops when the export outlasts it, as it does live.
      const audioFrame = source.totalFrames > 0 ? next % source.totalFrames : 0
      latest = modulator.step(
        source.getFrameData(audioFrame),
        mappings,
        dt,
        baseline,
      ).values
    }
  }

  function valuesAt(outputFrame: number, baseline?: object) {
    const frame = Math.max(0, Math.floor(outputFrame))
    if (frame < shown) {
      modulator.reset()
      shown = -1
      next = 0
    }
    while (shown < frame) stepOutputFrame(baseline)
    return latest
  }

  return {
    valuesAt,
    applyTo(flame, outputFrame) {
      applyAudioTargetValues(flame, valuesAt(outputFrame, flame))
    },
  }
}
