import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import type { AudioFeature, AudioMappingEntry, FlameTarget, TransformInfo, } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import { SourceNode, AUDIO_SOURCE_GROUPS, type SourceNodeData, } from './SourceNode'
import { TargetNode, buildTargetGroups, type TargetGroupData, type TargetNodeData, } from './TargetNode'
import { WireOverlay, type WireConnection } from './WireOverlay'
import styles from './AudioWiringModal.module.css'

/** Flattened list of all source nodes from groups. */
const ALL_SOURCES: SourceNodeData[] = AUDIO_SOURCE_GROUPS.flatMap(
  (g) => g.sources,
)

/** Maps feature name → SourceNodeData for quick lookup. */
const SOURCE_BY_FEATURE = new Map<AudioFeature, SourceNodeData>(
  ALL_SOURCES.map((s) => [s.feature, s]),
)

const DEFAULT_PRESETS: Record<string, AudioMappingEntry[]> = {
  clear: [],
  'quick-start': [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 0.5,
      range: [0.5, 2.0],
      attackMs: 50,
      releaseMs: 200,
    },
    {
      audioFeature: 'mid',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 0.4,
      range: [0.8, 1.5],
      attackMs: 40,
      releaseMs: 150,
    },
    {
      audioFeature: 'onset',
      target: { kind: 'renderSetting', param: 'zoom' },
      sensitivity: 0.3,
      range: [1.0, 1.25],
      attackMs: 10,
      releaseMs: 300,
    },
  ],
}

function entryToWire(m: AudioMappingEntry): WireConnection {
  return { sourceFeature: m.audioFeature, target: m.target }
}

function wireId(conn: WireConnection): string {
  return `${conn.sourceFeature}->${flameTargetKey(conn.target)}`
}

