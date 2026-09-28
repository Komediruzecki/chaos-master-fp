// The variation picker of a variation-weight row in the audio panel: one pill
// per variation of the row's transform, the driven one lit. Picks by key, so
// two variations of one type are two pills.
import { For } from 'solid-js'
import ui from './AudioReactivePanel.module.css'
import type { FlameTarget, TransformInfo } from '@/utils/audioAnalysis'

export type VariationInfo = TransformInfo['variations'][number]

export function VariationWeightPills(props: {
  target: FlameTarget
  transforms: TransformInfo[]
  onSelect: (variation: VariationInfo) => void
}) {
  // Read on every render, not once: moving the row to another transform
  // swaps the pills without remounting the picker.
  const variations = () => {
    const t = props.target
    const txIdx = t.kind === 'variationWeight' ? t.transformIdx : 0
    return (
      props.transforms.find((info) => info.index === txIdx)?.variations ?? []
    )
  }
  const driven = (v: VariationInfo) => {
    const t = props.target
    if (t.kind !== 'variationWeight') return false
    return t.variationId === undefined
      ? t.variationType === v.type
      : t.variationId === v.id
  }

  return (
    <div class={ui.variationPillsRow}>
      {variations().length === 0 ? (
        <span class={ui.noVariations}>No variations</span>
      ) : (
        <For each={variations()}>
          {(v) => (
            <button
              type="button"
              class={ui.variationPill}
              classList={{
                [ui.variationPillActive as string]: driven(v),
              }}
              title={v.type}
              aria-label={v.type}
              aria-pressed={driven(v)}
              onClick={() => {
                props.onSelect(v)
              }}
            >
              {v.type}
            </button>
          )}
        </For>
      )}
    </div>
  )
}
