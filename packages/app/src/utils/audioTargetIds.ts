// Keeps audio targets pointing at what they were wired to. A transform target
// names its transform by key, and a variation weight its variation, so wiring
// survives a reorder. These helpers give legacy targets those keys, carry a
// target's position to where its transform went, and re-point wiring that
// moves to another transform or arrives from another flame.

import type { AudioMappingEntry, FlameTarget, TransformInfo, TransformTarget, } from './audioMapping'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

type WeightTarget = Extract<FlameTarget, { kind: 'variationWeight' }>

function isTransformTarget(target: FlameTarget): target is TransformTarget {
  return 'transformIdx' in target
}

/**
 * A weight target naming its variation in `info`: the one with its key, or
 * for a target without one, the first variation of its type. The variation's
 * current type is copied over, so the editor shows what is driven. A key the
 * transform does not have leaves the target as it was.
 */
function withVariation(
  target: WeightTarget,
  info: TransformInfo,
): WeightTarget {
  const variation =
    target.variationId === undefined
      ? info.variations.find(
          (candidate) => candidate.type === target.variationType,
        )
      : info.variations.find((candidate) => candidate.id === target.variationId)
  return variation
    ? { ...target, variationType: variation.type, variationId: variation.id }
    : target
}

function located(
  target: TransformTarget,
  info: TransformInfo,
): TransformTarget {
  const next = { ...target, transformIdx: info.index, transformId: info.id }
  return next.kind === 'variationWeight' ? withVariation(next, info) : next
}

function sameTarget(a: TransformTarget, b: TransformTarget): boolean {
  return (
    a.transformIdx === b.transformIdx &&
    a.transformId === b.transformId &&
    (a.kind !== 'variationWeight' ||
      (b.kind === 'variationWeight' &&
        a.variationType === b.variationType &&
        a.variationId === b.variationId))
  )
}

function reconciled(
  target: FlameTarget,
  transforms: readonly TransformInfo[],
): FlameTarget {
  if (!isTransformTarget(target)) return target
  const info =
    target.transformId === undefined
      ? transforms.find((candidate) => candidate.index === target.transformIdx)
      : transforms.find((candidate) => candidate.id === target.transformId)
  if (!info) return target
  const next = located(target, info)
  return sameTarget(target, next) ? target : next
}

/**
 * `mappings` with every transform target pointed at the transform it names in
 * `transforms`. A target with a key gets that transform's current position; a
 * legacy target (a position only) gets the keys of what sits at its position.
 * A key this flame no longer has is kept, so that wiring stays inert rather
 * than jumping to whichever transform took its place. Returns `mappings`
 * itself when nothing moved, so a memo over it does not wake its readers.
 */
export function reconcileTransformTargets(
  mappings: AudioMappingEntry[],
  transforms: readonly TransformInfo[],
): AudioMappingEntry[] {
  let next: AudioMappingEntry[] | undefined
  for (const [index, mapping] of mappings.entries()) {
    const target = reconciled(mapping.target, transforms)
    if (target === mapping.target) continue
    next ??= [...mappings]
    next[index] = { ...mapping, target }
  }
  return next ?? mappings
}

/**
 * `target` moved onto the transform `info` describes: a row the user moves to
 * another transform, or wiring pasted onto one. A variation weight keeps its
 * type and names that transform's first variation of it, when it has one.
 * Anything but a transform target comes back as it was.
 */
export function retargetTransform(
  target: FlameTarget,
  info: TransformInfo,
): FlameTarget {
  if (!isTransformTarget(target)) return target
  if (target.kind !== 'variationWeight') {
    return { ...target, transformIdx: info.index, transformId: info.id }
  }
  return withVariation(
    {
      kind: 'variationWeight',
      transformIdx: info.index,
      transformId: info.id,
      variationType: target.variationType,
    },
    info,
  )
}

function withoutIds(mapping: AudioMappingEntry): AudioMappingEntry {
  const target = { ...mapping.target }
  if ('transformId' in target) delete target.transformId
  if ('variationId' in target) delete target.variationId
  return { ...mapping, target }
}

/**
 * Imported wiring fitted to the open flame. Wiring made for this flame (it
 * names at least one transform key the flame has) keeps its keys, dangling
 * ones included. Wiring made for another flame names transforms this one never
 * had, so its keys are dropped and it is placed by position, the way all
 * wiring was placed before targets had keys.
 */
export function adoptImportedWiring(
  mappings: AudioMappingEntry[],
  transforms: readonly TransformInfo[],
): AudioMappingEntry[] {
  const known = new Set(transforms.map((info) => info.id))
  const madeForThisFlame = mappings.some(
    ({ target }) =>
      isTransformTarget(target) &&
      target.transformId !== undefined &&
      known.has(target.transformId),
  )
  return reconcileTransformTargets(
    madeForThisFlame ? mappings : mappings.map(withoutIds),
    transforms,
  )
}

function hasLegacyTransformTarget(mappings: AudioMappingEntry[]): boolean {
  return mappings.some(
    ({ target }) =>
      isTransformTarget(target) &&
      (target.transformId === undefined ||
        (target.kind === 'variationWeight' &&
          target.variationId === undefined)),
  )
}

/** `flame`'s transforms as reconciliation reads them: key, position, variations. */
function transformsOf(flame: FlameDescriptor): TransformInfo[] {
  return Object.entries(flame.transforms).map(([id, transform], index) => ({
    id,
    index,
    label: id,
    variations: Object.entries(transform.variations).map(
      ([variationId, variation]) => ({ id: variationId, type: variation.type }),
    ),
  }))
}

/**
 * `wiring` as the workspace stores it for the open flame: a legacy target (a
 * position only) gets the keys of what sits at its position the moment it is
 * set, so the overlay follows that transform through a reorder and goes inert
 * when it is deleted. A target with keys keeps them, dangling ones included:
 * the panel writes a deleted transform's row back on every edit, and it must
 * not land on the transform that took its place. Wiring from another flame is
 * the caller's to adopt (`adoptImportedWiring`) before it gets here. Returns
 * `wiring` itself, and never reads the flame, when there is nothing to key.
 */
export function keyLegacyWiring<T extends { mappings: AudioMappingEntry[] }>(
  wiring: T,
  flame: () => FlameDescriptor,
): T {
  if (!hasLegacyTransformTarget(wiring.mappings)) return wiring
  const mappings = reconcileTransformTargets(
    wiring.mappings,
    transformsOf(flame()),
  )
  return mappings === wiring.mappings ? wiring : { ...wiring, mappings }
}
