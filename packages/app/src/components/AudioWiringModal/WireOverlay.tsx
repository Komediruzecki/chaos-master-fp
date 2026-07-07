import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { AudioFeature, FlameTarget } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import styles from './AudioWiringModal.module.css'

export type WireConnection = {
  sourceFeature: AudioFeature
  target: FlameTarget
}

export function wireId(conn: WireConnection): string {
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

export function WireOverlay(props: {
  connections: WireConnection[]
  selectedWire: string | null
  connectingFrom: AudioFeature | null
  /** Drag wire: source port is being dragged from */
  dragFrom: AudioFeature | null
  /** Drag wire: target port is being dragged from (reverse direction) */
  dragFromTarget: FlameTarget | null
  /** Drag wire: current mouse position relative to container */
  dragPos: { x: number; y: number } | null
  containerRef: HTMLElement | null
  sourceColorMap: Map<AudioFeature, string>
  onSelectWire: (id: string | null) => void
  onDeleteWire: (id: string) => void
}) {
  // Layout version — bumped on resize/scroll/drag so memos recalculate
  const [layoutVersion, setLayoutVersion] = createSignal(0)

  onMount(() => {
    const container = props.containerRef
    if (!container) return

    // ResizeObserver: fires when container size changes
    const ro = new ResizeObserver(() => setLayoutVersion((v) => v + 1))
    ro.observe(container)

    // Scroll listener on both scrollable columns
    const onScroll = () => setLayoutVersion((v) => v + 1)
    const targetsCol = container.querySelector('[class*="targetsColumn"]')
    const sourcesCol = container.querySelector('[class*="sourcesColumn"]')
    if (targetsCol) {
      targetsCol.addEventListener('scroll', onScroll, { passive: true })
    }
    if (sourcesCol) {
      sourcesCol.addEventListener('scroll', onScroll, { passive: true })
    }

    // RAF only bumps layoutVersion when actively dragging (dragPos changes)
    let rafId: number
    const tick = () => {
      if (props.dragPos) setLayoutVersion((v) => v + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    onCleanup(() => {
      ro.disconnect()
      if (targetsCol) targetsCol.removeEventListener('scroll', onScroll)
      if (sourcesCol) sourcesCol.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(rafId)
    })
  })

  const wirePaths = createMemo(() => {
    void layoutVersion()
    if (!props.containerRef) return []
    return props.connections.map((conn) => {
      const srcPos = getPortCenter(props.containerRef!, conn.sourceFeature)
      const tgtPos = getTargetPortCenter(props.containerRef!, conn.target)
      if (!srcPos || !tgtPos) return null
      const color = props.sourceColorMap.get(conn.sourceFeature) ?? '#888'
      const id = wireId(conn)
      const selected = id === props.selectedWire
      const dx = Math.max(60, Math.abs(tgtPos.x - srcPos.x) * 0.5)
      const d = `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tgtPos.x - dx} ${tgtPos.y}, ${tgtPos.x} ${tgtPos.y}`
      return { id, d, color, selected }
    })
  })

  /** Preview wire from click-to-connect mode (follows cursor when available). */
  const clickPreviewWire = createMemo(() => {
    void layoutVersion()
    if (!props.containerRef || !props.connectingFrom) return null
    const srcPos = getPortCenter(props.containerRef!, props.connectingFrom)
    if (!srcPos) return null
    const color = props.sourceColorMap.get(props.connectingFrom) ?? '#888'
    // Follow mouse position if available, otherwise extend to the right
    const tx = props.dragPos?.x ?? srcPos.x + 160
    const ty = props.dragPos?.y ?? srcPos.y - 30
    const dx = Math.max(60, Math.abs(tx - srcPos.x) * 0.5)
    return {
      d: `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tx - dx} ${ty}, ${tx} ${ty}`,
      color,
    }
  })

  /** Preview wire from drag mode (follows mouse cursor). */
  const dragPreviewWire = createMemo(() => {
    void layoutVersion()
    if (!props.containerRef || !props.dragPos) return null
    // Source → cursor drag
    if (props.dragFrom) {
      const srcPos = getPortCenter(props.containerRef!, props.dragFrom)
      if (!srcPos) return null
      const color = props.sourceColorMap.get(props.dragFrom) ?? '#888'
      const { x: tx, y: ty } = props.dragPos
      const dx = Math.max(60, Math.abs(tx - srcPos.x) * 0.5)
      return {
        d: `M ${srcPos.x} ${srcPos.y} C ${srcPos.x + dx} ${srcPos.y}, ${tx - dx} ${ty}, ${tx} ${ty}`,
        color,
      }
    }
    // Target → cursor drag
    if (props.dragFromTarget) {
      const tgtPos = getTargetPortCenter(
        props.containerRef!,
        props.dragFromTarget,
      )
      if (!tgtPos) return null
      const color = '#f59e0b' // amber for target-initiated drags
      const { x: tx, y: ty } = props.dragPos
      const dx = Math.max(60, Math.abs(tx - tgtPos.x) * 0.5)
      return {
        d: `M ${tgtPos.x} ${tgtPos.y} C ${tgtPos.x - dx} ${tgtPos.y}, ${tx + dx} ${ty}, ${tx} ${ty}`,
        color,
      }
    }
    return null
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
                if (wp.selected) {
                  props.onDeleteWire(wp.id)
                } else {
                  props.onSelectWire(wp.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                props.onDeleteWire(wp.id)
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
