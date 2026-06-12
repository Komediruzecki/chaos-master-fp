import { isParametricVariationType, transformVariations, } from '@/flame/variations'
import type { TransformVariationDescriptor, TransformVariationType, } from '@/flame/variations'

export function getNormalizedVariationName(
  type: TransformVariationType,
): string {
  return type.replaceAll(/var/gi, '')
}

export function getVariationDefault(
  type: TransformVariationType,
  weight: number,
): TransformVariationDescriptor {
  if (!isParametricVariationType(type)) {
    return { type, weight, visible: true } as TransformVariationDescriptor
  }
  return {
    type,
    params: { ...transformVariations[type].paramDefaults },
    weight,
    visible: true,
  } as TransformVariationDescriptor
}