export function AudioWiringModal(props: {
  mappings: AudioMappingEntry[]
  transforms: TransformInfo[]
  onMappingsChange: (mappings: AudioMappingEntry[]) => void
  presets?: Record<string, AudioMappingEntry[]>
  onClose: () => void
}) {
  const [connectingFrom, setConnectingFrom] = createSignal<AudioFeature | null>(
    null,
  )
  const [selectedWire, setSelectedWire] = createSignal<string | null>(null)
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(
    new Set(['render', 'finalAffine']),
  )
  const [containerRef, setContainerRef] = createSignal<HTMLElement | null>(null)

  const presets = () => props.presets ?? DEFAULT_PRESETS
  const activePreset = createMemo(() => {
    // Detect which preset matches the current mappings
    for (const [name, entries] of Object.entries(presets())) {
      if (entries.length === props.mappings.length) {
        const currentKeys = new Set(
          props.mappings.map((m) => flameTargetKey(m.target)),
        )
        const presetKeys = new Set(entries.map((e) => flameTargetKey(e.target)))
        if (
          currentKeys.size === presetKeys.size &&
          [...currentKeys].every((k) => presetKeys.has(k))
        ) {
          return name
        }
      }
    }
    return ''
  })

  const targetGroups = createMemo(() => buildTargetGroups(props.transforms))

  // Wire connections derived from mappings
  const connections = createMemo(() => props.mappings.map(entryToWire))

  // Maps for quick connection lookup
  const connectionByTarget = createMemo(() => {
    const map = new Map<string, WireConnection>()
    for (const c of connections()) map.set(flameTargetKey(c.target), c)
    return map
  })

  const connectionBySource = createMemo(() => {
    const map = new Map<AudioFeature, WireConnection[]>()
    for (const c of connections()) {
      const existing = map.get(c.sourceFeature) ?? []
      existing.push(c)
      map.set(c.sourceFeature, existing)
    }
    return map
  })

  // Selected mapping entry for the bottom parameter panel
  const selectedEntry = createMemo((): AudioMappingEntry | null => {
    const id = selectedWire()
    if (!id) return null
    return props.mappings.find((m) => wireId(entryToWire(m)) === id) ?? null
  })

  // Handler: start connection from source port
  function startConnection(feature: AudioFeature) {
    if (connectingFrom() === feature) {
      setConnectingFrom(null)
    } else {
      setConnectingFrom(feature)
      setSelectedWire(null)
    }
  }

  // Handler: complete connection on target port
  function completeConnection(target: FlameTarget) {
    const source = connectingFrom()
    if (!source) return

    // Prevent duplicate connections
    const tgtKey = flameTargetKey(target)
    const existingWire = connectionByTarget().get(tgtKey)
    if (existingWire && existingWire.sourceFeature === source) {
      // Already connected - select the existing wire
      setSelectedWire(wireId(existingWire))
      setConnectingFrom(null)
      return
    }

    // If this target already has a connection from a different source, replace it
    let next = [...props.mappings]
    if (existingWire) {
      next = next.filter((m) => flameTargetKey(m.target) !== tgtKey)
    }

    const newEntry: AudioMappingEntry = {
      audioFeature: source,
      target,
      sensitivity: 0.3,
      range:
        target.kind === 'renderSetting' && target.param === 'zoom'
          ? [0.5, 1.5]
          : [0, 1],
      attackMs: 40,
      releaseMs: 150,
    }
    next.push(newEntry)
    props.onMappingsChange(next)
    setSelectedWire(wireId({ sourceFeature: source, target }))
    setConnectingFrom(null)
  }

  // Handler: update selected entry
  function updateSelectedEntry(updates: Partial<AudioMappingEntry>) {
    const id = selectedWire()
    if (!id) return
    const next = props.mappings.map((m) => {
      if (wireId(entryToWire(m)) === id) {
        return { ...m, ...updates }
      }
      return m
    })
    props.onMappingsChange(next)
  }

  // Handler: delete selected entry
  function deleteSelectedEntry() {
    const id = selectedWire()
    if (!id) return
    const next = props.mappings.filter((m) => wireId(entryToWire(m)) !== id)
    props.onMappingsChange(next)
    setSelectedWire(null)
  }

  // Click on overlay background cancels connection / deselects wire
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      setConnectingFrom(null)
      setSelectedWire(null)
    }
  }

  // Keyboard: Escape cancels
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (connectingFrom()) {
        setConnectingFrom(null)
      } else if (selectedWire()) {
        setSelectedWire(null)
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete if user is editing an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      deleteSelectedEntry()
    }
  }

  function toggleGroup(kind: string) {
    const next = new Set(expandedGroups())
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    setExpandedGroups(next)
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })

  // --- Render helpers ---

  function renderSourceColumn() {
    return (
      <div class={styles.sourcesColumn}>
        <div class={styles.columnLabel}>Audio Sources</div>
        {AUDIO_SOURCE_GROUPS.map((group) => (
          <div class={styles.sourceGroup}>
            <div class={styles.sourceGroupLabel}>{group.label}</div>
            {group.sources.map((source) => {
              const isConnecting = connectingFrom() === source.feature
              const sourceConns = connectionBySource().get(source.feature) ?? []
              const isSourceOfSelected =
                selectedWire() !== null &&
                sourceConns.some((c) => wireId(c) === selectedWire())
              return (
                <SourceNode
                  source={source}
                  level={0.3} // placeholder - real levels come from analyzer
                  isConnecting={isConnecting}
                  isSourceOfSelectedWire={isSourceOfSelected}
                  onStartConnection={startConnection}
                />
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  function renderTargetColumn() {
    const selEntry = selectedEntry()
    const selTgtKey = selEntry ? flameTargetKey(selEntry.target) : null

    return (
      <div class={styles.targetsColumn}>
        <div class={styles.columnLabel}>Flame Parameters</div>
        <For each={targetGroups()}>
          {(group) => {
            const isOpen = expandedGroups().has(group.kind)
            return (
              <div class={styles.targetGroup}>
                <div
                  class={styles.targetGroupHeader}
                  onClick={() => toggleGroup(group.kind)}
                >
                  <span
                    class={styles.targetGroupArrow}
                    classList={{
                      [styles.targetGroupArrowOpen as string]: isOpen,
                    }}
                  >
                    ▶
                  </span>
                  <span class={styles.targetGroupTitle}>
                    {group.label}
                    <Show
                      when={group.targets.some((t) =>
                        connectionByTarget().has(flameTargetKey(t.target)),
                      )}
                    >
                      {' ·'}
                    </Show>
                  </span>
                </div>
                <Show when={isOpen}>
                  <div class={styles.targetGroupContent}>
                    <For each={group.targets}>
                      {(node) => {
                        const key = flameTargetKey(node.target)
                        const conn = connectionByTarget().get(key)
                        const isTarget = selTgtKey === key
                        return (
                          <TargetNode
                            node={node}
                            isConnecting={connectingFrom() !== null}
                            isTargetOfSelectedWire={!!isTarget}
                            connectedSourceLabel={
                              conn
                                ? SOURCE_BY_FEATURE.get(conn.sourceFeature)
                                    ?.label
                                : undefined
                            }
                            onCompleteConnection={completeConnection}
                          />
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    )
  }

  return (
    <div class={styles.overlay} onClick={handleOverlayClick}>
      {/* Header */}
      <div class={styles.header}>
        <span class={styles.headerTitle}>Audio Wiring</span>
        <div class={styles.presetRow}>
          {Object.keys(presets()).map((name) => (
            <button
              type="button"
              class={styles.presetBtn}
              classList={{
                [styles.presetBtnActive as string]: activePreset() === name,
              }}
              onClick={() => {
                const entries = presets()[name]
                if (entries) {
                  props.onMappingsChange(entries)
                  setSelectedWire(null)
                  setConnectingFrom(null)
                }
              }}
            >
              {name === 'clear' ? 'Clear' : name}
            </button>
          ))}
        </div>
        <div class={styles.headerSpacer} />
        <button type="button" class={styles.closeBtn} onClick={props.onClose}>
          ✕
        </button>
      </div>

      {/* Main canvas */}
      <div class={styles.main} ref={setContainerRef}>
        {renderSourceColumn()}
        {renderTargetColumn()}
        <WireOverlay
          connections={connections()}
          selectedWire={selectedWire()}
          connectingFrom={connectingFrom()}
          containerRef={containerRef()}
          sources={ALL_SOURCES}
          onSelectWire={(id) => {
            setSelectedWire(id)
            setConnectingFrom(null)
          }}
        />
        <Show when={connectingFrom()}>
          <div class={styles.connectingBanner}>
            Click a target parameter to connect{' '}
            {SOURCE_BY_FEATURE.get(connectingFrom()!)?.label ?? ''} →
          </div>
        </Show>
      </div>

      {/* Bottom parameter panel */}
      <div
        class={styles.paramsPanel}
        classList={{
          [styles.paramsPanelEmpty as string]: !selectedEntry(),
        }}
      >
        <Show
          when={selectedEntry()}
          fallback={
            <span class={styles.paramsPanelHint}>
              Click a wire or connect a source to a target to edit mapping
              parameters
            </span>
          }
        >
          {(entry) => {
            const sourceLabel =
              SOURCE_BY_FEATURE.get(entry().audioFeature)?.label ??
              entry().audioFeature
            const targetKey = flameTargetKey(entry().target)
            const targetLabel = targetKey

            return (
              <>
                <div class={styles.paramsTitle}>
                  <span class={styles.paramsTitleSource}>{sourceLabel}</span>
                  <span class={styles.paramsTitleArrow}>→</span>
                  <span class={styles.paramsTitleTarget}>{targetLabel}</span>
                </div>
                <div class={styles.paramsFields}>
                  {/* Sensitivity */}
                  <div class={styles.paramsField}>
                    <span class={styles.paramsLabel}>Sensitivity</span>
                    <input
                      type="range"
                      class={styles.paramsSlider}
                      min={0}
                      max={2}
                      step={0.01}
                      value={entry().sensitivity}
                      onInput={(e) => {
                        updateSelectedEntry({
                          sensitivity: parseFloat(e.currentTarget.value),
                        })
                      }}
                    />
                    <span class={styles.paramsValue}>
                      {entry().sensitivity.toFixed(2)}
                    </span>
                  </div>

                  {/* Range min */}
                  <div class={styles.paramsField}>
                    <span class={styles.paramsLabel}>Range</span>
                    <div class={styles.paramsRangeInputs}>
                      <input
                        type="number"
                        class={styles.paramsRangeInput}
                        step={0.01}
                        value={entry().range[0]}
                        onChange={(e) => {
                          updateSelectedEntry({
                            range: [
                              parseFloat(e.currentTarget.value),
                              entry().range[1],
                            ],
                          })
                        }}
                      />
                      <span class={styles.paramsRangeDash}>–</span>
                      <input
                        type="number"
                        class={styles.paramsRangeInput}
                        step={0.01}
                        value={entry().range[1]}
                        onChange={(e) => {
                          updateSelectedEntry({
                            range: [
                              entry().range[0],
                              parseFloat(e.currentTarget.value),
                            ],
                          })
                        }}
                      />
                    </div>
                  </div>

                  {/* Attack */}
                  <div class={styles.paramsField}>
                    <span class={styles.paramsLabel}>Attack</span>
                    <input
                      type="range"
                      class={styles.paramsSlider}
                      min={0}
                      max={500}
                      step={1}
                      value={entry().attackMs ?? 40}
                      onInput={(e) => {
                        updateSelectedEntry({
                          attackMs: parseInt(e.currentTarget.value, 10),
                        })
                      }}
                    />
                    <span class={styles.paramsValue}>
                      {entry().attackMs ?? 40}ms
                    </span>
                  </div>

                  {/* Release */}
                  <div class={styles.paramsField}>
                    <span class={styles.paramsLabel}>Release</span>
                    <input
                      type="range"
                      class={styles.paramsSlider}
                      min={0}
                      max={1000}
                      step={1}
                      value={entry().releaseMs ?? 150}
                      onInput={(e) => {
                        updateSelectedEntry({
                          releaseMs: parseInt(e.currentTarget.value, 10),
                        })
                      }}
                    />
                    <span class={styles.paramsValue}>
                      {entry().releaseMs ?? 150}ms
                    </span>
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    class={styles.paramsDeleteBtn}
                    onClick={deleteSelectedEntry}
                  >
                    Delete
                  </button>
                </div>
              </>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
