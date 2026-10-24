// Retained Tideweave stage transforms follow earned notes without changing the trace judge.
import { mat4 } from 'wgpu-matrix'
import { BRIDGE_TARGET } from './encounter'
import { clamp, traceWorld, WORLD_PLACEMENTS } from './scene'
import type { ObservatoryFrame } from './scene'

/** A destination in the crossing view, using the exact same retained orb identity. */
export const TIDEWEAVE_STAGE_PLACEMENTS = {
  ...WORLD_PLACEMENTS,
  tideweave: {
    ...WORLD_PLACEMENTS.tideweave,
    center: [0, 2.15, -9.6] as const,
    scale: 0.95,
  },
}

const NOTE_COUNT = BRIDGE_TARGET.length
export const BRIDGE_SPAN_COUNT = 5
const stationary = () => ({
  matrix: mat4.identity(),
  tint: new Float32Array([1, 1, 1, 0]),
})

/** Four accepted notes reveal five physical modules, preserving the existing contract. */
export function earnedBridgeSpans(accepted: number, total = NOTE_COUNT) {
  if (!Number.isFinite(accepted) || !Number.isFinite(total) || total <= 0)
    return 0
  return clamp(accepted / total, 0, 1) * BRIDGE_SPAN_COUNT
}

/** Pausing or retrying must never leave an earned crossing suspended below its final pose. */
export function nextBridgeReveal(
  current: number,
  wanted: number,
  delta: number,
  motion: boolean,
) {
  if (!motion || wanted < current) return wanted
  return Math.min(wanted, current + clamp(delta, 0, 0.05) * 2.5)
}

export function createTideweavePresentation() {
  const stations = BRIDGE_TARGET.map((point) => {
    const anchor = [...traceWorld(point)]
    return {
      ...stationary(),
      anchor,
      // The point/ribbon remains in front of and above the small note instrument.
      position: [anchor[0], anchor[1] - 0.12, anchor[2] - 0.09],
    }
  })
  const spans = Array.from({ length: BRIDGE_SPAN_COUNT }, (_, index) => ({
    ...stationary(),
    z: -4.2 - index,
    reveal: 0,
  }))
  const bursts = new Float64Array(NOTE_COUNT).fill(-Infinity)
  const targets = BRIDGE_TARGET.map((point) => [...point])
  let acceptedBefore = 0
  let wasActive = false

  return {
    stations,
    spans,
    /** All matrices and tint arrays are reused; no GPU or geometry work occurs here. */
    update(frame: ObservatoryFrame, bridgeProgress: number) {
      const active = frame.view === 'trace'
      const accepted = Math.trunc(
        clamp(frame.trace.acceptedSegments, 0, NOTE_COUNT),
      )
      const time = Number.isFinite(frame.time) ? frame.time : 0
      const moving = frame.motion !== false
      let targetChanged = false
      stations.forEach((station, index) => {
        const point = frame.trace.target[index] ?? BRIDGE_TARGET[index]
        const previous = targets[index]
        if (point[0] === previous[0] && point[1] === previous[1]) return
        const anchor = traceWorld(point)
        previous[0] = point[0]
        previous[1] = point[1]
        for (let axis = 0; axis < 3; axis++) station.anchor[axis] = anchor[axis]
        station.position[0] = anchor[0]
        station.position[1] = anchor[1] - 0.12
        station.position[2] = anchor[2] - 0.09
        targetChanged = true
      })
      if (targetChanged || accepted < acceptedBefore || !active || !wasActive)
        bursts.fill(-Infinity)
      // Entering an existing partial attempt does not replay earned-note motion.
      if (active && wasActive && !targetChanged && accepted > acceptedBefore) {
        for (let index = acceptedBefore; index < accepted; index++)
          bursts[index] = time
      }
      stations.forEach((station, index) => {
        const earned = index < accepted
        const teaching =
          frame.trace.phase === 'demo' && frame.instructionNote === index
        const age = Math.max(0, time - bursts[index])
        const pulse =
          moving && earned && age < 0.8
            ? Math.sin((age / 0.8) * Math.PI) * (1 - age / 0.8)
            : 0
        mat4.translation(station.position, station.matrix)
        mat4.translate(station.matrix, [0, pulse * 0.025, 0], station.matrix)
        mat4.scale(station.matrix, [0.46, 0.46, 0.46], station.matrix)
        // Instruction remains readable when movement is paused; earned poses settle.
        station.tint.set(
          teaching
            ? [1, 0.88, 0.58, 0.55]
            : earned
              ? [0.65, 1, 0.93, 0.18 + pulse * 0.3]
              : [0.58, 0.76, 0.79, 0],
        )
      })
      spans.forEach((span, index) => {
        const progress = Number.isFinite(bridgeProgress) ? bridgeProgress : 0
        span.reveal = clamp(progress - index, 0, 1)
        mat4.translation([0, -0.42 * (1 - span.reveal), span.z], span.matrix)
        span.tint.set([
          0.7 + span.reveal * 0.3,
          0.84 + span.reveal * 0.16,
          1,
          (1 - span.reveal) * 0.16,
        ])
      })
      acceptedBefore = accepted
      wasActive = active
    },
  }
}
