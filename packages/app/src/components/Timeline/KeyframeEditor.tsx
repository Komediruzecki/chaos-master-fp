import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { useKeyframeTarget } from '@/contexts/KeyframeTargetContext'
import { useTimeline } from '@/contexts/TimelineContext'
import { Cross, Redo } from '@/icons'
import { TIMELINE_PARAMETERS } from '@/utils/timeline'
import { KeyframeCurvePreview } from './KeyframeCurvePreview'
import ui from './KeyframeEditor.module.css'
import type { EasingCurve } from '@/flame/schema/timeline'
import type { KeyframeData, TimelineTrack } from '@/utils/timeline'

export function KeyframeEditor() {
  const timeline = useTimeline()!
  const { targetedParameter } = useKeyframeTarget()
  const [selectedPath, setSelectedPath] = createSignal(
    targetedParameter() ?? 'exposure',
  )
  const [keyframeValue, setKeyframeValue] = createSignal('0.25')
  const [interpolationMode, setInterpolationMode] =
    createSignal<EasingCurve>('linear')
  const [isExpanded, setIsExpanded] = createSignal(true)

  // Sync selectedPath with targetedParameter when it changes externally
  createEffect(() => {
    const targeted = targetedParameter()
    if (targeted !== null && selectedPath() !== targeted) {
      setSelectedPath(targeted)
    }
  })

  function ChevronDownIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    )
  }

  function ChevronUpIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    )
  }

  const currentPath = () => selectedPath()
  const currentFrame = createMemo(() => timeline.currentFrame())
  const tracks = createMemo(() => timeline.tracks())

  const track = createMemo(() => {
    const path = currentPath()
    const tracksData = tracks()
    return tracksData.find((t) => t.parameterPath === path)
  })

  // Find current value for selected path at current frame
  const currentValue = createMemo(() => {
    const value = timeline.resolveValueAtPath(currentPath(), currentFrame())
    return value ?? null
  })

  // Check if current path expects a number or string
  const isNumberValue = (): boolean => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === currentPath())
    return param?.type === 'number'
  }

  // Check if current path expects an array value (like backgroundColor, edgeFadeColor)
  const isArrayValue = (): boolean => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === currentPath())
    return param?.type === 'array'
  }

  // Format array value for display/input
  const formatArrayValue = (value: unknown): string => {
    if (Array.isArray(value) && value.length === 3) {
      return value.join(', ')
    }
    if (Array.isArray(value) && value.length === 4) {
      return value.join(', ')
    }
    return String(value)
  }

  // Check if current path expects a string value (drawMode, colorInitMode, etc.)
  const isStringValue = (): boolean => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === currentPath())
    return param?.type === 'string'
  }

  // Parse array value from input string
  const parseArrayValue = (
    input: string,
  ): [number, number, number] | [number, number, number, number] | null => {
    try {
      const parts = input.split(',').map((s) => parseFloat(s.trim()))
      if (parts.length === 3) {
        return [parts[0]!, parts[1]!, parts[2]!]
      }
      if (parts.length === 4) {
        return [parts[0]!, parts[1]!, parts[2]!, parts[3]!]
      }
    } catch {
      // Ignore parse errors
    }
    return null
  }

  // Get value type for a track at current frame
  const getCurrentValueType = (): 'number' | 'string' | 'array' => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === currentPath())
    if (!param) return 'number'
    return param.type
  }

  // Get current value type from keyframe
  const getKeyframeValueType = (keyframe: KeyframeData): 'number' | 'string' | 'array' => {
    if (keyframe.value === null || keyframe.value === undefined) {
      return 'number'
    }
    if (Array.isArray(keyframe.value)) {
      return 'array'
    }
    if (typeof keyframe.value === 'string') {
      return 'string'
    }
    return 'number'
  }

  // Update value when frame changes
  createEffect(() => {
    const value = currentValue()
    if (value !== null) {
      if (isArrayValue()) {
        setKeyframeValue(formatArrayValue(value))
      } else {
        setKeyframeValue(String(value))
      }
    }
  })

  // Add keyframe at current frame
  const handleAddKeyframe = () => {
    const value = keyframeValue()

    let keyValue: string | number | [number, number, number] | [number, number, number, number] = value

    if (isArrayValue()) {
      const parsed = parseArrayValue(value)
      keyValue = parsed ?? [0, 0, 0]
    } else if (!isStringValue()) {
      keyValue = Number(value)
    }

    timeline.addKeyframe(
      currentPath(),
      currentFrame(),
      keyValue,
      interpolationMode(),
    )
  }

  // Remove keyframe at current frame
  const handleRemoveKeyframe = () => {
    timeline.removeKeyframe(currentPath(), currentFrame())
  }

  // Duplicate keyframe to next frame
  const handleDuplicateKeyframe = () => {
    const currentKf = track()?.keyframes.find(
      (kf: KeyframeData) => kf.frame === currentFrame(),
    )
    if (
      !currentKf ||
      currentKf.value === null ||
      typeof currentKf.value === 'boolean'
    )
      return

    const nextFrame = currentFrame() + 1

    // Preserve exact type of the original keyframe value
    let keyValue = currentKf.value

    // If it's an array and we need to format it as string for input
    if (Array.isArray(keyValue) && getCurrentValueType() === 'string') {
      keyValue = formatArrayValue(keyValue)
    }

    timeline.addKeyframe(
      currentPath(),
      nextFrame,
      keyValue,
      currentKf.easing,
    )
  }

  // Freeze keyframe (copy current value to next frame)
  const handleFreezeKeyframe = () => {
    const nextFrame = currentFrame() + 1

    // Use the exact type from keyframeValue input
    let keyValue = keyframeValue()

    if (isArrayValue()) {
      const parsed = parseArrayValue(keyValue)
      keyValue = parsed ?? [0, 0, 0]
    } else if (isNumberValue()) {
      keyValue = Number(keyValue)
    }

    timeline.addKeyframe(
      currentPath(),
      nextFrame,
      keyValue,
      interpolationMode(),
    )
  }

  const hasKeyframeAtFrame = (): boolean => {
    const t = track()
    if (!t) return false
    return t.keyframes.some((kf: KeyframeData) => kf.frame === currentFrame())
  }

  const isAnimating = (): boolean => {
    const t = track()
    return t !== undefined && t.keyframes.length > 1
  }

  return (
    <div class={ui.editor} data-testid="keyframe-editor">
      {/* Header with toggle */}
      <div class={ui.header} onClick={() => setIsExpanded(!isExpanded())}>
        <span class={ui.title}>Keyframes</span>
        {isExpanded() ? <ChevronDownIcon /> : <ChevronUpIcon />}
      </div>

      {isExpanded() && (
        <>
          {/* Display the targeted parameter with dropdown fallback */}
          <div class={ui.parameterSelect}>
            <label class={ui.parameterLabel}>Target:</label>
            <div class={ui.targetedParameter}>
              <span class={ui.targetBadge}>
                {targetedParameter() ?? currentPath()}
              </span>
              <select
                value={currentPath()}
                onChange={(e) => setSelectedPath(e.currentTarget.value)}
                data-testid="parameter-select"
              >
                {Object.entries(
                  Object.groupBy(TIMELINE_PARAMETERS, (p) => p.group),
                ).map(([group, params]) => (
                  <optgroup label={group}>
                    {params!.map((p) => (
                      <option value={p.path}>{p.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {currentValue() !== null && (
            <div class={ui.currentValue}>
              <span>Frame:</span>
              <span>{currentFrame()}</span>
            </div>
          )}

          <div class={ui.keyframeValue}>
            <input
              type="text"
              value={keyframeValue()}
              onInput={(e) => setKeyframeValue(e.currentTarget.value)}
              placeholder={isNumberValue() ? '0.25' : 'colorInit'}
              data-testid="keyframe-value-input"
            />
            {isArrayValue() && (
              <div
                class={ui.colorPreview}
                style={{
                  background: `rgb(${keyframeValue()})`,
                }}
                data-testid="color-preview"
              />
            )}
          </div>

          {hasKeyframeAtFrame() && (
            <div class={ui.keyframeOptions}>
              <select
                value={interpolationMode()}
                onChange={(e) =>
                  setInterpolationMode(e.currentTarget.value as EasingCurve)
                }
                data-testid="interpolation-select"
              >
                <option value="linear">Linear</option>
                <option value="easeIn">Ease In</option>
                <option value="easeOut">Ease Out</option>
                <option value="easeInOut">Ease In Out</option>
              </select>

              <button
                class={ui.actionButton}
                onClick={handleDuplicateKeyframe}
                data-testid="duplicate-keyframe"
                title="Duplicate"
              >
                <Redo />
              </button>
              <button
                class={ui.actionButton}
                onClick={handleFreezeKeyframe}
                data-testid="freeze-keyframe"
                title="Freeze"
              >
                <Cross />
              </button>
            </div>
          )}

          <div class={ui.actions}>
            <button
              class={ui.button}
              classList={{ [ui.active as string]: hasKeyframeAtFrame() }}
              onClick={handleAddKeyframe}
              data-testid={
                hasKeyframeAtFrame() ? 'update-keyframe' : 'add-keyframe'
              }
            >
              {hasKeyframeAtFrame() ? 'Update' : 'Add'}
            </button>

            {hasKeyframeAtFrame() && (
              <button
                class={ui.button}
                classList={{ [ui.danger as string]: true }}
                onClick={handleRemoveKeyframe}
                data-testid="remove-keyframe"
              >
                <Cross />
              </button>
            )}
          </div>

          <div class={ui.info}>
            {hasKeyframeAtFrame() ? (
              <>
                Keyframe at frame <span>{currentFrame()}</span>
                {isAnimating() && <span class={ui.animating}>Active</span>}
              </>
            ) : (
              'No keyframe'
            )}
          </div>

          {/* Keyframe Curve Preview */}
          <Show when={isAnimating() && isNumberValue()}>
            <div class={ui.curvePreview}>
              <div class={ui.curvePreviewHeader}>
                <span class={ui.curvePreviewTitle}>Curve Preview</span>
                <select
                  value={interpolationMode()}
                  onChange={(e) =>
                    setInterpolationMode(e.currentTarget.value as EasingCurve)
                  }
                  class={ui.curvePreviewSelect}
                >
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease In</option>
                  <option value="easeOut">Ease Out</option>
                  <option value="easeInOut">Ease In Out</option>
                  <option value="bounce">Bounce</option>
                  <option value="elastic">Elastic</option>
                </select>
              </div>
              <KeyframeCurvePreview
                parameterPath={currentPath()}
              />
            </div>
          </Show>
        </>
      )}
    </div>
  )
}
