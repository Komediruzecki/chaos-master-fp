import { createMemo, Show } from 'solid-js'
import { clamp } from 'typegpu/std'
import { useChangeHistory } from '@/contexts/ChangeHistoryContext'
import { useKeyframeTarget } from '@/contexts/KeyframeTargetContext'
import { createDragHandler } from '@/utils/createDragHandler'
import { scrollIntoViewAndFocusOnChange } from '@/utils/scrollIntoViewOnChange'
import ui from './Slider.module.css'

type SliderProps = {
  class?: string
  value: number
  label?: string
  min?: number
  max?: number
  step?: number
  trackFill?: boolean
  onInput: (value: number) => void
  formatValue?: (value: number) => string
  /** Parameter path for Blender-style keyframe targeting */
  dataParameterPath?: string
}

export function Slider(props: SliderProps) {
  const history = useChangeHistory()
  const { targetedParameter, setTargetedParameter } = useKeyframeTarget()

  const targetedPath = () => targetedParameter()

  const label = () => props.label ?? ''
  const min = () => props.min ?? 0
  const max = () => props.max ?? 1
  const step = () => props.step ?? 0.01
  const value = createMemo(() => {
    return clamp(props.value, min(), max())
  })
  const formatValue = () =>
    props.formatValue ? props.formatValue(value()) : value().toFixed(2)

  const fillPercentage = () => {
    const range = max() - min()
    return ((value() - min()) / range) * 100
  }

  // Dragging the slider handle is handled by the browser,
  // but we still want to startPreview and commit to history once.
  const commitHandler = createDragHandler(
    () => {
      history.startPreview(`Edit ${props.label}`)
      return {
        onDone() {
          history.commit()
        },
      }
    },
    { preventDefault: false },
  )

  return (
    <label
      class={ui.label}
      classList={{
        [props.class ?? '']: true,
        [ui.targeted as string]:
          props.dataParameterPath && targetedPath() === props.dataParameterPath,
      }}
    >
      <Show when={label()}>
        <span>{label()}</span>
      </Show>
      <div
        class={ui.sliderWrapper}
        style={{
          '--fill-percent': `${(props.trackFill ?? true) ? fillPercentage() : 0}%`,
        }}
      >
        <input
          ref={(el) => {
            scrollIntoViewAndFocusOnChange(value, el)
          }}
          class={ui.slider}
          type="range"
          min={min()}
          max={max()}
          step={step()}
          value={value()}
          onPointerDown={commitHandler}
          onInput={(ev) => {
            props.onInput(ev.target.valueAsNumber)
          }}
          onDblClick={() => {
            if (props.dataParameterPath) {
              setTargetedParameter(props.dataParameterPath)
            }
          }}
        />
      </div>
      <span class={ui.value}>{formatValue()}</span>
    </label>
  )
}
