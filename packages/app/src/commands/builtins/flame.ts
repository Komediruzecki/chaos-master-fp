import { examples } from '@/flame/examples'
import { generateTransformId, generateVariationId } from '@/flame/transformFunction'
import { getVariationDefault } from '@/flame/variations/utils'
import { deepClone } from '@/utils/clone'
import { registerCommand } from '../registry'
import type { TransformId, VariationId } from '@/flame/schema/flameSchema'
import type { TransformVariationType } from '@/flame/variations'

function getTransformKey(
  transforms: Record<string, unknown>,
  index: number,
): TransformId | undefined {
  const keys = Object.keys(transforms) as TransformId[]
  return index >= 0 && index < keys.length ? keys[index] : undefined
}

registerCommand({
  id: 'flame.setSkipIters',
  label: 'Set Skip Iters',
  description: 'Set the number of initial skip iterations',
  shortcut: 'Shift+I',
  execute(ctx, iters?: unknown) {
    const value = typeof iters === 'number' ? iters : 1
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      next.renderSettings.skipIters = value
      return next
    })
  },
})

registerCommand({
  id: 'flame.addTransform',
  label: 'Add Transform',
  description: 'Add a new transform with an optional variation type',
  shortcut: 'Shift+T',
  execute(ctx, variationType?: unknown) {
    const type = (typeof variationType === 'string'
      ? variationType
      : 'linear') as TransformVariationType
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      next.transforms[generateTransformId()] = {
        probability: 1,
        colorSpeed: 0,
        color: { x: 0, y: 0 },
        visible: true,
        preAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        variations: {
          [generateVariationId()]: getVariationDefault(type, 1),
        },
      }
      return next
    })
  },
})

registerCommand({
  id: 'flame.removeTransform',
  label: 'Remove Transform',
  description: 'Remove a transform by index (0-based)',
  execute(ctx, index?: unknown) {
    const idx = typeof index === 'number' ? index : -1
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      const key = getTransformKey(next.transforms, idx)
      if (key) delete next.transforms[key]
      return next
    })
  },
})

registerCommand({
  id: 'flame.setVariationWeight',
  label: 'Set Variation Weight',
  description: 'Set the weight of a variation on a specific transform',
  execute(ctx, transformIndex?: unknown, variationIndex?: unknown, weight?: unknown) {
    const tidx = typeof transformIndex === 'number' ? transformIndex : 0
    const vidx = typeof variationIndex === 'number' ? variationIndex : 0
    const w = typeof weight === 'number' ? weight : 1
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      const key = getTransformKey(next.transforms, tidx)
      if (key) {
        const transform = next.transforms[key]
        if (transform) {
          const vKeys = Object.keys(transform.variations) as VariationId[]
          if (vidx >= 0 && vidx < vKeys.length) {
            const vKey = vKeys[vidx]
            if (vKey) {
              const variation = transform.variations[vKey]
              if (variation) {
                variation.weight = w
              }
            }
          }
        }
      }
      return next
    })
  },
})

registerCommand({
  id: 'flame.addVariation',
  label: 'Add Variation',
  description: 'Add a variation type to a specific transform',
  execute(ctx, transformIndex?: unknown, variationType?: unknown) {
    const tidx = typeof transformIndex === 'number' ? transformIndex : 0
    const type = (typeof variationType === 'string'
      ? variationType
      : 'linear') as TransformVariationType
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      const key = getTransformKey(next.transforms, tidx)
      if (key) {
        const transform = next.transforms[key]
        if (transform) {
          transform.variations[generateVariationId()] =
            getVariationDefault(type, 1)
        }
      }
      return next
    })
  },
})

registerCommand({
  id: 'flame.setColorSpeed',
  label: 'Set Color Speed',
  description: 'Set the color speed of a specific transform',
  execute(ctx, transformIndex?: unknown, speed?: unknown) {
    const tidx = typeof transformIndex === 'number' ? transformIndex : 0
    const s = typeof speed === 'number' ? speed : 0.5
    ctx.setFlameDescriptor((prev) => {
      const next = deepClone(prev)
      const key = getTransformKey(next.transforms, tidx)
      if (key) {
        const transform = next.transforms[key]
        if (transform) {
          transform.colorSpeed = s
        }
      }
      return next
    })
  },
})

registerCommand({
  id: 'flame.loadPreset',
  label: 'Load Preset',
  description: 'Load an example flame by its key name',
  execute(ctx, presetName?: unknown) {
    const name = typeof presetName === 'string' ? presetName : 'initExample'
    const flame = examples[name as keyof typeof examples]
    if (flame) {
      ctx.setFlameDescriptor(deepClone(flame))
    }
  },
})

registerCommand({
  id: 'flame.setBlendWeight',
  label: 'Set Blend Weight',
  description: 'Set the blend weight for crossfading (0-1)',
  execute(ctx, weight?: unknown) {
    const w = typeof weight === 'number' ? Math.max(0, Math.min(1, weight)) : 0
    ctx.setBlendWeight(w)
  },
})
