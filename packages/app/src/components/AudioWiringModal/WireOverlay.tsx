import { createMemo, onCleanup } from 'solid-js'
import type { AudioFeature, AudioMappingEntry, FlameTarget, } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import type { SourceNodeData } from './SourceNode'
import styles from './AudioWiringModal.module.css'

export type WireConnection = {
  sourceFeature: AudioFeature
  target: FlameTarget
}

function wireId(conn: WireConnection): string {
  return `${conn.sourceFeature}->${flameTargetKey(conn.target)}`
}

/**
 * Resolves port element positions relative to the overlay container.
 * Ports are identified by data-source-port and data-target-port attributes.
 */
function getPortCenter(
  container: HTMLElement,
  sourceFeature: AudioFeature,
  sourceColorMap: Map<AudioFeature, string>,
): { x: number; y: number } | null {
  const el = container.querySelector(
    `[data-source-port="${sourceFeature}"]`,
  ) as HTMLElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return {
    x: rect.right - containerRect.left,
    y: rect.top + rect.height / 2 - containerRect.top,
  }
}

function getTargetPortCenter(
  container: HTMLElement,
  target: FlameTarget,
): { x: number; y: number } | null {
  const key = flameTargetKey(target)
  const el = container.querySelector(
    `[data-target-port="${key}"]`,
  ) as HTMLElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return {
    x: rect.left - containerRect.left,
    y: rect.top + rect.height / 2 - containerRect.top,
  }
}

/**
 * Returns the group label for a source feature.
 */
function getSourceColor(
  source: AudioFeature,
  sources: SourceNodeData[],
): string {
  return sources.find((s) => s.feature === source)?.color ?? '#888'
}

function getSourceLabel(
  source: AudioFeature,
  sources: SourceNodeData[],
): string {
  return sources.find((s) => s.feature === source)?.label ?? source
}

export function WireOverlay(props: {
  connections: WireConnection[]
  selectedWire: string | null
  connectingFrom: AudioFeature | null
  containerRef: HTMLElement | null
  sources: SourceNodeData[]
  onSelectWire: (id: string | null) => void
}) {
  // Build a set for quick lookup
  const connectionSet = createMemo(() => {
    const set = new Set<string>()
    for (const c of props.connections) set.add(wireId(c))
    return set
  })

  const wirePaths = createMemo(() => {
    if (!props.containerRef) return []
    return props.connections.map((conn) => {
      const srcPos = getPortCenter(
        props.containerRef!,
        conn.sourceFeature,
        new Map(),
      )
      const tgtPos = getTargetPortCenter(props.containerRef!, conn.target)
      if (!srcPos || !tgtPos) return null
      const color = getSourceColor(conn.sourceFeature, props.sources)
      const id = wireId(conn)
      const selected = id === props.selectedWire
      const dx = Math.abs(tgtPos.x - srcPos.x) * 0.5
      const d = `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tgtPos.x - dx} ${tgtPos.y}, ${tgtPos.x} ${tgtPos.y}`
      return { id, d, color, selected }
    })
  })

  const previewWire = createMemo(() => {
    if (!props.containerRef || !props.connectingFrom) return null
    const srcPos = getPortCenter(
      props.containerRef!,
      props.connectingFrom,
      new Map(),
    )
    if (!srcPos) return null
    const color = getSourceColor(props.connectingFrom, props.sources)
    // Preview goes slightly right from source (no target pos until clicked)
    const dx = 80
    return {
      d: `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${srcPos.x + dx * 2} ${srcPos.y - 30}, ${srcPos.x + dx * 2} ${srcPos.y - 30}`,
      color,
    }
  })

  // Poll for port position updates on animation frame
  let rafId: number | undefined
  const tick = () => {
    // Re-read positions - trigger reactivity by touching containerRef
    void props.containerRef
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
  })

  return (
    <svg class={styles.wireSvg}>
      {/* Existing connections */}
      {wirePaths().map(
        (wp) =>
          wp && (
            <path
              d={wp.d}
              class={styles.wirePath}
              classList={{
                [styles.wirePathSelected as string]: wp.selected,
              }}
              style={{ stroke: wp.color, color: wp.color }}
              data-wire-id={wp.id}
              onClick={(e) => {
                e.stopPropagation()
                props.onSelectWire(wp.id)
              }}
            />
          ),
      )}
      {/* Preview wire while connecting */}
      {previewWire() && (
        <path
          d={previewWire()!.d}
          class={styles.wirePreview}
          style={{ stroke: previewWire()!.color }}
        />
      )}
    </svg>
  )
}
