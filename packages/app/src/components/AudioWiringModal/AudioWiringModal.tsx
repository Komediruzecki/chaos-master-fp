import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { AudioFeature, AudioMappingEntry, FlameTarget, TransformInfo, } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import { SourceNode, AUDIO_SOURCE_GROUPS, type SourceNodeData, } from './SourceNode'
import { TargetCell, AffineCell, buildTargetGroups, type TargetGroupData, } from './TargetNode'
import { WireOverlay, wireId, type WireConnection } from './WireOverlay'
import styles from './AudioWiringModal.module.css'

// ── Module-level constants ──

const ALL_SOURCES: SourceNodeData[] = AUDIO_SOURCE_GROUPS.flatMap(
  (g) => g.sources,
)

const SOURCE_BY_FEATURE = new Map<AudioFeature, SourceNodeData>(
  ALL_SOURCES.map((s) => [s.feature, s]),
)

const SOURCE_COLOR_MAP = new Map<AudioFeature, string>(
  ALL_SOURCES.map((s) => [s.feature, s.color]),
)

/** Default values for new mapping entries. */
const NEW_ENTRY_DEFAULTS = {
  sensitivity: 0.3,
  range: [0, 1] as [number, number],
  zoomRange: [0.5, 1.5] as [number, number],
  attackMs: 40,
  releaseMs: 150,
}

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
  'bass-driven': [
    {
      audioFeature: 'subBass',
      target: { kind: 'renderSetting', param: 'gamma' },
      sensitivity: 0.6,
      range: [0.3, 2.0],
      attackMs: 60,
      releaseMs: 250,
    },
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 0.55,
      range: [0.4, 2.2],
      attackMs: 50,
      releaseMs: 200,
    },
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 0.4,
      range: [0.6, 1.6],
      attackMs: 45,
      releaseMs: 180,
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'zoom' },
      sensitivity: 0.45,
      range: [1.0, 1.35],
      attackMs: 5,
      releaseMs: 250,
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'contrast' },
      sensitivity: 0.35,
      range: [0.75, 1.6],
      attackMs: 5,
      releaseMs: 180,
    },
  ],
  'drum-reactive': [
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'zoom' },
      sensitivity: 0.5,
      range: [1.0, 1.45],
      attackMs: 5,
      releaseMs: 280,
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'highlightPower' },
      sensitivity: 0.65,
      range: [0.4, 2.8],
      attackMs: 5,
      releaseMs: 220,
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'skipIters' },
      sensitivity: 0.4,
      range: [-3, 3],
      attackMs: 3,
      releaseMs: 150,
    },
    {
      audioFeature: 'onset',
      target: { kind: 'renderSetting', param: 'contrast' },
      sensitivity: 0.45,
      range: [0.6, 2.0],
      attackMs: 2,
      releaseMs: 120,
    },
    {
      audioFeature: 'onset',
      target: { kind: 'renderSetting', param: 'gamma' },
      sensitivity: 0.35,
      range: [0.5, 2.2],
      attackMs: 2,
      releaseMs: 140,
    },
    {
      audioFeature: 'subBass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 0.4,
      range: [0.6, 1.8],
      attackMs: 70,
      releaseMs: 300,
    },
  ],
  'full-spectrum': [
    {
      audioFeature: 'subBass',
      target: { kind: 'renderSetting', param: 'gamma' },
      sensitivity: 0.45,
      range: [0.3, 2.2],
      attackMs: 40,
      releaseMs: 200,
    },
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 0.5,
      range: [0.5, 2.0],
      attackMs: 40,
      releaseMs: 200,
    },
    {
      audioFeature: 'lowMid',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 0.4,
      range: [0.7, 1.5],
      attackMs: 35,
      releaseMs: 180,
    },
    {
      audioFeature: 'mid',
      target: { kind: 'renderSetting', param: 'contrast' },
      sensitivity: 0.4,
      range: [0.7, 1.5],
      attackMs: 35,
      releaseMs: 180,
    },
    {
      audioFeature: 'hiMid',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 0.3,
      range: [0, 1],
      attackMs: 30,
      releaseMs: 150,
    },
    {
      audioFeature: 'presence',
      target: { kind: 'renderSetting', param: 'highlightPower' },
      sensitivity: 0.45,
      range: [0.5, 2.0],
      attackMs: 25,
      releaseMs: 150,
    },
    {
      audioFeature: 'brilliance',
      target: { kind: 'renderSetting', param: 'lightPower' },
      sensitivity: 0.4,
      range: [0.5, 2.0],
      attackMs: 20,
      releaseMs: 140,
    },
    {
      audioFeature: 'fullSpectrum',
      target: { kind: 'renderSetting', param: 'depthColorPower' },
      sensitivity: 0.35,
      range: [0.4, 2.2],
      attackMs: 50,
      releaseMs: 250,
    },
  ],
  'energy-flow': [
    {
      audioFeature: 'rms',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 0.55,
      range: [0.4, 2.2],
      attackMs: 30,
      releaseMs: 200,
    },
    {
      audioFeature: 'rms',
      target: { kind: 'renderSetting', param: 'zoom' },
      sensitivity: 0.3,
      range: [1.0, 1.25],
      attackMs: 20,
      releaseMs: 250,
    },
    {
      audioFeature: 'centroid',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 0.4,
      range: [0, 1],
      attackMs: 40,
      releaseMs: 300,
    },
    {
      audioFeature: 'centroid',
      target: { kind: 'renderSetting', param: 'paletteSpeed' },
      sensitivity: 0.35,
      range: [0, 1],
      attackMs: 45,
      releaseMs: 280,
    },
    {
      audioFeature: 'flatness',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 0.3,
      range: [0.7, 1.5],
      attackMs: 50,
      releaseMs: 200,
    },
  ],
  'chaos-morph': [
    {
      audioFeature: 'bass',
      target: {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'a',
      },
      sensitivity: 0.35,
      range: [0.7, 1.3],
      attackMs: 40,
      releaseMs: 200,
    },
    {
      audioFeature: 'mid',
      target: {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'd',
      },
      sensitivity: 0.35,
      range: [0.7, 1.3],
      attackMs: 35,
      releaseMs: 180,
    },
    {
      audioFeature: 'hiMid',
      target: {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'b',
      },
      sensitivity: 0.25,
      range: [0.85, 1.15],
      attackMs: 30,
      releaseMs: 150,
    },
    {
      audioFeature: 'presence',
      target: {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'e',
      },
      sensitivity: 0.25,
      range: [0.85, 1.15],
      attackMs: 25,
      releaseMs: 150,
    },
    {
      audioFeature: 'rms',
      target: {
        kind: 'variationWeight',
        transformIdx: 0,
        variationType: 'linear',
      },
      sensitivity: 0.45,
      range: [0.2, 2.0],
      attackMs: 30,
      releaseMs: 200,
    },
    {
      audioFeature: 'beat',
      target: {
        kind: 'transformProperty',
        transformIdx: 0,
        property: 'probability',
      },
      sensitivity: 0.3,
      range: [0.3, 1.5],
      attackMs: 5,
      releaseMs: 200,
    },
    {
      audioFeature: 'onset',
      target: {
        kind: 'transformProperty',
        transformIdx: 0,
        property: 'colorSpeed',
      },
      sensitivity: 0.4,
      range: [0.5, 2.0],
      attackMs: 2,
      releaseMs: 150,
    },
  ],
}

