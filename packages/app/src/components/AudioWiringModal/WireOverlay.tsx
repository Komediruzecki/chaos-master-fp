import { createMemo, onCleanup } from 'solid-js'
import type { AudioFeature, FlameTarget } from '../../utils/audioAnalysis'
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
 * Resolves source port center relative to the overlay container.
 */
function getPortCenter(
  container: HTMLElement,
  sourceFeature: AudioFeature,
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

/**
 * Resolves target port center relative to the overlay container.
 */
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

function getSourceColor(
  source: AudioFeature,
  sources: SourceNodeData[],
): string {
  return sources.find((s) => s.feature === source)?.color ?? '#888'
}

export function WireOverlay(props: {
  connections: WireConnection[]
  selectedWire: string | null
  connectingFrom: AudioFeature | null
  /** Drag wire: source port is being dragged from */
  dragFrom: AudioFeature | null
  /** Drag wire: current mouse position relative to container */
  dragPos: { x: number; y: number } | null
  containerRef: HTMLElement | null
  sources: SourceNodeData[]
  onSelectWire: (id: string | null) => void
}) {
  const wirePaths = createMemo(() => {
    if (!props.containerRef) return []
    return props.connections.map((conn) => {
      const srcPos = getPortCenter(props.containerRef!, conn.sourceFeature)
      const tgtPos = getTargetPortCenter(props.containerRef!, conn.target)
      if (!srcPos || !tgtPos) return null
      const color = getSourceColor(conn.sourceFeature, props.sources)
      const id = wireId(conn)
      const selected = id === props.selectedWire
      const dx = Math.max(60, Math.abs(tgtPos.x - srcPos.x) * 0.5)
      const d = `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tgtPos.x - dx} ${tgtPos.y}, ${tgtPos.x} ${tgtPos.y}`
      return { id, d, color, selected }
    })
  })

  /** Preview wire from click-to-connect mode (shows from source going right) */
  const clickPreviewWire = createMemo(() => {
    if (!props.containerRef || !props.connectingFrom) return null
    const srcPos = getPortCenter(props.containerRef!, props.connectingFrom)
    if (!srcPos) return null
    const color = getSourceColor(props.connectingFrom, props.sources)
    const dx = 80
    const tx = srcPos.x + dx * 2
    const ty = srcPos.y - 30
    return {
      d: `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tx} ${ty}, ${tx} ${ty}`,
      color,
    }
  })

  /** Preview wire from drag mode (follows mouse cursor) */
  const dragPreviewWire = createMemo(() => {
    if (!props.containerRef || !props.dragFrom || !props.dragPos) return null
    const srcPos = getPortCenter(props.containerRef!, props.dragFrom)
    if (!srcPos) return null
    const color = getSourceColor(props.dragFrom, props.sources)
    const { x: tx, y: ty } = props.dragPos
    const dx = Math.max(60, Math.abs(tx - srcPos.x) * 0.5)
    const d = `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tx - dx} ${ty}, ${tx} ${ty}`
    return { d, color }
  })

  // Poll for port position updates on animation frame (scroll / resize)
  let rafId: number | undefined
  const tick = () => {
    void props.containerRef
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
  })

  return (
    <svg class={styles.wireSvg}>
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
      {/* Preview from click-to-connect */}
      {clickPreviewWire() && (
        <path
          d={clickPreviewWire()!.d}
          class={styles.wirePreview}
          style={{ stroke: clickPreviewWire()!.color }}
        />
      )}
      {/* Preview from drag */}
      {dragPreviewWire() && (
        <path
          d={dragPreviewWire()!.d}
          class={styles.wirePreview}
          style={{ stroke: dragPreviewWire()!.color }}
        />
      )}
    </svg>
  )
}
