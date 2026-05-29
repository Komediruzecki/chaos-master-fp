import type { Accessor, Setter } from 'solid-js'

export const DEFAULT_ANIMATION_DURATION_MS = 2000

export interface TourContext {
  setSidebarOpen: Setter<boolean>
  sidebarOpen: Accessor<boolean>
  setTimelineOpen: Setter<boolean>
  timelineOpen: Accessor<boolean>
  setAnimationEnabled: Setter<boolean>
  animationEnabled: Accessor<boolean>
  openModal: (name: 'loadFlame' | 'exportPng' | 'shareLink' | 'help') => void
  closeCurrentModal: () => void
  scrollToTarget: (selector: string) => void
  executeCommand: (id: string, ...args: unknown[]) => void
  animateValue: (
    start: number,
    end: number,
    durationMs: number,
    onUpdate: (value: number) => void,
  ) => void
}

export interface TourStep {
  /** CSS selector for the element to highlight */
  target: string
  title: string
  description: string
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  /** When true, picks the last visible match instead of the first.
   *  Useful for highlighting the most recently created transform. */
  targetLast?: boolean
  /** Called before the step is shown -- use to toggle modals, sidebar, etc. */
  beforeShow?: (ctx: TourContext) => void
  /** Called after the step is hidden */
  afterHide?: (ctx: TourContext) => void
}

export interface TourGuide {
  id: string
  name: string
  description: string
  steps: TourStep[]
  nextTourId?: string
  nextTourLabel?: string
  /** When true, the backdrop overlay uses a dark tint only (no blur).
   *  Useful for creation tours where the user needs to see the canvas clearly. */
  noBlur?: boolean
}