/** Sensible target pools per audio feature for smart randomization. */
const RANDOMIZE_TARGET_POOLS: Record<AudioFeature, FlameTarget[]> = {
  subBass: [
    { kind: 'renderSetting', param: 'gamma' },
    { kind: 'renderSetting', param: 'vibrancy' },
    { kind: 'renderSetting', param: 'exposure' },
    { kind: 'renderSetting', param: 'contrast' },
  ],
  bass: [
    { kind: 'renderSetting', param: 'vibrancy' },
    { kind: 'renderSetting', param: 'exposure' },
    { kind: 'renderSetting', param: 'gamma' },
    { kind: 'renderSetting', param: 'contrast' },
  ],
  lowMid: [
    { kind: 'renderSetting', param: 'exposure' },
    { kind: 'renderSetting', param: 'contrast' },
    { kind: 'renderSetting', param: 'vibrancy' },
  ],
  mid: [
    { kind: 'renderSetting', param: 'contrast' },
    { kind: 'renderSetting', param: 'palettePhase' },
    { kind: 'renderSetting', param: 'exposure' },
    { kind: 'renderSetting', param: 'vibrancy' },
  ],
  hiMid: [
    { kind: 'renderSetting', param: 'palettePhase' },
    { kind: 'renderSetting', param: 'paletteSpeed' },
    { kind: 'renderSetting', param: 'highlightPower' },
  ],
  presence: [
    { kind: 'renderSetting', param: 'highlightPower' },
    { kind: 'renderSetting', param: 'lightPower' },
    { kind: 'renderSetting', param: 'palettePhase' },
  ],
  brilliance: [
    { kind: 'renderSetting', param: 'lightPower' },
    { kind: 'renderSetting', param: 'depthColorPower' },
    { kind: 'renderSetting', param: 'gamma' },
  ],
  fullSpectrum: [
    { kind: 'renderSetting', param: 'depthColorPower' },
    { kind: 'renderSetting', param: 'vibrancy' },
    { kind: 'renderSetting', param: 'exposure' },
  ],
  rms: [
    { kind: 'renderSetting', param: 'vibrancy' },
    { kind: 'renderSetting', param: 'zoom' },
    { kind: 'renderSetting', param: 'exposure' },
  ],
  centroid: [
    { kind: 'renderSetting', param: 'palettePhase' },
    { kind: 'renderSetting', param: 'paletteSpeed' },
  ],
  flatness: [
    { kind: 'renderSetting', param: 'contrast' },
    { kind: 'renderSetting', param: 'gamma' },
    { kind: 'renderSetting', param: 'exposure' },
  ],
  beat: [
    { kind: 'renderSetting', param: 'zoom' },
    { kind: 'renderSetting', param: 'skipIters' },
    { kind: 'renderSetting', param: 'highlightPower' },
    { kind: 'renderSetting', param: 'contrast' },
  ],
  onset: [
    { kind: 'renderSetting', param: 'contrast' },
    { kind: 'renderSetting', param: 'zoom' },
    { kind: 'renderSetting', param: 'gamma' },
  ],
}

