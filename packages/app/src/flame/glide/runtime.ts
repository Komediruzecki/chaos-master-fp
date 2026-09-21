/**
 * The live driver — the only file in `flame/glide/` that knows about the app.
 *
 * Everything else here is pure and takes no dependency on Solid, the GPU or a
 * store. This file owns the clock: a requestAnimationFrame loop that samples a
 * plan and writes intermediates through the workspace's SILENT write path, the
 * same one the animation export already uses, so a glide never lands on the
 * undo stack and never reaches the session recorder.
 *
 * The shape follows what the prior art got right and nothing else: one call to
 * start, one boolean to observe, one call to abort. Callers never think about
 * frames.
 *
 * It is a factory rather than workspace code so the workspace's own file grows
 * by construct-and-provide and nothing more (HM1 in the plan) — and so the same
 * driver can be mounted from a hook in the fork's decomposed workspace.
 */

import { createSignal } from 'solid-js'
import { planGlide } from './plan'
import { resolveGlideQuality } from './quality'
import { sampleGlide } from './sample'
import { GLIDE_DEADLINE_SLACK_MS, isGlideRefusal } from './types'
import type { GlideOptions, GlideOutcome, GlidePlan, GlideQuality, GlideQualityPreference, } from './types'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * The global "animate changes" mode, off by default.
 *
 * Module state, like the recorder's own `isSessionRecording`: the commands, the
 * agent surface and the replay panel all have to read the same switch, and
 * threading it through every caller would be a prop drilled six levels for a
 * boolean.
 */
const [glideEnabled, setGlideEnabled] = createSignal(false)
export { glideEnabled, setGlideEnabled }

/** The quality-tier override. `auto` derives it from the quality preset. */
const [glideQualityPreference, setGlideQualityPreference] =
  createSignal<GlideQualityPreference>('auto')
export { glideQualityPreference, setGlideQualityPreference }

export type GlideRuntimeDeps = {
  readFlame: () => FlameDescriptor
  /** Replace the document WITHOUT recording history. */
  writeFlame: (flame: FlameDescriptor) => void
  /** The workspace's quality preset key, for `quality: 'auto'`. */
  qualityPreset?: () => string
  /** Told the tier while a glide runs, and `undefined` once it settles. */
  onQualityChange?: (quality: GlideQuality | undefined) => void
  now?: () => number
  requestFrame?: (callback: (time: number) => void) => number
  cancelFrame?: (handle: number) => void
}

export type GlideRuntime = {
  isGliding: () => boolean
  /** The tier a glide would run at right now, preference and preset resolved. */
  quality: () => GlideQuality
  /** The plan being played, for anything that wants to read its notes. */
  activePlan: () => GlidePlan | undefined
  activeQuality: () => GlideQuality | undefined
  /**
   * Settle whatever is in flight and hand back the flame the viewer could see
   * a moment ago.
   *
   * This is the retarget seam. A change arriving mid-glide must be applied to
   * the SETTLED document — applying it to a half-interpolated one would bake
   * an intermediate into the result — while the animation that follows should
   * start where the eye already is rather than jumping to the settle first.
   * Callers take the returned flame as the next glide's starting point.
   */
  settleForNextChange: () => FlameDescriptor | undefined
  /**
   * Animate from `from` to whatever is in the store right now.
   *
   * Always settles within the glide's own duration plus
   * `GLIDE_DEADLINE_SLACK_MS`, whatever the animation clock does, and the
   * outcome says which clock got it there.
   */
  glideFrom: (
    from: FlameDescriptor,
    options?: GlideOptions,
  ) => Promise<GlideOutcome | undefined>
  /** Animate from the store to `target`, landing exactly on `target`. */
  glideTo: (
    target: FlameDescriptor,
    options?: GlideOptions,
  ) => Promise<GlideOutcome | undefined>
  /** Stop and leave the document on the frame it reached. */
  cancel: () => void
  /** Stop and land on the settle now. */
  finish: () => void
  dispose: () => void
}

type ActiveGlide = {
  plan: GlidePlan
  startedAt: number
  resolve: (outcome: GlideOutcome | undefined) => void
}

