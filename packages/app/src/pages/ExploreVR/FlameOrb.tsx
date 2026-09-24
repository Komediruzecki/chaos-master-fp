/**
 * One live, orbitable 3D flame for the observatory. The existing studio
 * renderer owns sampling and grading; local camera state never edits a flame
 * or the workspace's history. Only the selected world's canvas is mounted.
 */
import { batch, createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, onMount, Show, } from 'solid-js'
import { vec4f } from 'typegpu/data'
import { ComputeGate, useComputeGate } from '@/contexts/ComputeGateContext'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera3D } from '@/lib/Camera3D'
import { gpuStatus } from '@/lib/gpuStatus'
import { Root } from '@/lib/Root'
import { createDragHandler } from '@/utils/createDragHandler'
import type { OrbPreset } from './orbPresets'

export interface FlameOrbProps {
  preset: OrbPreset
  paused?: boolean
  resetKey?: number
  /** Relative commands from the accessible zoom buttons; increasing zooms in. */
  zoomStep?: number
  class?: string
  onReady?: () => void
  onError?: (message: string) => void
}

export function FlameOrb(props: FlameOrbProps) {
  function failed(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    props.onError?.(message)
    return null
  }

  return (
    <div class={props.class} style={{ width: '100%', height: '100%' }}>
      <ErrorBoundary fallback={failed}>
        <Root adapterOptions={{ powerPreference: 'high-performance' }}>
          <ComputeGate capacity={1}>
            <Show when={props.preset} keyed>
              {(preset) => (
                <LiveOrb
                  preset={preset}
                  paused={props.paused}
                  resetKey={props.resetKey}
                  zoomStep={props.zoomStep}
                  onReady={props.onReady}
                  onError={props.onError}
                />
              )}
            </Show>
          </ComputeGate>
        </Root>
      </ErrorBoundary>
    </div>
  )
}

function LiveOrb(props: FlameOrbProps) {
  const initial = () => props.preset.flame.renderSettings.camera3D
  const [theta, setTheta] = createSignal(initial().theta)
  const [phi, setPhi] = createSignal(initial().phi)
  const [radius, setRadius] = createSignal(initial().radius)
  const [visible, setVisible] = createSignal(true)
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden)
  let canvas: HTMLCanvasElement | undefined
  let readyReported = false
  let disposed = false
  let previousZoomStep = props.zoomStep ?? 0

  createEffect(() => {
    void props.resetKey
    const start = initial()
    batch(() => {
      setTheta(start.theta)
      setPhi(start.phi)
      setRadius(start.radius)
    })
  })

  createEffect(() => {
    const status = gpuStatus()
    if (status === 'unsupported' || status === 'unavailable') {
      props.onError?.(
        'WebGPU is unavailable. Open this page in a supported browser and reload to try again.',
      )
    }
  })

  const allowed = useComputeGate(() => ({
    isVisible: visible() && documentVisible() && !props.paused,
    isSelected: true,
    renderStatus: 'high-quality',
  }))
  const renderInterval = createMemo(() => (allowed() ? 0 : Infinity))
  const edgeFade = createMemo(() => vec4f(0))
  const cameraPosition = createMemo(() => {
    const target = initial().target
    const t = theta()
    const p = phi()
    const r = radius()
    return new Float32Array([
      target[0] + r * Math.sin(p) * Math.sin(t),
      target[1] + r * Math.cos(p),
      target[2] + r * Math.sin(p) * Math.cos(t),
    ])
  })
  const cameraTarget = createMemo(() => new Float32Array(initial().target))
  const palette = () => props.preset.palette

  const orbit = createDragHandler((event) => {
    if (props.paused) return
    canvas?.focus({ preventScroll: true })
    return {
      onPointerMove(next) {
        if (props.paused) return
        batch(() => {
          setTheta((value) => value - (next.clientX - event.clientX) * 0.005)
          setPhi((value) =>
            Math.max(
              0.05,
              Math.min(
                Math.PI - 0.05,
                value - (next.clientY - event.clientY) * 0.005,
              ),
            ),
          )
        })
        event = next
      },
    }
  })

  function zoom(delta: number) {
    setRadius((value) =>
      Math.max(1.5, Math.min(6.5, value * Math.exp(delta * 0.001))),
    )
  }

  createEffect(() => {
    const step = props.zoomStep ?? 0
    const delta = step - previousZoomStep
    previousZoomStep = step
    if (delta !== 0 && !props.paused) zoom(-120 * delta)
  })

  function wheel(event: WheelEvent) {
    if (props.paused) return
    event.preventDefault()
    const pixels =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
    zoom(pixels)
  }

  function key(event: KeyboardEvent) {
    if (props.paused || event.altKey || event.ctrlKey || event.metaKey) return
    const step = 0.1
    switch (event.key) {
      case 'ArrowLeft':
        setTheta((value) => value + step)
        break
      case 'ArrowRight':
        setTheta((value) => value - step)
        break
      case 'ArrowUp':
        setPhi((value) => Math.max(0.05, value - step))
        break
      case 'ArrowDown':
        setPhi((value) => Math.min(Math.PI - 0.05, value + step))
        break
      case '+':
      case '=':
        zoom(-120)
        break
      case '-':
        zoom(120)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  onMount(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', updateVisibility)
    onCleanup(() => {
      document.removeEventListener('visibilitychange', updateVisibility)
    })
  })
  onCleanup(() => {
    disposed = true
  })

  function connectCanvas(element: HTMLCanvasElement) {
    canvas = element
    element.tabIndex = 0
    element.style.touchAction = 'none'
    element.style.cursor = 'grab'
    element.addEventListener('pointerdown', orbit)
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('keydown', key)
    onCleanup(() => {
      element.removeEventListener('pointerdown', orbit)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
    })
  }

  function completed(info: { count: number }) {
    // Four baseline batches give the poster a visibly detailed replacement.
    // Flam3 presents every batch for its first twenty batches, and the callback
    // is fenced behind submitted GPU work rather than only the CPU dispatch.
    if (disposed || readyReported || info.count < 8_000_000) return
    readyReported = true
    props.onReady?.()
  }

  return (
    <AutoCanvas
      ref={connectCanvas}
      fixedResolution={{ width: 640, height: 640 }}
      pixelRatio={1}
      onVisibilityChange={setVisible}
      role="img"
      ariaLabel={`${props.preset.name}, a live three-dimensional fractal. Drag or use arrow keys to orbit; scroll or use plus and minus to zoom.`}
    >
      <Camera3D
        position={cameraPosition()}
        target={cameraTarget()}
        fov={initial().fov}
      >
        <Flam3
          flameDescriptor={props.preset.flame}
          palette={palette}
          animationEnabled={false}
          quality={0.965}
          pointCountPerBatch={131072}
          renderInterval={renderInterval()}
          adaptiveFilterEnabled={true}
          edgeFadeColor={edgeFade()}
          onCompletedPointCount={completed}
          onCompletedPointCountError={(error) => {
            if (!disposed) props.onError?.(String(error))
          }}
        />
      </Camera3D>
    </AutoCanvas>
  )
}
