/**
 * Native 3D component kernel: choose one independent IFS per walker from its
 * immutable index, then sample only that component's maps for every step.
 * Membership and its mass are recomputed once per dispatch from live map
 * probabilities, without consuming or depending on the evolving RNG state.
 */
import { hash } from '@typegpu/noise'
import { tgpu } from 'typegpu'
import { f32, u32 } from 'typegpu/data'
import { random } from '@/shaders/random'
import type { WalkGroups } from '@chaos-master/core'
import type { TgpuFn } from 'typegpu'
import type { AnyWgslData } from 'typegpu/data'

export {
  selectWalkGroup,
  selectWalkGroupTransform,
  walkGroupMasses,
  walkGroupProbabilities,
  walkGroupProbability,
  walkGroupsOf,
  walkGroupsSignature,
} from '@chaos-master/core'
export type {
  WalkGroup,
  WalkGroups,
  WalkGroupTransform,
} from '@chaos-master/core'

const walkGroupState = tgpu.privateVar(u32, 0).$name('walkGroup')
const walkGroupTotal = tgpu.privateVar(f32, 0).$name('walkGroupTotal')

export function walkGroupKernel<P extends AnyWgslData>(
  groups: WalkGroups,
  pointType: P,
  flames: Record<string, TgpuFn>,
  layout: unknown,
) {
  if (!groups.enabled) return undefined
  const totals = groups.groups.map((group, index) =>
    [
      `var total${index} = f32(0);`,
      ...group.ids.map(
        (id) =>
          `total${index} += max(0.0, layout.$.flameUniforms.flame${id}.probability);`,
      ),
    ].join('\n'),
  )
  const assignments = groups.groups
    .map(
      (_group, index) => /* wgsl */ `
    if (total${index} > 0.0) {
      walkGroup = ${index}u;
      walkGroupTotal = total${index};
      if (threshold < total${index}) { return seed; }
    }
    threshold -= total${index};
  `,
    )
    .join('\n')
  const indexHash = tgpu.fn([u32], u32) /* wgsl */ `
    (pointIndex: u32) -> u32 {
      let seed = hash(pointIndex);
      ${totals.join('\n')}
      let total = ${groups.groups.map((_group, index) => `total${index}`).join(' + ')};
      // High 24 bits convert exactly to f32; the unit roll is always < 1.
      var threshold = f32(seed >> 8u) / 16777216.0 * total;
      walkGroup = ${groups.groups.length}u;
      walkGroupTotal = 0.0;
      ${assignments}
      // Rounding at the cumulative tail keeps the last positive group.
      return seed;
    }
  `
    .$uses({ layout, hash, walkGroup: walkGroupState, walkGroupTotal })
    .$name('walkGroupIndexHash')

  const branches = groups.groups
    .map(
      (group, index) => /* wgsl */ `
    case ${index}u: {
      ${group.ids
        .map(
          (id) => /* wgsl */ `{
        let uniforms = layout.$.flameUniforms.flame${id};
        probabilitySum += max(0.0, uniforms.probability);
        if (flameIndex < probabilitySum) {
          return flame${id}(point, uniforms);
        }
      }`,
        )
        .join('\n')}
    }
  `,
    )
    .join('\n')
  const executeRandomFlame = tgpu.fn([pointType], pointType) /* wgsl */ `
    (point) {
      let flameIndex = random() * walkGroupTotal;
      var probabilitySum = f32(0);
      switch walkGroup {
        ${branches}
        default: {}
      }
      return point;
    }
  `
    .$uses({
      ...flames,
      random,
      layout,
      walkGroup: walkGroupState,
      walkGroupTotal,
    })
    .$name('executeRandomFlame')
  return { executeRandomFlame, indexHash }
}
