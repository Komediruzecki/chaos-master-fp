/** Retain native Cinema sampling and preview ownership across editable takes. */
import { createEffect, createMemo, createSignal, untrack } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { NativeCinemaCanvas } from './NativeCinemaCanvas'
import { useCollectionClouds } from './useCollectionClouds'
import type { CaptureSize, NativeCinemaProps } from './nativeCinemaTypes'

export type { NativeFractalCinemaController } from './nativeCinemaTypes'

/** Retain the renderer across shot edits and cache two bounded sampling results for comparisons. */
export function NativeFractalCinemaScene(props: NativeCinemaProps) {
  const quality = createMemo(() =>
    props.recipe.quality === 'fine' ? 'high' : 'normal',
  )
  const source = useCollectionClouds(
    () => props.recipe.nativeCollection.id,
    quality,
    { maxEntries: 2, maxBytes: 32 * 1024 * 1024, includeSolids: true },
  )
  const [captureSize, setCaptureSize] = createSignal<CaptureSize>()
  const [visible, setVisible] = createSignal(true)
  createEffect(() => {
    const error = source.error()
    if (error)
      untrack(() => {
        props.onError(error)
      })
  })
  return (
    <AutoCanvas
      pixelRatio={1}
      fixedResolution={captureSize()}
      onVisibilityChange={setVisible}
      role="img"
      ariaLabel="Fractal chess cinematic capture preview"
    >
      <NativeCinemaCanvas
        {...props}
        clouds={source.clouds()}
        sourceKey={source.resultKey()}
        shell={source.shell()}
        solidShell={source.solidShell()}
        solids={source.solids()}
        solidError={source.solidError()}
        visible={visible()}
        setCaptureSize={setCaptureSize}
      />
    </AutoCanvas>
  )
}
