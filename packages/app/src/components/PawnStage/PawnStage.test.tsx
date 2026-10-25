/** Tests the stage's local input and canvas lifecycle; GPU output is verified headed. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createEffect, createSignal, Show } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { latestSchemaVersion, renderSettingsDefault, } from '@/flame/schema/flameSchema'
import { PawnStage } from './PawnStage'
import type { ParentProps, Setter } from 'solid-js'
import type { Camera3DObj, FlameDescriptor } from '@/flame/schema/flameSchema'

const observed = vi.hoisted(() => ({
  camera: undefined as Camera3DObj | undefined,
  flame: undefined as (() => FlameDescriptor) | undefined,
  count: undefined as ((count: number) => void) | undefined,
  showCanvas: undefined as Setter<boolean> | undefined,
  deferredCanvas: false,
}))

vi.mock('@/flame/Flam3', () => ({
  Flam3: (props: {
    flameDescriptor: FlameDescriptor
    onAccumulatedPointCount?: (count: number) => void
    setQualityPointCountLimit?: (limit: () => number) => void
  }) => {
    observed.flame = () => props.flameDescriptor
    observed.count = (count) => props.onAccumulatedPointCount?.(count)
    props.setQualityPointCountLimit?.(() => 1000)
    return null
  },
}))
vi.mock('@/lib/Camera3D', () => ({
  Default3DPreviewCamera: (props: ParentProps<{ camera3D: Camera3DObj }>) => {
    createEffect(() => {
      observed.camera = props.camera3D
    })
    return <>{props.children}</>
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({ canvasSize: () => ({ width: 1000, height: 600 }) }),
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas: (
    props: ParentProps<{
      ref?: (canvas: HTMLCanvasElement) => void
      ariaLabel?: string
    }>,
  ) => {
    const [visible, setVisible] = createSignal(!observed.deferredCanvas)
    observed.showCanvas = setVisible
    return (
      <Show when={visible()}>
        <canvas
          role="img"
          aria-label={props.ariaLabel}
          ref={(element) => {
            const captured = new Set<number>()
            element.setPointerCapture = (id) => {
              captured.add(id)
            }
            element.hasPointerCapture = (id) => captured.has(id)
            element.releasePointerCapture = (id) => {
              captured.delete(id)
            }
            props.ref?.(element)
          }}
        />
        {props.children}
      </Show>
    )
  },
}))

function recipe(): FlameDescriptor {
  return {
    version: latestSchemaVersion,
    metadata: { name: 'Test pawn', author: '', description: '' },
    renderSettings: {
      ...renderSettingsDefault,
      dimensions: 3,
      camera3D: {
        theta: 0.45,
        phi: 1.25,
        radius: 3.6,
        target: [0, 0.9, 0],
        fov: 45,
        roll: 0,
      },
    },
    transforms: {},
  }
}

function pointer(
  surface: HTMLElement,
  type: string,
  id: number,
  x: number,
  y = 100,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: 'touch' },
  })
  surface.dispatchEvent(event)
}

afterEach(() => {
  cleanup()
  observed.camera = undefined
  observed.deferredCanvas = false
})

describe('PawnStage local camera', () => {
  it('renders the supplied recipe without mutating it and reports convergence in percent changes', () => {
    const flame = recipe()
    const before = structuredClone(flame)
    const status = vi.fn()
    render(() => <PawnStage flame={flame} onStatusChange={status} />)
    expect(observed.flame?.()).toBe(flame)
    expect(observed.camera).toEqual(flame.renderSettings.camera3D)
    observed.count?.(500)
    expect(status).toHaveBeenLastCalledWith({
      pointCount: 500,
      progress: 0.5,
      ready: false,
    })
    const calls = status.mock.calls.length
    observed.count?.(505)
    expect(status).toHaveBeenCalledTimes(calls)
    observed.count?.(1000)
    expect(status).toHaveBeenLastCalledWith({
      pointCount: 1000,
      progress: 1,
      ready: true,
    })
    expect(flame).toEqual(before)
  })

  it('orbits only from stage keyboard focus and restores the authored view', () => {
    const [reset, setReset] = createSignal(0)
    render(() => <PawnStage flame={recipe()} resetViewKey={reset()} />)
    const stage = screen.getByTestId('pawn-stage')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(observed.camera?.theta).toBe(0.45)
    stage.focus()
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(observed.camera?.theta).toBeCloseTo(0.378, 8)
    fireEvent.keyDown(stage, { key: '+' })
    expect(observed.camera?.radius).toBeCloseTo(3.6 / 1.12, 8)
    setReset(1)
    expect(observed.camera?.theta).toBe(0.45)
    expect(observed.camera?.radius).toBe(3.6)
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    fireEvent.keyDown(stage, { key: 'Home' })
    expect(observed.camera?.theta).toBe(0.45)
  })

  it('tracks active pointer ids and stops an orbit on cancellation', () => {
    render(() => <PawnStage flame={recipe()} />)
    const surface = screen.getByRole('img')
    pointer(surface, 'pointerdown', 1, 100)
    pointer(surface, 'pointermove', 9, 200)
    expect(observed.camera?.theta).toBe(0.45)
    pointer(surface, 'pointermove', 1, 120)
    expect(observed.camera?.theta).toBeCloseTo(0.33, 8)
    pointer(surface, 'pointercancel', 9, 120)
    pointer(surface, 'pointermove', 1, 140)
    expect(observed.camera?.theta).toBeCloseTo(0.21, 8)
    pointer(surface, 'pointercancel', 1, 140)
    pointer(surface, 'pointermove', 1, 200)
    expect(observed.camera?.theta).toBeCloseTo(0.21, 8)
  })

  it('pinches to zoom and allows one-finger orbit after the other contact ends', () => {
    render(() => <PawnStage flame={recipe()} />)
    const surface = screen.getByRole('img')
    pointer(surface, 'pointerdown', 1, 100)
    pointer(surface, 'pointerdown', 2, 200)
    pointer(surface, 'pointermove', 2, 300)
    expect(observed.camera?.radius).toBeCloseTo(1.8, 8)
    expect(observed.camera?.theta).toBe(0.45)
    pointer(surface, 'pointerup', 2, 300)
    pointer(surface, 'pointermove', 1, 120)
    expect(observed.camera?.theta).toBeCloseTo(0.33, 8)
  })

  it('binds input to a delayed or replaced GPU canvas and removes the old listeners', () => {
    observed.deferredCanvas = true
    render(() => <PawnStage flame={recipe()} />)
    expect(screen.queryByRole('img')).toBeNull()
    observed.showCanvas?.(true)
    const first = screen.getByRole('img')
    pointer(first, 'pointerdown', 1, 100)
    pointer(first, 'pointermove', 1, 120)
    expect(observed.camera?.theta).toBeCloseTo(0.33, 8)
    observed.showCanvas?.(false)
    observed.showCanvas?.(true)
    const second = screen.getByRole('img')
    expect(second).not.toBe(first)
    pointer(first, 'pointerdown', 1, 100)
    pointer(first, 'pointermove', 1, 120)
    expect(observed.camera?.theta).toBeCloseTo(0.33, 8)
    pointer(second, 'pointerdown', 1, 100)
    pointer(second, 'pointermove', 1, 120)
    expect(observed.camera?.theta).toBeCloseTo(0.21, 8)
  })
})
