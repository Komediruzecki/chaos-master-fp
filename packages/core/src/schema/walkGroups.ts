/**
 * Fixed 3D walker components: partition map IDs without changing their order,
 * and sample each independent attractor using its visible positive weights.
 * The GPU kernel uses the same partition and mass rules. No names means the
 * legacy global chaos game; mixed untagged maps form one implicit component.
 */

export type WalkGroupTransform = {
  walkGroup?: string
  probability: number
  visible: boolean
}

export type WalkGroup = { name: string | undefined; ids: string[] }
export type WalkGroups = { enabled: boolean; groups: WalkGroup[] }

const DISABLED: WalkGroups = { enabled: false, groups: [] }

/** Group identities are structural; probabilities remain live uniforms. */
export function walkGroupsOf(
  transforms: Readonly<Record<string, Pick<WalkGroupTransform, 'walkGroup'>>>,
): WalkGroups {
  const entries = Object.entries(transforms)
  if (!entries.some(([, transform]) => transform.walkGroup !== undefined)) {
    return DISABLED
  }
  const byName = new Map<string | undefined, WalkGroup>()
  for (const [id, transform] of entries) {
    const name = transform.walkGroup
    let group = byName.get(name)
    if (!group) {
      group = { name, ids: [] }
      byName.set(name, group)
    }
    group.ids.push(id)
  }
  return { enabled: true, groups: [...byName.values()] }
}

/** Nothing is added to a legacy shader's key. Names never become WGSL IDs. */
export function walkGroupsSignature(groups: WalkGroups) {
  return groups.enabled ? { walkGroups: groups.groups } : {}
}

/** The authored mass of a map, before normalizing globally or within a group. */
export function walkGroupProbability(transform: WalkGroupTransform): number {
  return transform.visible && Number.isFinite(transform.probability)
    ? Math.max(0, transform.probability)
    : 0
}

/**
 * Normalize finite positive map weights without overflowing their sum. This
 * is the grouped 3D uniform writer's input as well as the CPU sampling input.
 */
export function walkGroupProbabilities(
  transforms: Readonly<Record<string, WalkGroupTransform>>,
): Record<string, number> {
  const entries = Object.entries(transforms).map(
    ([id, transform]) => [id, walkGroupProbability(transform)] as const,
  )
  const largest = entries.reduce(
    (value, [, weight]) => Math.max(value, weight),
    0,
  )
  const scaledTotal =
    largest > 0
      ? entries.reduce((total, [, weight]) => total + weight / largest, 0)
      : 0
  return Object.fromEntries(
    entries.map(([id, weight]) => [
      id,
      scaledTotal > 0 ? weight / largest / scaledTotal : 0,
    ]),
  )
}

/** Normalized group masses; zero-mass groups receive no walkers. */
export function walkGroupMasses(
  groups: WalkGroups,
  transforms: Readonly<Record<string, WalkGroupTransform>>,
): number[] {
  const probabilities = walkGroupProbabilities(transforms)
  return groups.groups.map((group) =>
    group.ids.reduce((total, id) => total + (probabilities[id] ?? 0), 0),
  )
}

/** Pick a positive entry using a unit roll; shared by group and map sampling. */
function weightedIndex(weights: readonly number[], roll: number) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return undefined
  const unitRoll = Number.isFinite(roll)
    ? Math.min(1 - Number.EPSILON, Math.max(0, roll))
    : 0
  const threshold = unitRoll * total
  let cumulative = 0
  let last: number | undefined
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] ?? 0
    if (weight <= 0) continue
    last = index
    cumulative += weight
    if (threshold < cumulative) return index
  }
  return last
}

/** A stable walker-identity roll chooses membership, never an iteration roll. */
export function selectWalkGroup(masses: readonly number[], walkerRoll: number) {
  return weightedIndex(masses, walkerRoll)
}

/** A chain then samples only maps in its chosen group, normalized locally. */
export function selectWalkGroupTransform(
  group: WalkGroup,
  transforms: Readonly<Record<string, WalkGroupTransform>>,
  roll: number,
): string | undefined {
  const probabilities = walkGroupProbabilities(transforms)
  const weights = group.ids.map((id) => {
    return probabilities[id] ?? 0
  })
  const index = weightedIndex(weights, roll)
  return index === undefined ? undefined : group.ids[index]
}
