/** Projected guide regression checks: world-space placement, camera updates and behind-camera rejection. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PawnFitGuide } from './PawnFitGuide'
import type { Camera3DContext } from '@/lib/Camera3DContext'

const scene = vi.hoisted(() => ({
  project: (world: Float32Array) => world,
  position: () => new Float32Array([0, 0, 5]),
  target: () => new Float32Array([0, 0, 0]),
}))
vi.mock('@/lib/Camera3DContext', () => ({
  useCamera3D: () =>
    ({
      js: { worldToClip: (world: Float32Array) => scene.project(world) },
      position: () => scene.position(),
      target: () => scene.target(),
    }) satisfies Pick<Camera3DContext, 'js' | 'position' | 'target'>,
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({ canvasSize: () => ({ width: 800, height: 400 }) }),
}))

type GuideContext = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'setLineDash'
  | 'fillText'
  | 'lineWidth'
  | 'strokeStyle'
  | 'shadowColor'
  | 'shadowBlur'
  | 'fillStyle'
  | 'font'
>
const context = () =>
  ({
    clearRect: vi.fn<GuideContext['clearRect']>(),
    beginPath: vi.fn<GuideContext['beginPath']>(),
    moveTo: vi.fn<GuideContext['moveTo']>(),
    lineTo: vi.fn<GuideContext['lineTo']>(),
    stroke: vi.fn<(path?: Path2D) => void>(),
    setLineDash: vi.fn<GuideContext['setLineDash']>(),
    fillText: vi.fn<GuideContext['fillText']>(),
    lineWidth: 1,
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    fillStyle: '',
    font: '',
  }) satisfies GuideContext

// Narrow only the 2D overload and the API this component draws with. The
// prototype object stays the real one, so no GPU overload or context casts.
const canvas2D: { getContext(id: '2d'): GuideContext | null } =
  HTMLCanvasElement.prototype

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  scene.project = (world) => world
  scene.position = () => new Float32Array([0, 0, 5])
  scene.target = () => new Float32Array([0, 0, 0])
})

describe('candidate sizing guide', () => {
  it('projects a 1.6 square at ground level through the live camera and redraws when that camera changes', () => {
    const ctx = context()
    vi.spyOn(canvas2D, 'getContext').mockReturnValue(ctx)
    const [offset, setOffset] = createSignal(0)
    scene.project = (world) =>
      new Float32Array([world[0]! + offset(), world[1]!, world[2]!])
    const view = render(() => (
      <PawnFitGuide size={{ squareSize: 1.6, height: 1.8 }} />
    ))
    const canvas = view.getByTestId<HTMLCanvasElement>('pawn-fit-guide')
    expect([canvas.width, canvas.height]).toEqual([800, 400])
    expect(ctx.moveTo.mock.calls[0]?.[0]).toBeCloseTo(80)
    expect(ctx.moveTo.mock.calls[0]?.[1]).toBe(200)
    expect(ctx.lineTo.mock.calls[0]?.[0]).toBeCloseTo(720)
    expect(ctx.lineTo.mock.calls[0]?.[1]).toBe(200)
    expect(ctx.stroke).toHaveBeenCalledTimes(6)
    ctx.moveTo.mockClear()
    setOffset(0.25)
    expect(ctx.moveTo.mock.calls[0]?.[0]).toBeCloseTo(180)
    expect(ctx.moveTo.mock.calls[0]?.[1]).toBe(200)
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
  })

  it('does not mirror sizing lines that lie behind the view', () => {
    const ctx = context()
    vi.spyOn(canvas2D, 'getContext').mockReturnValue(ctx)
    scene.target = () => new Float32Array([0, 0, 6])
    render(() => <PawnFitGuide size={{ squareSize: 1.6, height: 1.8 }} />)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 400)
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })
})
