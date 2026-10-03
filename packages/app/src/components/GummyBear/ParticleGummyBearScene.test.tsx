/** Meshless jelly must own its GPU lifetime, exact replay and stale pointer reads. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal, ErrorBoundary, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GUMMY_ORBIT, gummyCameraMatrices } from './gummyStudyMath'
import { ParticleGummyBearScene } from './ParticleGummyBearScene'
import type { ParentProps } from 'solid-js'
import type { GummyPalette } from './GummyBearScene'
import type { GummyFrame } from './gummyRenderer'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

type Snapshot = Awaited<
  ReturnType<ReturnType<typeof createGummyParticleSolver>['readState']>
>
type StepInput = Parameters<
  ReturnType<typeof createGummyParticleSolver>['step']
>[1]
type SolverRecord = {
  destroyed: boolean
  resets: number
  reads: number
  inputs: { dt: number; input: StepInput }[]
  nextRead?: Promise<Snapshot>
  snapshot: () => Snapshot
}
const fixtures = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  solvers: [] as SolverRecord[],
  renderers: [] as {
    destroyed: boolean
    frames: { frame: GummyFrame; raw?: boolean }[]
  }[],
  rendererError: undefined as string | undefined,
}))

vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps<{ ariaLabel: string }>) {
    const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
    return (
      <>
        <canvas
          aria-label={props.ariaLabel}
          ref={(element) => {
            fixtures.canvas = element
            const captured = new Set<number>()
            element.setPointerCapture = (id) => {
              captured.add(id)
            }
            element.hasPointerCapture = (id) => captured.has(id)
            element.releasePointerCapture = (id) => {
              captured.delete(id)
            }
            element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400)
            setCanvas(element)
          }}
        />
        <Show when={canvas()}>{props.children}</Show>
      </>
    )
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: fixtures.canvas,
    context: {},
    canvasFormat: 'bgra8unorm',
    canvasSize: () => ({ width: 400, height: 400 }),
  }),
}))
vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({ root: {}, device: {} }),
}))
vi.mock('@/simulation/gummy/gummyParticleSolver', () => ({
  createGummyParticleSolver() {
    const restPositions = new Float32Array([
      0, 0, 0, 0, 0, 2.5, 0, 1, 0.64, 1.24, 0.08, 1,
    ])
    const record: SolverRecord = {
      destroyed: false,
      resets: 0,
      reads: 0,
      inputs: [],
      snapshot: () => ({
        positions: restPositions.slice(),
        velocities: new Float32Array(12),
        deformation: new Float32Array(36),
        damage: new Float32Array(3),
        peakStretch: new Float32Array(3),
        J: new Float32Array([1, 1, 1]),
        simulationTime: record.inputs.length / 120,
        particleCount: 3,
        totalMass: 1,
        restVolume: 1,
        elasticEnergy: 0,
        kineticEnergy: 0,
        guardActivations: 0,
        speedCaps: 0,
        affineCaps: 0,
        deformationRejections: 0,
        domainContacts: 0,
        zeroShearUpdates: 0,
        maxGridSpeed: 0,
        maxParticleSpeed: 0,
        speedCapImpulse: 0,
        particleSpeedCaps: 0,
        gridSpeedCaps: 0,
        gripCount: 0,
      }),
    }
    fixtures.solvers.push(record)
    return {
      positions: {},
      restPositions,
      particleCount: 3,
      spacing: 0.08,
      gridSpacing: 0.16,
      restVolume: 1,
      gridBounds: { min: [-2, 0, -2], max: [3, 5, 3] },
      substeps: 8,
      step(dt: number, input: StepInput) {
        if (record.destroyed)
          throw new Error('Stepped destroyed particle buffers')
        record.inputs.push({ dt, input })
      },
      reset() {
        record.resets++
        record.inputs.length = 0
      },
      readState() {
        record.reads++
        return record.nextRead ?? Promise.resolve(record.snapshot())
      },
      destroy() {
        record.destroyed = true
      },
    }
  },
}))
vi.mock('./particleGummyRenderer', () => ({
  createParticleGummyRenderer() {
    if (fixtures.rendererError) throw new Error(fixtures.rendererError)
    const record = {
      destroyed: false,
      frames: [] as { frame: GummyFrame; raw?: boolean }[],
    }
    fixtures.renderers.push(record)
    return {
      render(frame: GummyFrame, options: { raw?: boolean }) {
        if (record.destroyed)
          throw new Error('Rendered destroyed particle resources')
        record.frames.push({ frame, raw: options.raw })
      },
      destroy() {
        record.destroyed = true
      },
    }
  },
}))

let frameId = 0
const frames = new Map<number, FrameRequestCallback>()

function drawFrame(time: number) {
  const queued = frames.entries().next().value
  if (!queued) throw new Error('No animation frame was scheduled')
  const [id, callback] = queued
  frames.delete(id)
  callback(time)
}

function diagnostics() {
  if (!window.__gummyParticleStudy)
    throw new Error('Particle diagnostics are missing')
  return window.__gummyParticleStudy
}
beforeEach(() => {
  fixtures.canvas = undefined
  fixtures.solvers.length = 0
  fixtures.renderers.length = 0
  fixtures.rendererError = undefined
  frames.clear()
  frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ParticleGummyBearScene', () => {
  it('replays atomically from tick zero and forwards fixed commands without frame readbacks', async () => {
    const [paused, setPaused] = createSignal(false)
    const [palette, setPalette] = createSignal<GummyPalette>('marble')
    const [tearing, setTearing] = createSignal(true)
    render(() => (
      <ParticleGummyBearScene
        palette={palette()}
        mode="drag"
        softness={0.55}
        tearing={tearing()}
        paused={paused()}
        demoKey={0}
        resetKey={0}
        onPauseChange={setPaused}
      />
    ))
    drawFrame(0)
    const api = diagnostics()
    api.startDemoPaused()
    expect(paused()).toBe(true)
    expect(api.info()).toMatchObject({
      experiment: 'particle',
      materialModel: 'mls-mpm',
      steps: 0,
      time: 0,
      phase: 'settling',
      demo: true,
      grip: true,
      substeps: 8,
    })
    drawFrame(10000)
    expect(api.info().steps).toBe(0)
    api.advanceFrames(600)
    expect(api.info()).toMatchObject({
      tick: 600,
      time: 5,
      phase: 'holding',
      grip: true,
    })
    const calls = fixtures.solvers[0]!.inputs
    expect(calls).toHaveLength(600)
    expect(calls.every((call) => call.dt === 1 / 120)).toBe(true)
    expect(calls[0]!.input.grip?.target).toEqual([0.64, 1.24, 0.08])
    expect(calls[599]!.input.grip?.target[0]).toBeCloseTo(1.84, 12)
    expect(fixtures.solvers[0]!.reads).toBe(0)
    setTearing(false)
    setPalette('lagoon')
    api.advanceFrames(240)
    expect(api.info()).toMatchObject({
      tick: 840,
      phase: 'recovering',
      grip: false,
    })
    expect(calls.at(-1)?.input).toMatchObject({
      tearing: false,
      softness: 0.55,
    })
    expect(calls.at(-1)?.input.grip).toBeUndefined()
    expect(fixtures.renderers[0]!.frames.at(-1)?.frame.palette).toBe('lagoon')
    api.render({ raw: true, clay: true })
    expect(fixtures.renderers[0]!.frames.at(-1)).toMatchObject({
      raw: true,
      frame: { clay: true },
    })
    api.advanceFrames(600)
    expect(api.info()).toMatchObject({
      steps: 1440,
      time: 12,
      phase: 'complete',
      demo: false,
    })
    const state = await api.readState()
    expect(state.restPositions).toEqual(
      new Float32Array([0, 0, 0, 0, 0, 2.5, 0, 1, 0.64, 1.24, 0.08, 1]),
    )
    expect(() => {
      api.advanceFrames(3601)
    }).toThrow(RangeError)
  })

  it('disposes both resource owners and rejects a pointer read completing after unmount', async () => {
    const [mounted, setMounted] = createSignal(true)
    const statuses = vi.fn()
    render(() => (
      <Show when={mounted()}>
        <ParticleGummyBearScene
          palette="blue"
          mode="drag"
          softness={0.55}
          tearing
          paused
          demoKey={0}
          resetKey={0}
          onStatus={statuses}
        />
      </Show>
    ))
    drawFrame(0)
    const record = fixtures.solvers[0]!
    let resolveRead!: (state: Snapshot) => void
    record.nextRead = new Promise((resolve) => {
      resolveRead = resolve
    })
    const matrix = new Float32Array(16)
    gummyCameraMatrices(
      { ...DEFAULT_GUMMY_ORBIT },
      1,
      matrix,
      new Float32Array(16),
      new Float32Array(3),
    )
    const p = [0.64, 1.24, 0.08, 1]
    const clip = [0, 1, 2, 3].map((row) =>
      p.reduce(
        (sum, value, column) => sum + matrix[column * 4 + row]! * value,
        0,
      ),
    )
    const canvas = fixtures.canvas!
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 7,
      clientX: 200 * (clip[0]! / clip[3]! + 1),
      clientY: 200 * (1 - clip[1]! / clip[3]!),
    })
    expect(record.reads).toBe(1)
    expect(canvas.hasPointerCapture(7)).toBe(true)
    setMounted(false)
    expect(record.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(frames.size).toBe(0)
    expect(canvas.hasPointerCapture(7)).toBe(false)
    expect(window.__gummyParticleStudy).toBeUndefined()
    statuses.mockClear()
    resolveRead(record.snapshot())
    await Promise.resolve()
    await Promise.resolve()
    expect(statuses).not.toHaveBeenCalled()
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 8,
      clientX: 200,
      clientY: 200,
    })
    expect(record.reads).toBe(1)
  })

  it('rolls back the solver when renderer initialization fails', () => {
    fixtures.rendererError = 'No attachment capacity'
    render(() => (
      <ErrorBoundary fallback={<p>Renderer unavailable</p>}>
        <ParticleGummyBearScene
          palette="blue"
          mode="orbit"
          softness={0.55}
          tearing
          paused
          demoKey={0}
          resetKey={0}
        />
      </ErrorBoundary>
    ))
    expect(screen.getByText('Renderer unavailable')).toBeTruthy()
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers).toHaveLength(0)
    expect(frames.size).toBe(0)
    expect(window.__gummyParticleStudy).toBeUndefined()
  })
})