const MIN_DRAG_DISTANCE = 3

// ── Helpers ──

function entryToWire(m: AudioMappingEntry): WireConnection {
  return { sourceFeature: m.audioFeature, target: m.target }
}

/** Stable string key for sorting/comparing preset entries. */
function entryStableKey(m: AudioMappingEntry): string {
  return wireId(entryToWire(m))
}

/** Compare two mapping arrays for equality (order-independent). */
function mappingsEqual(
  a: AudioMappingEntry[],
  b: AudioMappingEntry[],
): boolean {
  if (a.length !== b.length) return false
  const aSorted = [...a].sort((x, y) =>
    entryStableKey(x).localeCompare(entryStableKey(y)),
  )
  const bSorted = [...b].sort((x, y) =>
    entryStableKey(x).localeCompare(entryStableKey(y)),
  )
  return aSorted.every((entry, i) => {
    const b = bSorted[i]!
    return (
      entryStableKey(entry) === entryStableKey(b) &&
      entry.sensitivity === b.sensitivity &&
      entry.range[0] === b.range[0] &&
      entry.range[1] === b.range[1] &&
      (entry.attackMs ?? NEW_ENTRY_DEFAULTS.attackMs) ===
        (b.attackMs ?? NEW_ENTRY_DEFAULTS.attackMs) &&
      (entry.releaseMs ?? NEW_ENTRY_DEFAULTS.releaseMs) ===
        (b.releaseMs ?? NEW_ENTRY_DEFAULTS.releaseMs)
    )
  })
}

// ── Component ──

