import { onCleanup, Show } from 'solid-js'
import { flameTargetPath } from '../../utils/audioAnalysis'
import { ATTACK_MAX_MS, effectiveEnvelope, RELEASE_MAX_MS, } from '../../utils/audioEnvelope'
import { createMappingGestureBoundary } from '../AudioReactivePanel/mappingGesture'
import styles from './AudioWiringModal.module.css'
import type { AudioFeature, AudioMappingEntry } from '../../utils/audioAnalysis'
import type { SourceNodeData } from './SourceNode'

export function ParamsPanel(props: {
  entry: AudioMappingEntry | null
  sourceByFeature: Map<AudioFeature, SourceNodeData>
  onUpdate: (updates: Partial<AudioMappingEntry>) => void
  onDelete: () => void
  onMappingGestureBoundary?: () => void
}) {
  const mappingGesture = createMappingGestureBoundary(() => {
    props.onMappingGestureBoundary?.()
  })
  onCleanup(() => {
    mappingGesture.endAll()
  })

  const gestureProps = {
    onPointerDown: (
      event: PointerEvent & { currentTarget: HTMLInputElement },
    ) => {
      mappingGesture.begin(event.currentTarget)
    },
    onPointerUp: (
      event: PointerEvent & { currentTarget: HTMLInputElement },
    ) => {
      mappingGesture.end(event.currentTarget)
    },
    onPointerCancel: (
      event: PointerEvent & { currentTarget: HTMLInputElement },
    ) => {
      mappingGesture.end(event.currentTarget)
    },
    onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
      mappingGesture.begin(event.currentTarget)
    },
    onKeyUp: (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
      mappingGesture.end(event.currentTarget)
    },
    onChange: (event: Event & { currentTarget: HTMLInputElement }) => {
      mappingGesture.end(event.currentTarget)
    },
    onBlur: (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
      mappingGesture.end(event.currentTarget)
    },
  }

  return (
    <div
      class={styles.paramsPanel}
      classList={{
        [styles.paramsPanelEmpty as string]: !props.entry,
      }}
    >
      <Show
        when={props.entry}
        fallback={
          <span class={styles.paramsPanelHint}>
            Drag ports to wire · Click wire to select · Click again or press Del
            to disconnect · Right-click wire to delete
          </span>
        }
      >
        {(entry) => {
          const sourceLabel =
            props.sourceByFeature.get(entry().audioFeature)?.label ??
            entry().audioFeature
          const targetPath = flameTargetPath(entry().target)
          // The times the envelope runs at, never a stand-in: a row that
          // sets only its release rises at that release too.
          const envelope = () => effectiveEnvelope(entry())

          return (
            <>
              <div class={styles.paramsTitle}>
                <span class={styles.paramsTitleSource}>{sourceLabel}</span>
                <span class={styles.paramsTitleArrow}>→</span>
                <span class={styles.paramsTitleTarget}>{targetPath}</span>
              </div>
              <div class={styles.paramsFields}>
                {/* Sensitivity */}
                <div class={styles.paramsField}>
                  <span class={styles.paramsLabel}>Sensitivity</span>
                  <input
                    {...gestureProps}
                    type="range"
                    class={styles.paramsSlider}
                    min={0}
                    max={2}
                    step={0.01}
                    value={entry().sensitivity}
                    onInput={(e) => {
                      mappingGesture.begin(e.currentTarget)
                      props.onUpdate({
                        sensitivity: parseFloat(e.currentTarget.value),
                      })
                    }}
                  />
                  <span class={styles.paramsValue}>
                    {entry().sensitivity.toFixed(2)}
                  </span>
                </div>

                {/* Range */}
                <div class={styles.paramsField}>
                  <span class={styles.paramsLabel}>Range</span>
                  <div class={styles.paramsRangeInputs}>
                    <input
                      type="number"
                      class={styles.paramsRangeInput}
                      step={0.01}
                      value={entry().range[0]}
                      onChange={(e) => {
                        props.onMappingGestureBoundary?.()
                        props.onUpdate({
                          range: [
                            parseFloat(e.currentTarget.value),
                            entry().range[1],
                          ],
                        })
                        props.onMappingGestureBoundary?.()
                      }}
                    />
                    <span class={styles.paramsRangeDash}>–</span>
                    <input
                      type="number"
                      class={styles.paramsRangeInput}
                      step={0.01}
                      value={entry().range[1]}
                      onChange={(e) => {
                        props.onMappingGestureBoundary?.()
                        props.onUpdate({
                          range: [
                            entry().range[0],
                            parseFloat(e.currentTarget.value),
                          ],
                        })
                        props.onMappingGestureBoundary?.()
                      }}
                    />
                  </div>
                </div>

                {/* Attack */}
                <div class={styles.paramsField}>
                  <span class={styles.paramsLabel}>Attack</span>
                  <input
                    {...gestureProps}
                    type="range"
                    class={styles.paramsSlider}
                    aria-label="Attack"
                    min={0}
                    // An imported time past the end widens the slider rather
                    // than being clamped the moment it is touched.
                    max={Math.max(ATTACK_MAX_MS, envelope().attackMs)}
                    step={1}
                    value={envelope().attackMs}
                    onInput={(e) => {
                      mappingGesture.begin(e.currentTarget)
                      props.onUpdate({
                        attackMs: parseInt(e.currentTarget.value, 10),
                      })
                    }}
                  />
                  <span class={styles.paramsValue}>
                    {envelope().attackMs}ms
                  </span>
                </div>

                {/* Release */}
                <div class={styles.paramsField}>
                  <span class={styles.paramsLabel}>Release</span>
                  <input
                    {...gestureProps}
                    type="range"
                    class={styles.paramsSlider}
                    aria-label="Release"
                    min={0}
                    max={Math.max(RELEASE_MAX_MS, envelope().releaseMs)}
                    step={1}
                    value={envelope().releaseMs}
                    onInput={(e) => {
                      mappingGesture.begin(e.currentTarget)
                      props.onUpdate({
                        releaseMs: parseInt(e.currentTarget.value, 10),
                      })
                    }}
                  />
                  <span class={styles.paramsValue}>
                    {envelope().releaseMs}ms
                  </span>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  class={styles.paramsDeleteBtn}
                  onClick={props.onDelete}
                >
                  Delete
                </button>
              </div>
            </>
          )
        }}
      </Show>
    </div>
  )
}