export function createGlideRuntime(deps: GlideRuntimeDeps): GlideRuntime {
  const now = deps.now ?? (() => globalThis.performance.now())
  const requestFrame =
    deps.requestFrame ??
    ((callback) => globalThis.requestAnimationFrame(callback))
  const cancelFrame =
    deps.cancelFrame ??
    ((handle) => {
      cancelAnimationFrame(handle)
    })

  const [active, setActive] = createSignal<ActiveGlide | undefined>()
  let frameHandle: number | undefined
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined

  function stopClock() {
    if (frameHandle !== undefined) cancelFrame(frameHandle)
    frameHandle = undefined
    if (deadlineHandle !== undefined) clearTimeout(deadlineHandle)
    deadlineHandle = undefined
  }

  function release(landOnSettle: boolean, completedByDeadline = false) {
    const current = active()
    stopClock()
    setActive(undefined)
    deps.onQualityChange?.(undefined)
    if (!current) return
    if (landOnSettle) deps.writeFlame(current.plan.settle)
    current.resolve({ plan: current.plan, completedByDeadline })
  }

  function tick() {
    const current = active()
    if (!current) return
    const elapsed = now() - current.startedAt
    const t =
      current.plan.durationMs <= 0 ? 1 : elapsed / current.plan.durationMs
    if (t >= 1) {
      // Always settle at full quality: the frame a viewer stops on must not be
      // the noisy one, in every tier.
      release(true)
      return
    }
    deps.writeFlame(sampleGlide(current.plan, t))
    frameHandle = requestFrame(tick)
  }

  function start(
    from: FlameDescriptor,
    to: FlameDescriptor,
    options: GlideOptions,
  ): Promise<GlideOutcome | undefined> {
    const planned = planGlide(from, to, {
      ...options,
      quality: options.quality ?? glideQualityPreference(),
      qualityPreset: options.qualityPreset ?? deps.qualityPreset?.(),
    })
    if (isGlideRefusal(planned)) {
      // A refusal is not a failure to change the document: the change still
      // happens, it just happens at once.
      deps.writeFlame(to)
      return Promise.resolve(undefined)
    }
    if (planned.durationMs <= 0 || planned.channels.length === 0) {
      deps.writeFlame(planned.settle)
      return Promise.resolve({ plan: planned, completedByDeadline: false })
    }
    return new Promise<GlideOutcome | undefined>((resolve) => {
      setActive({ plan: planned, startedAt: now(), resolve })
      deps.onQualityChange?.(planned.quality)
      deps.writeFlame(sampleGlide(planned, 0))
      frameHandle = requestFrame(tick)
      // The wall clock, which a hidden tab still runs. rAF is the animation
      // clock and Chrome simply stops calling it back when the tab is not
      // visible, so without this a glide — and any caller awaiting it — waits
      // for the viewer to come back to the tab. Landing on the settle is the
      // right answer there: the document must reach the state the change
      // asked for whether or not anyone watched it arrive.
      deadlineHandle = setTimeout(() => {
        deadlineHandle = undefined
        release(true, true)
      }, planned.durationMs + GLIDE_DEADLINE_SLACK_MS)
    })
  }

  return {
    isGliding: () => active() !== undefined,
    quality: () =>
      resolveGlideQuality(glideQualityPreference(), deps.qualityPreset?.()),
    activePlan: () => active()?.plan,
    activeQuality: () => active()?.plan.quality,
    settleForNextChange() {
      const current = active()
      if (!current) return undefined
      const visible = deps.readFlame()
      release(true)
      return visible
    },
    glideFrom(from, options = {}) {
      return start(from, deps.readFlame(), options)
    },
    glideTo(target, options = {}) {
      return start(deps.readFlame(), target, options)
    },
    cancel: () => {
      release(false)
    },
    finish: () => {
      release(true)
    },
    dispose: () => {
      release(false)
    },
  }
}

// ── The workspace's instance ────────────────────────────────────────────────
// One runtime per workspace, reached the way `getWebMcpContext` is: the agent
// surface, the replay player and the commands all need it, and none of them
// sits under the workspace in the component tree.

let current: GlideRuntime | undefined

export function setGlideRuntime(runtime: GlideRuntime | undefined): void {
  current = runtime
}

export function getGlideRuntime(): GlideRuntime | undefined {
  return current
}

/** The tier a caller would get right now, without planning anything. */
export function currentGlideQuality(qualityPreset?: string): GlideQuality {
  return resolveGlideQuality(glideQualityPreference(), qualityPreset)
}