export function AudioWiringModal(props: {
  mappings: AudioMappingEntry[]
  transforms: TransformInfo[]
  onMappingsChange: (mappings: AudioMappingEntry[]) => void
  presets?: Record<string, AudioMappingEntry[]>
  featureLevels?: Record<string, number>
  onClose: () => void
}) {
  const [connectingFrom, setConnectingFrom] = createSignal<AudioFeature | null>(
    null,
  )
  const [selectedWire, setSelectedWire] = createSignal<string | null>(null)
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(
    new Set(['render', 'finalAffine']),
  )
  const [searchQuery, setSearchQuery] = createSignal('')
  const [previousMappings, setPreviousMappings] =
    createSignal<AudioMappingEntry[] | null>(null)
  const [copiedWiring, setCopiedWiring] =
    createSignal<{ audioFeature: AudioFeature; target: FlameTarget }[] | null>(null)
  const [pendingPaste, setPendingPaste] =
    createSignal<{ transformIdx: number } | null>(null)
  const [hoveredWireId, setHoveredWireId] = createSignal<string | null>(null)
  const [replaceToast, setReplaceToast] =
    createSignal<{ sourceLabel: string; targetKey: string } | null>(null)
  const [containerRef, setContainerRef] = createSignal<HTMLElement | null>(null)

  // ── Drag state ──
  const [dragFrom, setDragFrom] = createSignal<AudioFeature | null>(null)
  const [dragFromTarget, setDragFromTarget] = createSignal<FlameTarget | null>(
    null,
  )
  const [dragPos, setDragPos] = createSignal<{ x: number; y: number } | null>(
    null,
  )
  const [dragStartPos, setDragStartPos] = createSignal<{
    x: number
    y: number
  } | null>(null)
  const [hoveredDropKey, setHoveredDropKey] = createSignal<string | null>(null)

  const presets = () => props.presets ?? DEFAULT_PRESETS

  const targetGroups = createMemo(() => buildTargetGroups(props.transforms))

  const filteredGroups = createMemo(() => {
    const q = searchQuery().toLowerCase().trim()
    const groups = targetGroups()
    if (!q) return groups
    return groups
      .map((group) => {
        const matchedSubGroups = group.subGroups
          .map((sg) => ({
            ...sg,
            targets: sg.targets.filter(
              (t) =>
                t.paramLabel.toLowerCase().includes(q) ||
                t.label.toLowerCase().includes(q),
            ),
          }))
          .filter((sg) => sg.targets.length > 0)
        return { ...group, subGroups: matchedSubGroups }
      })
      .filter((g) => g.subGroups.length > 0)
  })

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

  // ── Target lookup maps ──
  const targetByKey = createMemo(() => {
    const map = new Map<string, FlameTarget>()
    for (const g of targetGroups()) {
      for (const sg of g.subGroups) {
        for (const t of sg.targets) {
          map.set(flameTargetKey(t.target), t.target)
        }
      }
    }
    return map
  })

  /** Human-readable label for each target key (used in banner text). */
  const targetLabelByKey = createMemo(() => {
    const map = new Map<string, string>()
    for (const g of targetGroups()) {
      for (const sg of g.subGroups) {
        for (const t of sg.targets) {
          map.set(flameTargetKey(t.target), t.label)
        }
      }
    }
    return map
  })

  // Highlighted wire — tracking which ports to glow on hover
  const highlightedSource = createMemo((): AudioFeature | null => {
    const id = hoveredWireId()
    if (!id) return null
    const conn = connections().find((c) => wireId(c) === id)
    return conn?.sourceFeature ?? null
  })

  const highlightedTargetKey = createMemo((): string | null => {
    const id = hoveredWireId()
    if (!id) return null
    const conn = connections().find((c) => wireId(c) === id)
    return conn ? flameTargetKey(conn.target) : null
  })

  // Selected mapping entry for the bottom parameter panel
  const selectedEntry = createMemo((): AudioMappingEntry | null => {
    const id = selectedWire()
    if (!id) return null
    return props.mappings.find((m) => wireId(entryToWire(m)) === id) ?? null
  })

  // ── Connection handlers ──

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
      saveForUndo()
      const oldLabel = getSourceLabel(existingWire.sourceFeature)
      next = next.filter((m) => flameTargetKey(m.target) !== tgtKey)
      // Show replacement toast
      setReplaceToast({ sourceLabel: oldLabel, targetKey: tgtKey })
      setTimeout(() => setReplaceToast(null), 2500)
    }

    const isZoom = target.kind === 'renderSetting' && target.param === 'zoom'

    const newEntry: AudioMappingEntry = {
      audioFeature: source,
      target,
      sensitivity: NEW_ENTRY_DEFAULTS.sensitivity,
      range: isZoom
        ? [...NEW_ENTRY_DEFAULTS.zoomRange]
        : [...NEW_ENTRY_DEFAULTS.range],
      attackMs: NEW_ENTRY_DEFAULTS.attackMs,
      releaseMs: NEW_ENTRY_DEFAULTS.releaseMs,
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

  function saveForUndo() {
    if (previousMappings() === null) {
      setPreviousMappings(props.mappings)
    }
  }

  function undo() {
    const prev = previousMappings()
    if (prev) {
      props.onMappingsChange(prev)
      setPreviousMappings(null)
      setSelectedWire(null)
    }
  }

  function handleDeleteWire(wireIdToDelete: string) {
    saveForUndo()
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

  // ── Drag handlers ──

  function handleDragStart(feature: AudioFeature, e: MouseEvent) {
    setDragFrom(feature)
    setDragFromTarget(null)
    setConnectingFrom(null)
    setSelectedWire(null)
    setDragStartPos({ x: e.clientX, y: e.clientY })
  }

  function handleTargetDragStart(target: FlameTarget, e: MouseEvent) {
    setDragFromTarget(target)
    setDragFrom(null)
    setConnectingFrom(null)
    setSelectedWire(null)
    setDragStartPos({ x: e.clientX, y: e.clientY })
  }

  function handleMouseMove(e: MouseEvent) {
    if ((!dragFrom() && !dragFromTarget()) || !containerRef()) return
    const rect = containerRef()!.getBoundingClientRect()
    setDragPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })

    // Detect port under cursor for drop target highlighting
    const elUnder = document.elementFromPoint(
      e.clientX,
      e.clientY,
    ) as HTMLElement | null
    if (dragFrom()) {
      // Source → Target: look for target port
      const targetPort = elUnder?.closest('[data-target-port]') as HTMLElement | null
      setHoveredDropKey(targetPort?.getAttribute('data-target-port') ?? null)
    } else if (dragFromTarget()) {
      // Target → Source: look for source port
      const sourcePort = elUnder?.closest('[data-source-port]') as HTMLElement | null
      setHoveredDropKey(sourcePort?.getAttribute('data-source-port') ?? null)
    }
  }

  function handleMouseUp(e: MouseEvent) {
    const source = dragFrom()
    const target = dragFromTarget()
    const startPos = dragStartPos()

    if (!source && !target) return

    // Check minimum drag distance
    if (startPos) {
      const dx = e.clientX - startPos.x
      const dy = e.clientY - startPos.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < MIN_DRAG_DISTANCE) {
        // Too short — treat as a click, don't complete connection
        setDragFrom(null)
        setDragFromTarget(null)
        setDragPos(null)
        setDragStartPos(null)
        return
      }
    }

    // Temporarily disable pointer-events on SVG wires for elementFromPoint
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
    setDragStartPos(null)
    setHoveredDropKey(null)
  }

  // ── Click on overlay background ──

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      setConnectingFrom(null)
      setSelectedWire(null)
      setPendingPaste(null)
    }
  }

  // ── Keyboard ──

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (pendingPaste()) {
        setPendingPaste(null)
      } else if (dragFrom()) {
        setDragFrom(null)
        setDragPos(null)
        setDragStartPos(null)
        setHoveredDropKey(null)
      } else if (dragFromTarget()) {
        setDragFromTarget(null)
        setDragPos(null)
        setDragStartPos(null)
        setHoveredDropKey(null)
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

  // ── Collapsible groups ──

  function toggleGroup(kind: string) {
    const next = new Set(expandedGroups())
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    setExpandedGroups(next)
  }

  function expandAll() {
    setExpandedGroups(new Set(targetGroups().map((g) => g.kind)))
  }

  function collapseAll() {
    setExpandedGroups(new Set<string>())
  }

  function copyWiring(transformIdx: number) {
    const entries = props.mappings.filter((m) => {
      const tgt = m.target
      return (
        (tgt.kind === 'transformAffine' && tgt.transformIdx === transformIdx) ||
        (tgt.kind === 'transformProperty' && tgt.transformIdx === transformIdx) ||
        (tgt.kind === 'variationWeight' && tgt.transformIdx === transformIdx)
      )
    })
    setCopiedWiring(entries.map((e) => ({ audioFeature: e.audioFeature, target: e.target })))
  }

  function pasteWiring(transformIdx: number) {
    const wiring = copiedWiring()
    if (!wiring || wiring.length === 0) return

    // Check if target transform already has connections → require confirmation
    const hasExisting = props.mappings.some(
      (m) =>
        m.target.kind !== 'renderSetting' &&
        m.target.kind !== 'finalAffine' &&
        (m.target as { transformIdx?: number }).transformIdx === transformIdx,
    )

    if (hasExisting) {
      const pending = pendingPaste()
      if (pending?.transformIdx !== transformIdx) {
        setPendingPaste({ transformIdx })
        return
      }
      setPendingPaste(null)
    }

    saveForUndo()
    for (const entry of wiring) {
      const newTarget = { ...entry.target, transformIdx } as FlameTarget
      doConnect(entry.audioFeature, newTarget)
    }
  }

  function randomizeWiring() {
    saveForUndo()
    const sources = ALL_SOURCES.map((s) => s.feature)
    // Pick 5-9 random sources
    const count = 5 + Math.floor(Math.random() * 5)
    const shuffled = [...sources].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, count)

    const entries: AudioMappingEntry[] = []
    for (const source of selected) {
      const pool = [...(RANDOMIZE_TARGET_POOLS[source] ?? [])]

      // Add a few transform targets when transforms exist
      if (props.transforms.length > 0) {
        const txIdx = Math.floor(Math.random() * props.transforms.length)
        pool.push(
          { kind: 'transformAffine' as const, transformIdx: txIdx, matrix: 'preAffine', param: 'a' },
          { kind: 'transformAffine' as const, transformIdx: txIdx, matrix: 'preAffine', param: 'd' },
          { kind: 'transformProperty' as const, transformIdx: txIdx, property: 'probability' },
        )
        if (props.transforms[txIdx]!.variations.length > 0) {
          const v = props.transforms[txIdx]!.variations[
            Math.floor(Math.random() * props.transforms[txIdx]!.variations.length)
          ]!
          pool.push({ kind: 'variationWeight' as const, transformIdx: txIdx, variationType: v.type })
        }
      }

      // Pick 1-2 targets from the pool
      const tgtCount = 1 + Math.floor(Math.random() * 2)
      const tgtShuffled = [...pool].sort(() => Math.random() - 0.5)
      for (let i = 0; i < Math.min(tgtCount, tgtShuffled.length); i++) {
        const target = tgtShuffled[i]!
        const isZoom = target.kind === 'renderSetting' && target.param === 'zoom'
        entries.push({
          audioFeature: source,
          target,
          sensitivity: Math.round((0.2 + Math.random() * 0.5) * 100) / 100,
          range: isZoom
            ? [0.95 + Math.random() * 0.1, 1.15 + Math.random() * 0.2]
            : [0.3 + Math.random() * 0.4, 1.3 + Math.random() * 0.9],
          attackMs: 5 + Math.floor(Math.random() * 60),
          releaseMs: 100 + Math.floor(Math.random() * 250),
        })
      }
    }
    props.onMappingsChange(entries)
    setSelectedWire(null)
    setConnectingFrom(null)
  }

  // ── Lifecycle ──

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

  // ── Active preset detection (full comparison) ──

  const activePreset = createMemo(() => {
    for (const [name, entries] of Object.entries(presets())) {
      if (mappingsEqual(props.mappings, entries)) return name
    }
    return ''
  })

  // ── Helpers ──

  function getSourceLabel(feature: AudioFeature): string {
    return SOURCE_BY_FEATURE.get(feature)?.label ?? feature
  }

  function getTargetLabel(target: FlameTarget): string {
    return (
      targetLabelByKey().get(flameTargetKey(target)) ?? flameTargetKey(target)
    )
  }

  // ── Render ──

  function renderTargetGroup(
    group: TargetGroupData,
    selTgtKey: string | null,
    connectingFromFeature: AudioFeature | null,
    dragFromFeature: AudioFeature | null,
    hoveredDropKey: string | null,
    highlightedTgtKey: string | null,
    connByTarget: Map<string, { sourceFeature: AudioFeature }>,
    onComplete: (target: FlameTarget) => void,
    onTargetDragStart: (target: FlameTarget, e: MouseEvent) => void,
  ) {
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
      const isDropTarget = !!dragFromFeature && hoveredDropKey === key

      return (
        <AffineCell
          label={`${matrixLabel}.${node.paramLabel}`}
          target={node.target}
          isConnecting={isConnectingGlobal}
          isTargetOfSelectedWire={isTargetOfSelected}
          isDropTarget={isDropTarget}
          isHighlighted={highlightedTgtKey === key}
          connectedSourceLabel={connectedSourceLabel}
          onCompleteConnection={onComplete}
          onDragStart={onTargetDragStart}
        />
      )
    }

    function renderTargetCell(node: {
      target: FlameTarget
      label: string
      paramLabel: string
    }) {
      const key = flameTargetKey(node.target)
      const conn = connByTarget.get(key)
      const connectedSourceLabel = conn
        ? getSourceLabel(conn.sourceFeature)
        : undefined
      const isTargetOfSelected = selTgtKey === key
      const isDropTarget = !!dragFromFeature && hoveredDropKey === key

      return (
        <TargetCell
          node={node}
          isConnecting={isConnectingGlobal}
          isTargetOfSelectedWire={isTargetOfSelected}
          isDropTarget={isDropTarget}
          isHighlighted={highlightedTgtKey === key}
          connectedSourceLabel={connectedSourceLabel}
          onCompleteConnection={onComplete}
          onDragStart={onTargetDragStart}
        />
      )
    }

    return group.subGroups.map((sg) => {
      if (sg.compact) {
        return (
          <div class={styles.affineBlock}>
            {sg.label && <div class={styles.subSectionLabel}>{sg.label}</div>}
            {sg.targets.map((node) => renderAffineCell(node, sg.label))}
          </div>
        )
      }
      return (
        <>
          {sg.label && <div class={styles.subSectionLabel}>{sg.label}</div>}
          {sg.targets.map(renderTargetCell)}
        </>
      )
    })
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
                  saveForUndo()
                  props.onMappingsChange(entries)
                  setSelectedWire(null)
                  setConnectingFrom(null)
                }
              }}
            >
              {name === 'clear'
                ? 'Clear'
                : name
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
        <Show when={previousMappings() !== null}>
          <button type="button" class={styles.undoBtn} onClick={undo}>
            Undo
          </button>
        </Show>
        <button type="button" class={styles.randomBtn} onClick={randomizeWiring}>
          Randomize
        </button>
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
                const isDropTarget =
                  dragFromTarget() !== null &&
                  hoveredDropKey() === source.feature
                return (
                  <SourceNode
                    source={source}
                    level={
                      props.featureLevels?.[source.feature] ?? 0.3
                    }
                    connectionCount={sourceConns.length}
                    isConnecting={isConnecting || isDragging || isTargetDrag}
                    isSourceOfSelectedWire={isSourceOfSelected}
                    isDropTarget={isDropTarget}
                    isHighlighted={highlightedSource() === source.feature}
                    onStartConnection={startConnection}
                    onDragStart={handleDragStart}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Targets column — using .map() for expandedGroups() reactivity */}
        <div class={styles.targetsColumn}>
          <div class={styles.columnLabel}>Flame Parameters</div>
          <input
            type="text"
            class={styles.searchInput}
            placeholder="Filter targets..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <div class={styles.expandRow}>
            <button
              type="button"
              class={styles.expandBtn}
              onClick={expandAll}
            >
              Expand All
            </button>
            <button
              type="button"
              class={styles.expandBtn}
              onClick={collapseAll}
            >
              Collapse All
            </button>
          </div>
          <Show when={filteredGroups().length === 0}>
            <div class={styles.emptyState}>
              <span class={styles.emptyStateIcon}>🔊</span>
              <span class={styles.emptyStateText}>
                {targetGroups().length === 0
                  ? 'No flame parameters available. Load a fractal to start wiring audio sources to render targets.'
                  : 'No targets match your search.'}
              </span>
            </div>
          </Show>
          {filteredGroups().map((group) => {
            const isOpen =
              searchQuery() !== '' || expandedGroups().has(group.kind)
            const selEntry = selectedEntry()
            const selTgtKey = selEntry ? flameTargetKey(selEntry.target) : null

            const groupConnCount = group.subGroups.reduce(
              (sum, sg) =>
                sum +
                sg.targets.filter((t) =>
                  connectionByTarget().has(flameTargetKey(t.target)),
                ).length,
              0,
            )

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
                    {groupConnCount > 0 && (
                      <span class={styles.groupConnCount}>{groupConnCount}</span>
                    )}
                  </span>
                  {group.kind.startsWith('tx-') && (
                    <>
                      <button
                        type="button"
                        class={styles.copyBtn}
                        onClick={(e) => {
                          e.stopPropagation()
                          copyWiring(parseInt(group.kind.slice(3), 10))
                        }}
                        title="Copy wiring from this transform"
                      >
                        Copy
                      </button>
                      <Show when={copiedWiring() !== null && copiedWiring()!.length > 0}>
                        <button
                          type="button"
                          class={styles.pasteBtn}
                          classList={{
                            [styles.pasteBtnConfirm as string]:
                              pendingPaste()?.transformIdx ===
                              parseInt(group.kind.slice(3), 10),
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            pasteWiring(parseInt(group.kind.slice(3), 10))
                          }}
                          title={
                            pendingPaste()?.transformIdx ===
                            parseInt(group.kind.slice(3), 10)
                              ? 'Click again to overwrite existing connections'
                              : 'Paste wiring to this transform'
                          }
                        >
                          {pendingPaste()?.transformIdx ===
                          parseInt(group.kind.slice(3), 10)
                            ? 'Confirm Paste'
                            : 'Paste'}
                        </button>
                      </Show>
                    </>
                  )}
                </div>
                <Show when={isOpen}>
                  <div class={styles.targetGroupContent}>
                    {renderTargetGroup(
                      group,
                      selTgtKey,
                      connectingFrom(),
                      dragFrom(),
                      hoveredDropKey(),
                      highlightedTargetKey(),
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
          sourceColorMap={SOURCE_COLOR_MAP}
          onSelectWire={(id) => {
            setSelectedWire(id)
            setConnectingFrom(null)
          }}
          onDeleteWire={handleDeleteWire}
          onHoverWire={setHoveredWireId}
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
            {getTargetLabel(dragFromTarget()!)}
          </div>
        </Show>

        <Show when={replaceToast()}>
          {(toast) => (
            <div class={styles.replaceToast}>
              Replaced {toast().sourceLabel} → {toast().targetKey}
            </div>
          )}
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
              Drag ports to wire · Click wire to select · Click again or press
              Del to disconnect · Right-click wire to delete
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
                      value={entry().attackMs ?? NEW_ENTRY_DEFAULTS.attackMs}
                      onInput={(e) => {
                        updateSelectedEntry({
                          attackMs: parseInt(e.currentTarget.value, 10),
                        })
                      }}
                    />
                    <span class={styles.paramsValue}>
                      {entry().attackMs ?? NEW_ENTRY_DEFAULTS.attackMs}ms
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
                      value={entry().releaseMs ?? NEW_ENTRY_DEFAULTS.releaseMs}
                      onInput={(e) => {
                        updateSelectedEntry({
                          releaseMs: parseInt(e.currentTarget.value, 10),
                        })
                      }}
                    />
                    <span class={styles.paramsValue}>
                      {entry().releaseMs ?? NEW_ENTRY_DEFAULTS.releaseMs}ms
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
