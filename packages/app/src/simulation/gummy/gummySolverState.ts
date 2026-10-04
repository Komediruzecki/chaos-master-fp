/** Exact live-state transfer for topology rebuilds; material coordinates and inverse masses come from the new mesh. */
import type { JellyPlasticState } from './gummyJellyPlasticity'

export type GummySolverDynamicState = {
  positions: Float32Array
  previous: Float32Array
  velocities: Float32Array
  grip: Float32Array
  simulationTime: number
  accumulator: number
  gripKey: string
  gripping: boolean
  previousPressHeight?: number
  /** Stable per-tet material memory; vertex-star cloning does not reorder tetrahedra. */
  jellyPlasticState?: JellyPlasticState
}

/** Coincident clones inherit velocity and grip history; partitioned masses preserve parent inertia. */
export function remapGummyDynamicState(
  snapshot: GummySolverDynamicState,
  restPositions: Float32Array,
  sourceNodes?: Uint32Array,
): GummySolverDynamicState {
  const oldCount = snapshot.positions.length / 4
  const count = restPositions.length / 4
  if (
    !Number.isInteger(oldCount) ||
    !oldCount ||
    !Number.isInteger(count) ||
    !count ||
    [
      snapshot.positions,
      snapshot.previous,
      snapshot.velocities,
      snapshot.grip,
    ].some(
      (values) =>
        values.length !== oldCount * 4 ||
        values.some((value) => !Number.isFinite(value)),
    ) ||
    restPositions.some(
      (value, index) =>
        !Number.isFinite(value) || (index % 4 === 3 && value < 0),
    ) ||
    !Number.isFinite(snapshot.simulationTime) ||
    snapshot.simulationTime < 0 ||
    !Number.isFinite(snapshot.accumulator) ||
    snapshot.accumulator < -1e-8 ||
    snapshot.accumulator > 0.05 + 1e-8 ||
    typeof snapshot.gripKey !== 'string' ||
    typeof snapshot.gripping !== 'boolean' ||
    (snapshot.previousPressHeight !== undefined &&
      !Number.isFinite(snapshot.previousPressHeight))
  )
    throw new Error('Invalid gummy live-state snapshot')
  const sources =
    sourceNodes ?? Uint32Array.from({ length: count }, (_, id) => id)
  if (
    sources.length !== count ||
    sources.some((source) => source >= oldCount) ||
    (!sourceNodes && count !== oldCount)
  )
    throw new Error('Gummy live-state source map must cover every new node')
  const remap = (values: Float32Array, mass: boolean) => {
    const result = new Float32Array(count * 4)
    for (let id = 0; id < count; id++) {
      const source = sources[id]! * 4
      result.set(values.subarray(source, source + 4), id * 4)
      if (mass) result[id * 4 + 3] = restPositions[id * 4 + 3]!
    }
    return result
  }
  return {
    ...snapshot,
    positions: remap(snapshot.positions, true),
    previous: remap(snapshot.previous, true),
    velocities: remap(snapshot.velocities, false),
    grip: remap(snapshot.grip, false),
  }
}
