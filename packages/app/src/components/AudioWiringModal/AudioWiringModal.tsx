import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { AudioFeature, AudioMappingEntry, FlameTarget, TransformInfo, } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import { SourceNode, AUDIO_SOURCE_GROUPS, type SourceNodeData, } from './SourceNode'
import { TargetCell, AffineCell, buildTargetGroups } from './TargetNode'
import { WireOverlay, type WireConnection } from './WireOverlay'
import styles from './AudioWiringModal.module.css'

const ALL_SOURCES: SourceNodeData[] = AUDIO_SOURCE_GROUPS.flatMap(
  (g) => g.sources,
)

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

  // --- Drag state ---
  const [dragFrom, setDragFrom] = createSignal<AudioFeature | null>(null)
  const [dragFromTarget, setDragFromTarget] = createSignal<FlameTarget | null>(
    null,
  )
  const [dragPos, setDragPos] = createSignal<{ x: number; y: number } | null>(
    null,
  )

  const presets = () => props.presets ?? DEFAULT_PRESETS

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

  // --- Building a lookup from target key → FlameTarget for drag completion ---
  const targetByKey = createMemo(() => {
    const map = new Map<string, FlameTarget>()
    for (const g of targetGroups()) {
      for (const t of g.targets) {
        map.set(flameTargetKey(t.target), t.target)
      }
    }
    return map
  })

  // Selected mapping entry for the bottom parameter panel
  const selectedEntry = createMemo((): AudioMappingEntry | null => {
    const id = selectedWire()
    if (!id) return null
    return props.mappings.find((m) => wireId(entryToWire(m)) === id) ?? null
  })

  // --- Connection handlers ---

  function startConnection(feature: AudioFeature) {
    if (connectingFrom() === feature) {
      setConnectingFrom(null)
    } else {
      setConnectingFrom(feature)
      setSelectedWire(null)
    }
  }

  function completeConnection(target: FlameTarget) {
    const source = connectingFrom()
    if (!source) return

    doConnect(source, target)
    setConnectingFrom(null)
  }

  function doConnect(source: AudioFeature, target: FlameTarget) {
    const tgtKey = flameTargetKey(target)
    const existingWire = connectionByTarget().get(tgtKey)
    if (existingWire && existingWire.sourceFeature === source) {
      setSelectedWire(wireId(existingWire))
      return
    }

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
  }

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

  function handleDeleteWire(wireIdToDelete: string) {
    const next = props.mappings.filter(
      (m) => wireId(entryToWire(m)) !== wireIdToDelete,
    )
    props.onMappingsChange(next)
    setSelectedWire(null)
  }

  function deleteSelectedEntry() {
    const id = selectedWire()
    if (!id) return
    handleDeleteWire(id)
  }

  // --- Drag handlers ---

  function handleDragStart(feature: AudioFeature) {
    setDragFrom(feature)
    setDragFromTarget(null)
    setConnectingFrom(null)
    setSelectedWire(null)
  }

  function handleTargetDragStart(target: FlameTarget) {
    setDragFromTarget(target)
    setDragFrom(null)
    setConnectingFrom(null)
    setSelectedWire(null)
  }

  function handleMouseMove(e: MouseEvent) {
    if ((!dragFrom() && !dragFromTarget()) || !containerRef()) return
    const rect = containerRef()!.getBoundingClientRect()
    setDragPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  function handleMouseUp(e: MouseEvent) {
    const source = dragFrom()
    const target = dragFromTarget()

    if (!source && !target) return

    // We need to temporarily disable pointer-events on SVG wires
    const svg = containerRef()?.querySelector('svg') as SVGSVGElement | null
    if (svg) svg.style.pointerEvents = 'none'

    const elUnder = document.elementFromPoint(
      e.clientX,
      e.clientY,
    ) as HTMLElement | null
    if (svg) svg.style.pointerEvents = ''

    if (source) {
      // Source → Target drop: find target port under cursor
      const targetPortEl = elUnder?.closest(
        '[data-target-port]',
      ) as HTMLElement | null
      const targetKey = targetPortEl?.getAttribute('data-target-port')

      if (targetKey) {
        const resolvedTarget = targetByKey().get(targetKey)
        if (resolvedTarget) {
          doConnect(source, resolvedTarget)
        }
      }
    } else if (target) {
      // Target → Source drop: find source port under cursor
      const sourcePortEl = elUnder?.closest(
        '[data-source-port]',
      ) as HTMLElement | null
      const sourceFeature = sourcePortEl?.getAttribute(
        'data-source-port',
      ) as AudioFeature | null

      if (sourceFeature) {
        doConnect(sourceFeature, target)
      }
    }

    // Reset drag state
    setDragFrom(null)
    setDragFromTarget(null)
    setDragPos(null)
  }

  // --- Click on overlay background ---

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      setConnectingFrom(null)
      setSelectedWire(null)
    }
  }

  // --- Keyboard ---

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (dragFrom()) {
        setDragFrom(null)
        setDragPos(null)
      } else if (dragFromTarget()) {
        setDragFromTarget(null)
        setDragPos(null)
      } else if (connectingFrom()) {
        setConnectingFrom(null)
      } else if (selectedWire()) {
        setSelectedWire(null)
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      deleteSelectedEntry()
    }
  }

  // --- Collapsible groups ---

  function toggleGroup(kind: string) {
    const next = new Set(expandedGroups())
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    setExpandedGroups(next)
  }

  // --- Lifecycle ---

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  })

  // --- Active preset detection ---

  const activePreset = createMemo(() => {
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

  // --- Helpers ---

  function getSourceLabel(feature: AudioFeature): string {
    return SOURCE_BY_FEATURE.get(feature)?.label ?? feature
  }

  // --- Render ---

  function renderTargetGroup(
    group: {
      label: string
      kind: string
      targets: { target: FlameTarget; label: string; paramLabel: string }[]
    },
    selEntry: AudioMappingEntry | null,
    selTgtKey: string | null,
    connectingFromFeature: AudioFeature | null,
    dragFromFeature: AudioFeature | null,
    connByTarget: Map<string, { sourceFeature: AudioFeature }>,
    onComplete: (target: FlameTarget) => void,
    onTargetDragStart: (target: FlameTarget) => void,
  ) {
    if (group.kind === 'render' || group.kind === 'finalAffine') {
      // Simple grid: one TargetCell per target
      return group.targets.map((node) => {
        const key = flameTargetKey(node.target)
        const conn = connByTarget.get(key)
        const connectedSourceLabel = conn
          ? getSourceLabel(conn.sourceFeature)
          : undefined
        const isConnecting = !!connectingFromFeature || !!dragFromFeature
        const isTargetOfSelected = selTgtKey === key

        return (
          <TargetCell
            node={node}
            isConnecting={isConnecting}
            isTargetOfSelectedWire={isTargetOfSelected}
            connectedSourceLabel={connectedSourceLabel}
            onCompleteConnection={onComplete}
            onDragStart={onTargetDragStart}
          />
        )
      })
    }

    // Transform group: split into affine sub-grid, properties, and variations
    const preAffine: {
      target: FlameTarget
      label: string
      paramLabel: string
    }[] = []
    const postAffine: {
      target: FlameTarget
      label: string
      paramLabel: string
    }[] = []
    const properties: {
      target: FlameTarget
      label: string
      paramLabel: string
    }[] = []
    const variations: {
      target: FlameTarget
      label: string
      paramLabel: string
    }[] = []

    for (const node of group.targets) {
      const t = node.target
      if (t.kind === 'transformAffine') {
        if (t.matrix === 'preAffine') preAffine.push(node)
        else postAffine.push(node)
      } else if (t.kind === 'transformProperty') {
        properties.push(node)
      } else if (t.kind === 'variationWeight') {
        variations.push(node)
      }
    }

    const isConnectingGlobal = !!connectingFromFeature || !!dragFromFeature

    function renderAffineCell(
      node: { target: FlameTarget; label: string; paramLabel: string },
      matrixLabel: string,
    ) {
      const key = flameTargetKey(node.target)
      const conn = connByTarget.get(key)
      const connectedSourceLabel = conn
        ? getSourceLabel(conn.sourceFeature)
        : undefined
      const isTargetOfSelected = selTgtKey === key

      return (
        <AffineCell
          label={`${matrixLabel}.${node.paramLabel}`}
          target={node.target}
          isConnecting={isConnectingGlobal}
          isTargetOfSelectedWire={isTargetOfSelected}
          connectedSourceLabel={connectedSourceLabel}
          onCompleteConnection={onComplete}
          onDragStart={onTargetDragStart}
        />
      )
    }

    return (
      <>
        {/* Affine coefficients in a compact sub-grid */}
        {preAffine.length > 0 || postAffine.length > 0 ? (
          <div class={styles.affineBlock}>
            {preAffine.length > 0 && (
              <div class={styles.subSectionLabel}>Pre-Affine</div>
            )}
            {preAffine.map((node) => renderAffineCell(node, 'Pre'))}
            {postAffine.length > 0 && (
              <div class={styles.subSectionLabel}>Post-Affine</div>
            )}
            {postAffine.map((node) => renderAffineCell(node, 'Post'))}
          </div>
        ) : null}

        {/* Properties */}
        {properties.length > 0 && (
          <>
            <div class={styles.subSectionLabel}>Properties</div>
            {properties.map((node) => {
              const key = flameTargetKey(node.target)
              const conn = connByTarget.get(key)
              const connectedSourceLabel = conn
                ? getSourceLabel(conn.sourceFeature)
                : undefined
              const isTargetOfSelected = selTgtKey === key

              return (
                <TargetCell
                  node={node}
                  isConnecting={isConnectingGlobal}
                  isTargetOfSelectedWire={isTargetOfSelected}
                  connectedSourceLabel={connectedSourceLabel}
                  onCompleteConnection={onComplete}
                  onDragStart={onTargetDragStart}
                />
              )
            })}
          </>
        )}

        {/* Variations */}
        {variations.length > 0 && (
          <>
            <div class={styles.subSectionLabel}>Variations</div>
            {variations.map((node) => {
              const key = flameTargetKey(node.target)
              const conn = connByTarget.get(key)
              const connectedSourceLabel = conn
                ? getSourceLabel(conn.sourceFeature)
                : undefined
              const isTargetOfSelected = selTgtKey === key

              return (
                <TargetCell
                  node={node}
                  isConnecting={isConnectingGlobal}
                  isTargetOfSelectedWire={isTargetOfSelected}
                  connectedSourceLabel={connectedSourceLabel}
                  onCompleteConnection={onComplete}
                  onDragStart={onTargetDragStart}
                />
              )
            })}
          </>
        )}
      </>
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
        {/* Sources column */}
        <div class={styles.sourcesColumn}>
          <div class={styles.columnLabel}>Audio Sources</div>
          {AUDIO_SOURCE_GROUPS.map((group) => (
            <div class={styles.sourceGroup}>
              <div class={styles.sourceGroupLabel}>{group.label}</div>
              {group.sources.map((source) => {
                const isConnecting = connectingFrom() === source.feature
                const isDragging = dragFrom() === source.feature
                const isTargetDrag = dragFromTarget() !== null
                const sourceConns =
                  connectionBySource().get(source.feature) ?? []
                const isSourceOfSelected =
                  selectedWire() !== null &&
                  sourceConns.some((c) => wireId(c) === selectedWire())
                return (
                  <SourceNode
                    source={source}
                    level={0.3}
                    isConnecting={isConnecting || isDragging || isTargetDrag}
                    isSourceOfSelectedWire={isSourceOfSelected}
                    onStartConnection={startConnection}
                    onDragStart={handleDragStart}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Targets column — using .map() instead of <For> so expandedGroups() reactivity works */}
        <div class={styles.targetsColumn}>
          <div class={styles.columnLabel}>Flame Parameters</div>
          {targetGroups().map((group) => {
            const isOpen = expandedGroups().has(group.kind)
            const selEntry = selectedEntry()
            const selTgtKey = selEntry ? flameTargetKey(selEntry.target) : null

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
                    {renderTargetGroup(
                      group,
                      selEntry,
                      selTgtKey,
                      connectingFrom(),
                      dragFrom(),
                      connectionByTarget(),
                      completeConnection,
                      handleTargetDragStart,
                    )}
                  </div>
                </Show>
              </div>
            )
          })}
        </div>

        <WireOverlay
          connections={connections()}
          selectedWire={selectedWire()}
          connectingFrom={connectingFrom()}
          dragFrom={dragFrom()}
          dragFromTarget={dragFromTarget()}
          dragPos={dragPos()}
          containerRef={containerRef()}
          sources={ALL_SOURCES}
          onSelectWire={(id) => {
            setSelectedWire(id)
            setConnectingFrom(null)
          }}
          onDeleteWire={handleDeleteWire}
        />

        <Show when={connectingFrom()}>
          <div class={styles.connectingBanner}>
            Click a target parameter to connect{' '}
            {SOURCE_BY_FEATURE.get(connectingFrom()!)?.label ?? ''} →
          </div>
        </Show>

        <Show when={dragFrom()}>
          <div class={styles.connectingBanner}>
            Release on a target to connect{' '}
            {SOURCE_BY_FEATURE.get(dragFrom()!)?.label ?? ''} →
          </div>
        </Show>

        <Show when={dragFromTarget()}>
          <div class={styles.connectingBanner}>
            ← Release on a source to connect to{' '}
            {(() => {
              const t = dragFromTarget()!
              const key = flameTargetKey(t)
              return key
            })()}
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
              Drag ports to wire, click a wire to edit, click again to
              disconnect
            </span>
          }
        >
          {(entry) => {
            const sourceLabel =
              SOURCE_BY_FEATURE.get(entry().audioFeature)?.label ??
              entry().audioFeature
            const targetKey = flameTargetKey(entry().target)

            return (
              <>
                <div class={styles.paramsTitle}>
                  <span class={styles.paramsTitleSource}>{sourceLabel}</span>
                  <span class={styles.paramsTitleArrow}>→</span>
                  <span class={styles.paramsTitleTarget}>{targetKey}</span>
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

                  {/* Delete */}
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
