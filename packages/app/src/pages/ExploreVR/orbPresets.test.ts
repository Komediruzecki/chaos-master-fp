/** Verify that every selectable world survives saving and resolves its real 3D shaders. */
import { tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { FlameDescriptor3D } from '@/flame/schema/flameSchema'
import { createFlameWgsl3D } from '@/flame/transformFunction3D'
import * as v from '@/valibot'
import { getOrbPreset, ORB_PRESETS } from './orbPresets'

describe('observatory flame worlds', () => {
  it('resolves share links and recovers from unknown world IDs', () => {
    expect(getOrbPreset('irchiinnuss').id).toBe('irchiinnuss')
    expect(getOrbPreset('missing').id).toBe('verdant')
    expect(getOrbPreset('').id).toBe('verdant')
  })
  it.each(ORB_PRESETS)(
    '$name is a saveable 3D flame with resolvable variations',
    (preset) => {
      const saved: unknown = JSON.parse(JSON.stringify(preset.flame))
      const result = v.safeParse(FlameDescriptor3D, saved)
      expect(result.success).toBe(true)
      for (const transform of Object.values(preset.flame.transforms)) {
        const code = tgpu.resolve([createFlameWgsl3D(transform).fnImpl], {
          names: 'strict',
        })
        expect(code).toContain('vec3f')
        expect(code).not.toContain('NaN')
      }
    },
  )
})
