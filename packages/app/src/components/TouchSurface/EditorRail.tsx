import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { CameraIcon, ColourWedge, ShapeTriangle, Shuffle, VariationSpiral, } from '@/icons'
import { haptic } from '@/lib/haptics'
import { clampSheetHeight, detentHeights, heightOf, nearestDetent, PEEK_HEIGHT, settleDetent, } from './detents'
import ui from './EditorRail.module.css'
import { createLongPress } from './longPress'
import { TouchControlSurface } from './TouchControlSurface'
import type { JSX } from 'solid-js'
import type { Detent } from './detents'
import type { EditorRailProps, TouchTab } from './types'

const CHIPS: readonly {
  readonly tab: TouchTab
  readonly label: string
  readonly Icon: (props: { class?: string }) => JSX.Element
}[] = [
  { tab: 'variations', label: 'Variations', Icon: VariationSpiral },
  { tab: 'shape', label: 'Shape', Icon: ShapeTriangle },
  { tab: 'colour', label: 'Colour', Icon: ColourWedge },
  { tab: 'vary', label: 'Vary', Icon: Shuffle },
]

/**
 * The visual viewport, so an open keyboard shrinks the sheet with it rather
 * than pushing it off screen.
 */
function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

/**
 * One surface at the bottom of the editor at three detents (detents.ts), and
 * the only place a phone reaches its tools from. It is never dismissed: peek
 * is the floor, so the chips and the shutter are always one tap away.
 */
export function EditorRail(props: EditorRailProps) {
  const [detent, setDetent] = createSignal<Detent>('peek')
  const [tab, setTab] = createSignal<TouchTab>('variations')
  const [vh, setVh] = createSignal(viewportHeight())
  const [dragHeight, setDragHeight] = createSignal<number | null>(null)
  const heights = createMemo(() => detentHeights(vh()))
  const sheetHeight = () => dragHeight() ?? heightOf(detent(), heights())

  onMount(() => {
    const onResize = () => setVh(viewportHeight())
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    onCleanup(() => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    })
  })

  function settle(target: Detent) {
    if (target !== detent()) {
      setDetent(target)
      haptic.impactLight()
    }
    props.onCoveredHeightChange?.(
      target === 'peek' ? 0 : heightOf(target, heights()) - PEEK_HEIGHT,
    )
  }

  function onChip(next: TouchTab) {
    if (detent() === 'peek') {
      setTab(next)
      settle('medium')
    } else if (next === tab()) {
      settle('peek')
    } else {
      setTab(next)
    }
  }

  // The drag: the sheet tracks the finger 1:1, no easing; velocity in px/ms
  // from the last two samples, positive when the sheet grows.
  let drag: {
    startY: number
    startHeight: number
    lastY: number
    lastT: number
    velocity: number
    lastDetent: Detent
  } | null = null

  function onGrabDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    drag = {
      startY: e.clientY,
      startHeight: sheetHeight(),
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      lastDetent: nearestDetent(sheetHeight(), heights()),
    }
  }

  function onGrabMove(e: PointerEvent) {
    if (!drag) return
    const dt = e.timeStamp - drag.lastT
    // A non-positive delta is not a sample: keep the last velocity rather
    // than dividing by zero.
    if (dt > 0) drag.velocity = (drag.lastY - e.clientY) / dt
    drag.lastY = e.clientY
    drag.lastT = e.timeStamp
    const h = clampSheetHeight(
      drag.startHeight + (drag.startY - e.clientY),
      heights(),
    )
    const crossed = nearestDetent(h, heights())
    if (crossed !== drag.lastDetent) {
      haptic.selectionChanged()
      drag.lastDetent = crossed
    }
    setDragHeight(h)
  }

  function onGrabUp() {
    if (!drag) return
    const target = settleDetent(sheetHeight(), drag.velocity, heights())
    drag = null
    setDragHeight(null)
    settle(target)
  }

  // The shutter: tap saves, a long press opens the options.
  const shutterHandlers = createLongPress({
    onPressStart: () => {
      haptic.impactLight()
    },
    onTap: () => {
      props.onQuickExport()
    },
    onLongPress: () => {
      props.onOpenExportOptions()
    },
  })

  const grabHandlers = {
    onPointerDown: onGrabDown,
    onPointerMove: onGrabMove,
    onPointerUp: onGrabUp,
    onPointerCancel: onGrabUp,
  }

  return (
    <section class={ui.dock} role="region" aria-label="Editor controls">
      <div
        class={ui.sheet}
        classList={{ [ui.dragging!]: dragHeight() !== null }}
        style={{ height: `${sheetHeight()}px` }}
        data-testid="editor-rail-sheet"
        data-detent={detent()}
      >
        <div
          class={ui.grabberRow}
          data-testid="editor-rail-grabber"
          {...grabHandlers}
        >
          <div class={ui.grabber} />
        </div>
        <div class={ui.peekRow}>
          <div class={ui.dragSurface} {...grabHandlers} />
          <div class={ui.chips} role="tablist" aria-label="Tools">
            <For each={CHIPS}>
              {(chip) => (
                <button
                  type="button"
                  role="tab"
                  class={ui.chip}
                  aria-selected={tab() === chip.tab && detent() !== 'peek'}
                  onPointerDown={() => {
                    haptic.impactLight()
                  }}
                  onClick={() => {
                    onChip(chip.tab)
                  }}
                >
                  <chip.Icon class={ui.chipIcon} />
                  {chip.label}
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            class={ui.shutter}
            aria-label="Save image"
            {...shutterHandlers}
          >
            <CameraIcon class={ui.shutterIcon} />
          </button>
        </div>
        <Show when={detent() !== 'peek'}>
          <div class={ui.body}>
            <TouchControlSurface
              ctx={props.ctx}
              flame={props.flame}
              mode="bottom-sheet"
              tab={tab}
              hideTabRow
              hideFooter
              onRandomize={props.onRandomize}
              onMutate={props.onMutate}
              onOpenDrawer={props.onOpenDrawer}
            />
          </div>
        </Show>
      </div>
    </section>
  )
}
