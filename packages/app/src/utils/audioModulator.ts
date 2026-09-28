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
   * is on screen. Home, it leaves the values but is still stepped there for
   * one comfort window, so one that returns inside that window is held to
   * the outputs its release showed. A departing target `baseline` no longer
   * carries leaves at once: there is nothing to bring it home to. No value
   * comes out that is not finite.
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

/**
 * The frame rate a file analyzer built for `requestedFps` runs at. A frame is
 * a whole number of samples, so 44.1 kHz asked for 24 fps runs at 24.0065
 * frames a second, and 48 kHz asked for 54 at 54.054. A stream over a file
 * steps every one of its frames: live one analyzer frame long each, and in
 * an export sharing the time of the output frame they fall in.
 */
export function analyzerFrameRate(
  sampleRate: number,
  requestedFps: number,
): number {
  return sampleRate / Math.floor(sampleRate / requestedFps)
}

/**
 * A target the previous step governed, and the dirty threshold of the
 * mapping that won it. `rested` is set once a departing target is home and
 * off the overlay: the seconds it has been stepped there since.
 */
type Governed = { target: FlameTarget; threshold: number; rested?: number }

/** How far apart two values of `target` are on screen: palettePhase wraps at 1. */
function apart(target: FlameTarget, a: number, b: number): number {
  const d = Math.abs(a - b)
  if (target.kind !== 'renderSetting' || target.param !== 'palettePhase') {
    return d
  }
  const turn = d % 1
  return Math.min(turn, 1 - turn)
}

/**
 * One frame of a target whose mapping has left: `shown` while it is still on
 * the overlay, `kept` while it is still governed, and `changed` when the
 * overlay changes for it.
 */
type Release = { shown?: number; kept?: Governed; changed: boolean }

export function createAudioModulator(preset: ComfortPreset): AudioModulator {
  const smoothing: MappingSmoothingState = new Map()
  const governor = createComfortGovernor(preset)
  let governed = new Map<string, Governed>()

  function forget(key: string): void {
    smoothing.delete(key)
    governor.forget(key)
  }

  /** Steps `departing` toward `home`, its value in the authored flame. */
  function release(
    key: string,
    departing: Governed,
    home: number | undefined,
    h: number,
  ): Release {
    const { target, threshold, rested } = departing
    if (home === undefined) {
      // Nowhere left to go: gone at once, from the overlay too.
      forget(key)
      return { changed: rested === undefined }
    }
    const value = governor.step(target, key, home, h)
    if (rested !== undefined) {
      // Home and off the overlay, it is stepped there until nothing it
      // showed on the way is left in its window. Forgotten on arrival, one
      // that came back inside the window started a fresh one, and could
      // swing a full range on top of the release.
      const now = rested + h
      if (now < (governor.window(target)?.seconds ?? 0)) {
        return { kept: { target, threshold, rested: now }, changed: false }
      }
      governor.forget(key)
      return { changed: false }
    }
    // A home the target cannot show, a probability authored under the
    // writer's floor or a value past the schema, is reached at the bound.
    if (apart(target, value, governor.reachable(target, home)) < threshold) {
      // Home: the overlay shows the flame's own value from the next publish
      // on, and a return starts a fresh envelope.
      smoothing.delete(key)
      if (governor.window(target)) {
        return { kept: { target, threshold, rested: 0 }, changed: true }
      }
      governor.forget(key)
      return { changed: true }
    }
    if (governor.window(target)?.range === 0) {
      // The preset holds this target still (Calm, zoom) and so can never
      // govern it home: it cuts to the flame's own value, and a return
      // starts over from there.
      forget(key)
      return { changed: true }
    }
    const lastOutput = smoothing.get(key)?.lastOutput
    return {
      shown: value,
      kept: departing,
      changed:
        lastOutput === undefined ||
        apart(target, value, lastOutput) >= threshold,
    }
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
        const { target } = departing
        const step = release(key, departing, authored(target), h)
        if (step.changed) changed = true
        if (step.shown !== undefined) values.push({ target, value: step.shown })
        if (step.kept) next.set(key, step.kept)
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
