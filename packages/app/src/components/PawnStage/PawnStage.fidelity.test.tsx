/** Native preview wiring preserves source dimensions, palette, blend and camera independently of inspection controls. */
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { createSignal, onCleanup } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { examples } from '@/flame/examples'
import { camera3DDefault } from '@/flame/schema/flameSchema'
import { PawnStage } from './PawnStage'
import type { JSXElement } from 'solid-js'
import type { Palette } from '@/flame/colorMap'
import type { Camera3DObj, FlameDescriptor } from '@/flame/schema/flameSchema'

const seen = vi.hoisted(() => ({
  camera2D: undefined as
    | { position: { x: number; y: number }; zoom: number; rotation: number }
    | undefined,
  camera3D: undefined as { camera3D: Camera3DObj } | undefined,
  flame: undefined as
    | {
        flameDescriptor: FlameDescriptor
        palette: () => Palette | undefined
        blendFlame?: FlameDescriptor
        blendWeight?: number
      }
    | undefined,
}))
vi.mock('@/contexts/ComputeGateContext', () => ({
  ComputeGate: (props: { children: JSXElement }) => props.children,
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas: (props: {
    ref: (element: HTMLCanvasElement) => void
    children: JSXElement
  }) => (
    <>
      <canvas ref={props.ref} />
      {props.children}
    </>
  ),
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({ canvasSize: () => ({ width: 320, height: 640 }) }),
}))
vi.mock('@/lib/Camera2D', () => ({
  Camera2D: (
    props: NonNullable<typeof seen.camera2D> & { children: JSXElement },
  ) => {
    seen.camera2D = props
    onCleanup(() => {
      seen.camera2D = undefined
    })
    return props.children
  },
}))
vi.mock('@/lib/Camera3D', () => ({
  Default3DPreviewCamera: (
    props: NonNullable<typeof seen.camera3D> & { children: JSXElement },
  ) => {
    seen.camera3D = props
    onCleanup(() => {
      seen.camera3D = undefined
    })
    return props.children
  },
}))
vi.mock('@/flame/Flam3', () => ({
  Flam3: (props: NonNullable<typeof seen.flame>) => {
    seen.flame = props
    return null
  },
}))

const source2D = (): FlameDescriptor => ({
  ...structuredClone(examples.example1),
  renderSettings: {
    ...structuredClone(examples.example1.renderSettings),
    dimensions: 2,
    camera: { position: [3, -2], zoom: 2, rotation: Math.PI / 2 },
    palette: {
      id: 'inspection-palette',
      name: 'Candidate palette',
      entries: [
        { id: 'a', position: 0, a: 0.25, b: -0.4 },
        { id: 'b', position: 1, a: -0.3, b: 0.2 },
      ],
    },
  },
})

afterEach(() => {
  cleanup()
  seen.flame = undefined
})

describe('native source inspection', () => {
  it('keeps 2D geometry, authored framing, embedded palette and validated blend on the renderer', () => {
    const flame = source2D()
    const before = structuredClone(flame)
    const blend = structuredClone(examples.example2)
    render(() => (
      <PawnStage flame={flame} blendFlame={blend} blendWeight={0.35} />
    ))
    expect(seen.camera3D).toBeUndefined()
    expect(seen.camera2D?.position).toMatchObject({ x: 3, y: -2 })
    expect(seen.camera2D?.zoom).toBe(2)
    expect(seen.camera2D?.rotation).toBe(Math.PI / 2)
    expect(seen.flame?.flameDescriptor).toBe(flame)
    expect(seen.flame?.blendFlame).toBe(blend)
    expect(seen.flame?.blendWeight).toBe(0.35)
    expect(seen.flame?.palette()).toEqual({
      ...flame.renderSettings.palette,
      source: 'imported',
    })
    expect(flame).toEqual(before)
  })

  it('pans 2D in its rotated camera plane and resets local controls without writing the source', () => {
    const flame = source2D()
    const before = structuredClone(flame)
    const view = render(() => <PawnStage flame={flame} />)
    const stage = view.getByTestId('pawn-stage')
    const canvas = view.container.querySelector('canvas')!
    Object.defineProperty(canvas, 'clientHeight', { value: 600 })
    expect(view.getByText(/Drag to pan/)).toBeTruthy()
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(seen.camera2D?.position.x).toBeCloseTo(3)
    expect(seen.camera2D?.position.y).toBeCloseTo(-2.02)
    fireEvent.keyDown(stage, { key: '+' })
    expect(seen.camera2D?.zoom).toBeCloseTo(2.24)
    fireEvent.keyDown(stage, { key: 'Home' })
    expect(seen.camera2D?.position).toMatchObject({ x: 3, y: -2 })
    expect(seen.camera2D?.zoom).toBe(2)
    expect(flame).toEqual(before)
  })

  it('fits an independent 3D inspection camera to the portrait canvas and never changes source framing', () => {
    const flame = source2D()
    flame.renderSettings.dimensions = 3
    flame.renderSettings.camera3D = { ...camera3DDefault, radius: 9 }
    const before = structuredClone(flame)
    const camera = {
      ...camera3DDefault,
      theta: 0.4,
      phi: 1.25,
      radius: 4.5,
      target: [0, 0.9, 0] as [number, number, number],
      fov: 45,
    }
    const view = render(() => <PawnStage flame={flame} camera3D={camera} />)
    expect(seen.camera2D).toBeUndefined()
    expect(seen.camera3D?.camera3D).toEqual({ ...camera, radius: 7.2 })
    fireEvent.keyDown(view.getByTestId('pawn-stage'), { key: 'ArrowRight' })
    expect(seen.camera3D?.camera3D.theta).toBeCloseTo(0.328)
    expect(flame).toEqual(before)
  })

  it('preserves an authored pole view and roll until the user orbits', () => {
    const flame = source2D()
    flame.renderSettings.dimensions = 3
    flame.renderSettings.camera3D = { ...camera3DDefault, phi: 0, roll: 0.75 }
    render(() => <PawnStage flame={flame} />)
    expect(seen.camera3D?.camera3D.phi).toBe(0)
    expect(seen.camera3D?.camera3D.roll).toBe(0.75)
  })

  it('switches dimensional camera and palette with the candidate and updates the blend weight', () => {
    const [flame, setFlame] = createSignal(source2D())
    const [weight, setWeight] = createSignal(0.2)
    render(() => <PawnStage flame={flame()} blendWeight={weight()} />)
    const next = source2D()
    next.renderSettings.dimensions = 3
    next.renderSettings.palette = undefined
    setFlame(next)
    setWeight(0.75)
    expect(seen.camera2D).toBeUndefined()
    expect(seen.camera3D).toBeDefined()
    expect(seen.flame?.palette()).toBeUndefined()
    expect(seen.flame?.blendWeight).toBe(0.75)
  })
})
