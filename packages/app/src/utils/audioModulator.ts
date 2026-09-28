// One modulation stream's per-frame step: settles the audio mappings, then
// holds every target to the comfort caps. The live overlay and both export
// paths each own one, so a preview and an export of the same frames agree.
import { createComfortGovernor, MAX_STEP_SECONDS, } from '@/comfort/comfortGovernor'
import { dirtyThreshold, flameTargetKey, resolveAudioMappingValues, } from './audioMapping'
import { readTargetValue } from './audioTargets'
import type { AudioMappingEntry, AudioTargetValue, FlameTarget, FrameData, MappingSmoothingState, } from './audioMapping'
import type { ComfortPreset } from '@/comfort/comfortPresets'

export type AudioModulator = {
  /**
   * Settles `mappings` for one frame, `dt` seconds after the previous one.
   * `baseline` is the flame as authored: a target's first step eases in from
   * its value there instead of cutting to the mapped value.
   *
   * A target whose mapping leaves `mappings` stays in the values, governed
   * back to its value in `baseline`, until it is within its mapping's dirty
   * threshold of it; one that returns before then turns round from where it
   * is on screen. A departing target `baseline` no longer carries leaves at
   * once: there is nothing to bring it home to. No value comes out that is
   * not finite.
   */
  step(
    frame: FrameData & { isBeat: boolean },
    mappings: readonly AudioMappingEntry[],
    dt: number,
    baseline?: object,
  ): { values: AudioTargetValue[]; changed: boolean }
  /** Takes effect on the next step, from where every target is now. */
  setPreset(preset: ComfortPreset): void
  /** Forgets envelopes, the dirty check, the governor and departing targets. */
  reset(): void
}

/** A target the previous step governed, and the dirty threshold of the mapping that won it. */
type Governed = { target: FlameTarget; threshold: number }

/** How far apart two values of `target` are on screen: palettePhase wraps at 1. */
function apart(target: FlameTarget, a: number, b: number): number {
  const d = Math.abs(a - b)
  if (target.kind !== 'renderSetting' || target.param !== 'palettePhase') {
    return d
  }
  const turn = d % 1
  return Math.min(turn, 1 - turn)
}

export function createAudioModulator(preset: ComfortPreset): AudioModulator {
  const smoothing: MappingSmoothingState = new Map()
  const governor = createComfortGovernor(preset)
  let governed = new Map<string, Governed>()

  function forget(key: string): void {
    smoothing.delete(key)
    governor.forget(key)
  }

  return {
    step(frame, mappings, dt, baseline) {
      // One step length for the envelopes and the governor alike.
      const h = Math.min(
        MAX_STEP_SECONDS,
        Math.max(0, Number.isFinite(dt) ? dt : 0),
      )
      const authored = (target: FlameTarget) =>
        baseline === undefined ? undefined : readTargetValue(baseline, target)
      const resolved = resolveAudioMappingValues(
        frame,
        mappings,
        smoothing,
        h,
        (target, key, value) =>
          governor.step(target, key, value, h, () => authored(target)),
      )
      let changed = resolved.changed
      const values = resolved.values.filter(({ value }) =>
        Number.isFinite(value),
      )

      // The last mapping naming a target wins it, as in the values.
      const next = new Map<string, Governed>()
      for (const mapping of mappings) {
        next.set(flameTargetKey(mapping.target), {
          target: mapping.target,
          threshold: dirtyThreshold(mapping),
        })
      }
      for (const [key, departing] of governed) {
        if (next.has(key)) continue
        const { target, threshold } = departing
        const home = authored(target)
        const value =
          home === undefined ? undefined : governor.step(target, key, home, h)
        if (
          home === undefined ||
          value === undefined ||
          apart(target, value, home) < threshold
        ) {
          // Home, or nowhere left to go: the overlay shows the flame's own
          // value from the next publish on.
          forget(key)
          changed = true
          continue
        }
        const lastOutput = smoothing.get(key)?.lastOutput
        if (
          lastOutput === undefined ||
          apart(target, value, lastOutput) >= threshold
        ) {
          changed = true
        }
        values.push({ target, value })
        next.set(key, departing)
      }
      governed = next

      if (changed) {
        for (const { target, value } of values) {
          const entry = smoothing.get(flameTargetKey(target))
          if (entry) entry.lastOutput = value
        }
      }
      return { values, changed }
    },
    setPreset(preset) {
      governor.setPreset(preset)
    },
    reset() {
      smoothing.clear()
      governor.reset()
      governed = new Map()
    },
  }
}
