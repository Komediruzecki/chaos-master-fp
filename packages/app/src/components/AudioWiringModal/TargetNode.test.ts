// Pins the targets the wiring editor offers for a transform: each names its
// transform by id, and each variation weight its variation by id.
import { describe, expect, it } from 'vitest'
import { buildTargetGroups } from './TargetNode'

describe('buildTargetGroups', () => {
  it('names transforms and variations by id', () => {
    const groups = buildTargetGroups([
      {
        id: 't_only',
        index: 0,
        label: 'Transform 1',
        variations: [
          { id: 'v_one', type: 'linearVar' },
          { id: 'v_two', type: 'linearVar' },
        ],
      },
    ])
    const targets = groups.flatMap((group) =>
      group.subGroups.flatMap((sub) => sub.targets.map((node) => node.target)),
    )
    const onTransform = targets.filter((target) => 'transformIdx' in target)
    expect(onTransform).toHaveLength(12 + 4 + 2)
    expect(onTransform.every((target) => target.transformId === 't_only')).toBe(
      true,
    )
    expect(
      onTransform.flatMap((target) =>
        target.kind === 'variationWeight' ? [target.variationId] : [],
      ),
    ).toEqual(['v_one', 'v_two'])
  })
})
