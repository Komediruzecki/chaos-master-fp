// A bounded threshold masks scene cuts; the latest destination always owns arrival.
import type { ObservatoryView, WorldId } from './scene'

export interface PassagePlace {
  view: ObservatoryView
  worldId: WorldId
}
export const PASSAGE_DEPARTURE_MS = 180
export const PASSAGE_ARRIVAL_MS = 460
export const PASSAGE_DURATION_MS = PASSAGE_DEPARTURE_MS + PASSAGE_ARRIVAL_MS
const ease = (t: number) => t * t * (3 - 2 * t)
const same = (a: PassagePlace, b: PassagePlace) =>
  a.view === b.view && a.worldId === b.worldId

export class ScenePassage {
  private scene: PassagePlace
  private target: PassagePlace
  private phase: 'idle' | 'departing' | 'arriving' = 'idle'
  private startedAt = 0
  private departureMs = PASSAGE_DEPARTURE_MS
  private departureOpacity = 0

  constructor(initial: PassagePlace) {
    this.scene = { ...initial }
    this.target = { ...initial }
  }

  request(target: PassagePlace, now: number, animate: boolean) {
    this.advance(now)
    if (!animate) {
      this.target = { ...target }
      this.finish()
      return
    }
    if (same(target, this.target)) return
    // Selecting a different orb in the same wide terrace needs no scene cut.
    if (
      this.phase === 'idle' &&
      this.scene.view === 'overview' &&
      target.view === 'overview'
    ) {
      this.target = { ...target }
      this.finish()
      return
    }
    const opacity = this.read(now).opacity
    this.target = { ...target }
    this.departureOpacity = opacity
    this.departureMs = PASSAGE_DEPARTURE_MS * (1 - opacity)
    this.startedAt = now
    this.phase = 'departing'
  }

  advance(now: number) {
    if (
      this.phase === 'departing' &&
      now - this.startedAt >= this.departureMs
    ) {
      this.scene = { ...this.target }
      this.startedAt += this.departureMs
      this.phase = 'arriving'
    }
    if (this.phase === 'arriving' && now - this.startedAt >= PASSAGE_ARRIVAL_MS)
      this.finish()
  }

  finish() {
    this.scene = { ...this.target }
    this.phase = 'idle'
  }

  read(now: number) {
    const active = this.phase !== 'idle'
    const duration =
      this.phase === 'departing' ? this.departureMs : PASSAGE_ARRIVAL_MS
    const progress = active
      ? Math.max(0, Math.min(1, (now - this.startedAt) / Math.max(1, duration)))
      : 1
    const opacity =
      this.phase === 'departing'
        ? this.departureOpacity + (1 - this.departureOpacity) * ease(progress)
        : this.phase === 'arriving'
          ? 1 - ease(progress)
          : 0
    return {
      active,
      phase: this.phase,
      scene: { ...this.scene },
      target: { ...this.target },
      opacity,
      // A small forward settle belongs only to the covered arrival, never the instrument.
      arrival: this.phase === 'arriving' ? (1 - progress) ** 3 : 0,
      remainingMs:
        this.phase === 'departing'
          ? Math.max(0, this.departureMs - (now - this.startedAt)) +
            PASSAGE_ARRIVAL_MS
          : this.phase === 'arriving'
            ? Math.max(0, PASSAGE_ARRIVAL_MS - (now - this.startedAt))
            : 0,
    }
  }
}
export type PassageSnapshot = ReturnType<ScenePassage['read']>
