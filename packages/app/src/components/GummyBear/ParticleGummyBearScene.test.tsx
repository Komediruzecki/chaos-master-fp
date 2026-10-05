/** Meshless jelly must own its GPU lifetime, exact replay and stale pointer reads. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal, ErrorBoundary, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_CHESS_MOULDS } from '@/simulation/gummy/gummyChessMoulds'
import { DEFAULT_GUMMY_ORBIT, gummyCameraMatrices } from './gummyStudyMath'
import { ParticleGummyBearScene } from './ParticleGummyBearScene'
import type { ParentProps } from 'solid-js'
import type { GummyInteraction, GummyPalette } from './GummyBearScene'
import type { GummyPointerFrame } from './gummyPointerRenderer'
import type { GummyFrame } from './gummyRenderer'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleMath'
import type { createGummyParticleSolver, GummyParticleOptions, } from '@/simulation/gummy/gummyParticleSolver'

type Snapshot = Awaited<
  ReturnType<ReturnType<typeof createGummyParticleSolver>['readState']>
>
type StepInput = Parameters<
  ReturnType<typeof createGummyParticleSolver>['step']
>[1]
type SolverRecord = {
  options: GummyParticleOptions
  destroyed: boolean
  resets: number
  reads: number
  inputs: { dt: number; input: StepInput }[]
  nextRead?: Promise<Snapshot>
  nextPositions?: Promise<Float32Array>
  positionReads: number
  snapshot: () => Snapshot
}
const fixtures = vi.hoisted(() => ({
  device: undefined as EventTarget | undefined,
  canvas: undefined as HTMLCanvasElement | undefined,
  visibility: undefined as ((visible: boolean) => void) | undefined,
  solvers: [] as SolverRecord[],
  pointerRenderers: [] as { destroyed: boolean; frames: GummyPointerFrame[] }[],
  drawOrder: [] as string[],
  renderers: [] as {
    destroyed: boolean
    reconstruction: 'screen-space' | 'marching-cubes'
    gridBounds?: { min: number[]; max: number[] }
    statsReads: number
    frames: {
      frame: GummyFrame
      raw?: boolean
      caustics?: boolean
      revision?: number
    }[]
  }[],
  maxActiveSolvers: 0,
  rendererError: undefined as string | undefined,
  completion: undefined as Promise<void> | undefined,
}))

vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(
    props: ParentProps<{
      ariaLabel: string
      onVisibilityChange?: (visible: boolean) => void
    }>,
  ) {
    fixtures.visibility = (visible) => props.onVisibilityChange?.(visible)
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
  useLiveRootContext: () => ({
    root: {},
    device: Object.assign(fixtures.device!, {
      queue: {
        onSubmittedWorkDone: () => fixtures.completion ?? Promise.resolve(),
      },
    }),
  }),
}))
vi.mock('@/simulation/gummy/gummyParticleSolver', () => ({
  createGummyParticleSolver(
    _root: unknown,
    _device: unknown,
    options: GummyParticleOptions,
  ) {
    const restPositions = new Float32Array([
      0, 0, 0, 0, 0, 2.5, 0, 1, 0.64, 1.24, 0.08, 1,
    ])
    const record: SolverRecord = {
      options,
      destroyed: false,
      positionReads: 0,
      resets: 0,
      reads: 0,
      inputs: [],
      snapshot: () => ({
        positions: restPositions.slice(),
        velocities: new Float32Array(12),
        deformation: new Float32Array(36),
        damage: new Float32Array(3),
        peakStretch: new Float32Array(3),
        plasticStrain: new Float32Array(3),
        maxPlasticStrain: 0,
        volumetricOpening: new Float32Array(3),
        maxVolumetricOpening: 0,
        cavitationUpdates: 0,
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
        relaxationUpdates: 0,
        particleMaterial: 'elastic',
        maxGridSpeed: 0,
        maxParticleSpeed: 0,
        speedCapImpulse: 0,
        particleSpeedCaps: 0,
        gridSpeedCaps: 0,
        gripCount: 0,
      }),
    }
    fixtures.solvers.push(record)
    fixtures.maxActiveSolvers = Math.max(
      fixtures.maxActiveSolvers,
      fixtures.solvers.filter((solver) => !solver.destroyed).length,
    )
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
      readPositions() {
        record.reads++
        record.positionReads++
        return (
          record.nextPositions ?? Promise.resolve(record.snapshot().positions)
        )
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
vi.mock('./gummyPointerRenderer', () => ({
  createGummyPointerRenderer() {
    const record = { destroyed: false, frames: [] as GummyPointerFrame[] }
    fixtures.pointerRenderers.push(record)
    return {
      render(frame: GummyPointerFrame) {
        if (record.destroyed)
          throw new Error('Rendered a destroyed pointer guide')
        record.frames.push(frame)
        fixtures.drawOrder.push('pointer')
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
      reconstruction: 'screen-space' as const,
      statsReads: 0,
      frames: [] as { frame: GummyFrame; raw?: boolean }[],
    }
    fixtures.renderers.push(record)
    return {
      render(frame: GummyFrame, options: { raw?: boolean }) {
        if (record.destroyed)
          throw new Error('Rendered destroyed particle resources')
        record.frames.push({ frame, raw: options.raw })
        fixtures.drawOrder.push('scene')
      },
      destroy() {
        record.destroyed = true
      },
    }
  },
}))
vi.mock('./marchingGummyRenderer', () => ({
  createMarchingGummyRenderer(
    _root: unknown,
    _device: unknown,
    _context: unknown,
    _format: unknown,
    particles: { gridBounds: { min: number[]; max: number[] } },
  ) {
    if (fixtures.rendererError) throw new Error(fixtures.rendererError)
    const record = {
      destroyed: false,
      reconstruction: 'marching-cubes' as const,
      gridBounds: particles.gridBounds,
      statsReads: 0,
      frames: [] as {
        frame: GummyFrame
        raw?: boolean
        caustics?: boolean
        revision?: number
      }[],
    }
    fixtures.renderers.push(record)
    return {
      render(
        frame: GummyFrame,
        options: { raw?: boolean; caustics?: boolean; revision?: number },
      ) {
        if (record.destroyed)
          throw new Error('Rendered destroyed marching resources')
        record.frames.push({ frame, ...options })
        fixtures.drawOrder.push('scene')
      },
      readSurfaceStats() {
        record.statsReads++
        return Promise.resolve({ triangleCount: 12 })
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

function cameraPointer(
  type: string,
  id: number,
  x: number,
  y: number,
  options: object = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    pointerId: id,
    button: 0,
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    ...options,
  })
  fixtures.canvas!.dispatchEvent(event)
}

beforeEach(() => {
  fixtures.device = new EventTarget()
  fixtures.visibility = undefined
  fixtures.canvas = undefined
  fixtures.solvers.length = 0
  fixtures.renderers.length = 0
  fixtures.pointerRenderers.length = 0
  fixtures.drawOrder.length = 0
  fixtures.maxActiveSolvers = 0
  fixtures.rendererError = undefined
  fixtures.completion = undefined
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
  it('fits the complete king at rest and keeps panning locked to pointer travel', () => {
    render(() => (
      <ParticleGummyBearScene
        fixture="king"
        reconstruction="marching-cubes"
        palette="marble"
        mode="pan"
        softness={0.3}
        tearing
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const project = (point: readonly number[]) => {
      const m = fixtures.renderers[0]!.frames.at(-1)!.frame.viewProjection
      const w =
        m[3]! * point[0]! + m[7]! * point[1]! + m[11]! * point[2]! + m[15]!
      return [
        (m[0]! * point[0]! + m[4]! * point[1]! + m[8]! * point[2]! + m[12]!) /
          w,
        (m[1]! * point[0]! + m[5]! * point[1]! + m[9]! * point[2]! + m[13]!) /
          w,
      ]
    }
    const { min, max } = GUMMY_CHESS_MOULDS.king.bounds
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]])
          expect(Math.max(...project([x, y, z]).map(Math.abs))).toBeLessThan(
            0.9,
          )
    const center = [0, (min[1] + max[1]) / 2, 0]
    const before = project(center)
    cameraPointer('pointerdown', 1, 200, 200)
    cameraPointer('pointermove', 1, 240, 225)
    diagnostics().render()
    const after = project(center)
    expect(after[0]! - before[0]!).toBeCloseTo(0.2, 5)
    expect(after[1]! - before[1]!).toBeCloseTo(-0.125, 5)
    expect(fixtures.solvers[0]!.inputs).toHaveLength(0)
  })

  it('replaces each chess mould with one solver and preserves material inputs', async () => {
    const shapes = [
      'pawn',
      'rook',
      'knight',
      'bishop',
      'queen',
      'king',
      'bear',
    ] as const
    const [fixture, setFixture] = createSignal<(typeof shapes)[number]>('pawn')
    render(() => (
      <ParticleGummyBearScene
        fixture={fixture()}
        reconstruction="marching-cubes"
        particleMaterial="warm"
        palette="marble"
        mode="drag"
        softness={0.3}
        fragility={0.7}
        tearing
        paused={false}
        demoKey={0}
        resetKey={0}
      />
    ))
    for (const [index, shape] of shapes.entries()) {
      if (shape !== 'pawn') setFixture(shape)
      drawFrame(100 * index)
      await Promise.resolve()
      drawFrame(100 * index + 20)
      await Promise.resolve()
      const solver = fixtures.solvers[index]!
      expect(solver.options?.fixture).toBe(shape)
      expect(solver.inputs.at(-1)?.input.softness).toBe(0.3)
      expect(solver.inputs.at(-1)?.input.fragility).toBe(0.7)
      const frame = fixtures.renderers[index]!.frames.at(-1)!.frame
      expect(frame.floor).toBe(shape === 'bear' ? 'studio' : 'chess')
      expect(frame.palette).toBe('marble')
    }
    expect(fixtures.maxActiveSolvers).toBe(1)
    expect(
      fixtures.solvers.slice(0, -1).every((solver) => solver.destroyed),
    ).toBe(true)
    expect(
      fixtures.renderers.slice(0, -1).every((renderer) => renderer.destroyed),
    ).toBe(true)
  })

  it.each(['screen-space', 'marching-cubes'] as const)(
    'surfaces asynchronous GPU errors and stops submitting %s physics',
    async (reconstruction) => {
      const onError = vi.fn()
      const [resetKey, setResetKey] = createSignal(0)
      const mounted = render(() => (
        <ParticleGummyBearScene
          reconstruction={reconstruction}
          particleMaterial="warm"
          palette="marble"
          mode="drag"
          softness={0.55}
          tearing
          paused={false}
          demoKey={0}
          resetKey={resetKey()}
          onError={onError}
        />
      ))
      drawFrame(0)
      await Promise.resolve()
      drawFrame(20)
      await Promise.resolve()
      const solver = fixtures.solvers[0]!
      expect(solver.inputs.length).toBeGreaterThan(0)
      const steps = solver.inputs.length
      const draws = fixtures.renderers[0]!.frames.length
      const emit = () => {
        const event = new Event('uncapturederror', { cancelable: true })
        Object.defineProperty(event, 'error', {
          value: {
            name: 'GPUValidationError',
            message: 'The MPM compute pipeline was rejected.',
          },
        })
        fixtures.device!.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      emit()
      expect(onError).toHaveBeenLastCalledWith(
        expect.stringContaining('The MPM compute pipeline was rejected.'),
      )
      drawFrame(40)
      expect(solver.inputs).toHaveLength(steps)
      expect(fixtures.renderers[0]!.frames).toHaveLength(draws)
      setResetKey(1)
      onError.mockClear()
      emit()
      expect(onError).toHaveBeenCalledOnce()
      mounted.unmount()
      onError.mockClear()
      emit()
      expect(onError).not.toHaveBeenCalled()
    },
  )

  it('forwards live tuning and bounds manual grip reach while keeping the current fixture', async () => {
    const [tuning, setTuning] = createSignal<Partial<GummyParticleTuning>>({
      grabStrength: 0.5,
    })
    const [radius, setRadius] = createSignal(0.12)
    const [maxPull, setMaxPull] = createSignal(0.25)
    const [pointerGuide, setPointerGuide] = createSignal(true)
    render(() => (
      <ParticleGummyBearScene
        reconstruction="marching-cubes"
        particleMaterial="warm"
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused
        tuning={tuning()}
        grabRadius={radius()}
        maxPull={maxPull()}
        pointerGuide={pointerGuide()}
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const record = fixtures.solvers[0]!
    diagnostics().advanceFrames(1)
    expect(record.inputs.at(-1)!.input.tuning).toEqual({
      grabStrength: 0.5,
      flow: 1,
      gravity: 1,
      floorDrag: 5,
      viscosity: 1,
    })
    setTuning({
      grabStrength: 0.25,
      flow: 0.3,
      gravity: 0.4,
      floorDrag: 8,
      viscosity: 0.6,
    })
    diagnostics().advanceFrames(1)
    expect(record.inputs.at(-1)!.input.tuning).toEqual(tuning())
    expect(fixtures.solvers).toHaveLength(1)

    const matrix = fixtures.renderers[0]!.frames.at(-1)!.frame.viewProjection
    const point = [0.64, 1.24, 0.08, 1]
    const clip = [0, 1, 2, 3].map((row) =>
      point.reduce(
        (sum, value, col) => sum + value * matrix[col * 4 + row]!,
        0,
      ),
    )
    const x = 200 * (clip[0]! / clip[3]! + 1),
      y = 200 * (1 - clip[1]! / clip[3]!)
    cameraPointer('pointerdown', 7, x, y)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(diagnostics().info().grip).toBe(true)
    cameraPointer('pointermove', 7, x + 900, y)
    diagnostics().advanceFrames(1)
    const first = record.inputs.at(-1)!.input.grip!
    expect(first.radius).toBe(0.12)
    expect(
      Math.hypot(...first.target.map((value, i) => value - first.center[i]!)),
    ).toBeCloseTo(0.25, 6)
    expect(fixtures.drawOrder.slice(-2)).toEqual(['scene', 'pointer'])
    expect(fixtures.pointerRenderers[0]!.frames.at(-1)?.pointer).toMatchObject({
      active: true,
      target: first.target,
      origin: first.center,
    })
    setMaxPull(0.5)
    cameraPointer('pointermove', 7, x + 1100, y)
    diagnostics().advanceFrames(1)
    const longer = record.inputs.at(-1)!.input.grip!
    expect(
      Math.hypot(...longer.target.map((value, i) => value - longer.center[i]!)),
    ).toBeCloseTo(0.5, 6)
    setPointerGuide(false)
    diagnostics().render()
    expect(fixtures.pointerRenderers[0]!.frames.at(-1)?.pointer).toBeUndefined()
    expect(diagnostics().info().grip).toBe(true)
    cameraPointer('pointerup', 7, x + 1100, y)
    setRadius(0.18)
    cameraPointer('pointerdown', 8, x, y)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    diagnostics().advanceFrames(1)
    expect(record.inputs.at(-1)!.input.grip!.radius).toBe(0.18)
    expect(fixtures.solvers).toHaveLength(1)
  })

  it('rebuilds the material fixture only when foot anchoring is explicitly changed', () => {
    const [pinnedFeet, setPinnedFeet] = createSignal<boolean | undefined>()
    const mounted = render(() => (
      <ParticleGummyBearScene
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused
        pinnedFeet={pinnedFeet()}
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    expect(fixtures.solvers[0]!.options?.pinnedFeet).toBe(true)
    diagnostics().advanceFrames(3)
    setPinnedFeet(false)
    expect(fixtures.solvers).toHaveLength(2)
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(fixtures.pointerRenderers[0]!.destroyed).toBe(true)
    expect(fixtures.solvers[1]!.options?.pinnedFeet).toBe(false)
    expect(fixtures.maxActiveSolvers).toBe(1)
    drawFrame(20)
    expect(diagnostics().info().steps).toBe(0)
    expect(diagnostics().info().settings.pinnedFeet).toBe(false)
    expect(frames.size).toBe(1)
    mounted.unmount()
    expect(
      fixtures.pointerRenderers.every((renderer) => renderer.destroyed),
    ).toBe(true)
  })

  it.each(['screen-space', 'marching-cubes'] as const)(
    'grabs with one finger using only positions and yields rendering while the %s pick is pending',
    async (reconstruction) => {
      render(() => (
        <ParticleGummyBearScene
          reconstruction={reconstruction}
          palette="marble"
          mode="drag"
          softness={0.55}
          particleMaterial="warm"
          tearing
          paused={false}
          demoKey={0}
          resetKey={0}
        />
      ))
      drawFrame(0)
      await Promise.resolve()
      const record = fixtures.solvers[0]!
      // Diagnostics can be unavailable without delaying the input read.
      record.nextRead = new Promise(() => {})
      let finish!: (positions: Float32Array) => void
      record.nextPositions = new Promise((resolve) => {
        finish = resolve
      })
      const matrix = fixtures.renderers[0]!.frames[0]!.frame.viewProjection
      const point = [0.64, 1.24, 0.08, 1]
      const clip = [0, 1, 2, 3].map((row) =>
        point.reduce(
          (sum, value, col) => sum + value * matrix[col * 4 + row]!,
          0,
        ),
      )
      const x = 200 * (clip[0]! / clip[3]! + 1)
      const y = 200 * (1 - clip[1]! / clip[3]!)
      const touchStart = new Event('touchstart', {
        bubbles: true,
        cancelable: true,
      })
      fixtures.canvas!.dispatchEvent(touchStart)
      expect(touchStart.defaultPrevented).toBe(true)
      cameraPointer('pointerdown', 7, x, y)
      const touchMove = new Event('touchmove', {
        bubbles: true,
        cancelable: true,
      })
      fixtures.canvas!.dispatchEvent(touchMove)
      expect(touchMove.defaultPrevented).toBe(true)
      cameraPointer('pointermove', 7, x + 20, y)
      drawFrame(20)
      expect(fixtures.renderers[0]!.frames).toHaveLength(1)
      expect(fixtures.pointerRenderers[0]!.frames).toHaveLength(1)
      expect(record.positionReads).toBe(1)
      expect(record.inputs).toHaveLength(0)
      finish(record.snapshot().positions)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      expect(diagnostics().info().grip).toBe(true)
      drawFrame(40)
      const first = [...record.inputs.at(-1)!.input.grip!.target]
      expect(first).not.toEqual(point.slice(0, 3))
      cameraPointer('pointermove', 7, x + 50, y - 10)
      await Promise.resolve()
      drawFrame(60)
      expect(record.inputs.at(-1)!.input.grip!.target).not.toEqual(first)
      expect(fixtures.drawOrder.slice(-2)).toEqual(['scene', 'pointer'])
      expect(
        fixtures.pointerRenderers[0]!.frames.at(-1)?.pointer,
      ).toMatchObject({
        active: true,
        target: record.inputs.at(-1)!.input.grip!.target,
        origin: expect.any(Array),
      })
      cameraPointer('pointerup', 7, x + 50, y - 10)
      expect(diagnostics().info().grip).toBe(false)
      expect(fixtures.canvas!.hasPointerCapture(7)).toBe(false)
    },
  )

  it('continues rendering an offscreen canvas only while its recording is active', async () => {
    const [recording, setRecording] = createSignal(false)
    render(() => (
      <ParticleGummyBearScene
        reconstruction="marching-cubes"
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused={false}
        recording={recording()}
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    await Promise.resolve()
    const renderer = fixtures.renderers[0]!
    const before = renderer.frames.length
    fixtures.visibility!(false)
    drawFrame(20)
    expect(renderer.frames).toHaveLength(before)
    expect(fixtures.solvers[0]!.inputs).toHaveLength(0)
    setRecording(true)
    drawFrame(40)
    await Promise.resolve()
    expect(renderer.frames).toHaveLength(before + 1)
    expect(fixtures.solvers[0]!.inputs.length).toBe(2)
    setRecording(false)
    drawFrame(60)
    expect(renderer.frames).toHaveLength(before + 1)
    expect(fixtures.solvers[0]!.inputs).toHaveLength(2)
  })

  it.each(['screen-space', 'marching-cubes'] as const)(
    'navigates %s with touch pan, orbit and keyboard, then restores the view without changing physics',
    (model) => {
      const [mode, setMode] = createSignal<GummyInteraction>('pan')
      const [viewKey, setViewKey] = createSignal(0)
      render(() => (
        <ParticleGummyBearScene
          reconstruction={model}
          palette="marble"
          mode={mode()}
          softness={0.55}
          tearing
          paused
          demoKey={0}
          resetKey={0}
          resetViewKey={viewKey()}
        />
      ))
      drawFrame(0)
      const projection = () => {
        diagnostics().render()
        return Array.from(
          fixtures.renderers[0]!.frames.at(-1)!.frame.viewProjection,
        )
      }
      const initial = projection()
      cameraPointer('pointerdown', 1, 100, 100)
      cameraPointer('pointermove', 1, 150, 125)
      expect(projection()).not.toEqual(initial)
      expect(diagnostics().info().grip).toBe(false)
      setViewKey(1)
      expect(fixtures.canvas!.hasPointerCapture(1)).toBe(false)
      expect(projection()).toEqual(initial)
      setMode('orbit')
      cameraPointer('pointerdown', 2, 100, 100)
      cameraPointer('pointermove', 2, 140, 115)
      expect(projection()).not.toEqual(initial)
      cameraPointer('pointerup', 2, 140, 115)
      fireEvent.keyDown(fixtures.canvas!, { key: 'Home' })
      expect(projection()).toEqual(initial)
      fireEvent.keyDown(fixtures.canvas!, { key: 'ArrowRight', shiftKey: true })
      expect(projection()).not.toEqual(initial)
      fireEvent.keyDown(fixtures.canvas!, { key: 'Home' })
      expect(projection()).toEqual(initial)
      expect(fixtures.solvers[0]!.inputs).toHaveLength(0)
      expect(fixtures.solvers).toHaveLength(1)
    },
  )

  it.each(['mode', 'second-touch'] as const)(
    'rejects a delayed material pick after a %s camera transition',
    async (transition) => {
      const [mode, setMode] = createSignal<GummyInteraction>('drag')
      const statuses: string[] = []
      render(() => (
        <ParticleGummyBearScene
          reconstruction="marching-cubes"
          palette="marble"
          mode={mode()}
          softness={0.55}
          tearing
          paused
          demoKey={0}
          resetKey={0}
          onStatus={(status) => statuses.push(status)}
        />
      ))
      drawFrame(0)
      const record = fixtures.solvers[0]!
      let finish!: (state: Float32Array) => void
      record.nextPositions = new Promise((resolve) => {
        finish = resolve
      })
      cameraPointer('pointerdown', 1, 200, 200)
      expect(statuses.at(-1)).toBe('picking')
      if (transition === 'mode') setMode('pan')
      else cameraPointer('pointerdown', 2, 300, 200)
      expect(statuses.at(-1)).toBe('ready')
      finish(record.snapshot().positions)
      await record.nextPositions
      for (let i = 0; i < 8; i++) await Promise.resolve()
      expect(diagnostics().info().grip).toBe(false)
      expect(statuses).not.toContain('dragging')
      if (transition === 'second-touch') {
        const before = Array.from(
          fixtures.renderers[0]!.frames.at(-1)!.frame.viewProjection,
        )
        cameraPointer('pointermove', 2, 330, 220)
        diagnostics().render()
        expect(
          Array.from(
            fixtures.renderers[0]!.frames.at(-1)!.frame.viewProjection,
          ),
        ).not.toEqual(before)
        cameraPointer('pointerup', 2, 330, 220)
        cameraPointer('pointermove', 1, 210, 210)
        expect(diagnostics().info().grip).toBe(false)
        expect(statuses.filter((status) => status === 'picking')).toHaveLength(
          1,
        )
      } else expect(fixtures.canvas!.hasPointerCapture(1)).toBe(false)
    },
  )
  it('replaces solver and renderer owners when reconstruction changes and keeps lighting changes live', async () => {
    const [reconstruction, setReconstruction] = createSignal<
      'screen-space' | 'marching-cubes'
    >('screen-space')
    const [caustics, setCaustics] = createSignal(true)
    const [palette, setPalette] = createSignal<GummyPalette>('marble')
    const view = render(() => (
      <ParticleGummyBearScene
        palette={palette()}
        mode="drag"
        softness={0.55}
        particleMaterial="warm"
        fragility={0.88}
        reconstruction={reconstruction()}
        caustics={caustics()}
        tearing
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const previous = diagnostics()
    expect(previous.info().reconstruction).toBe('screen-space')
    expect(previous.readSurfaceStats).toBeUndefined()
    setReconstruction('marching-cubes')
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(fixtures.maxActiveSolvers).toBe(1)
    expect(frames.size).toBe(1)
    drawFrame(10)
    const current = diagnostics()
    expect(current).not.toBe(previous)
    expect(current.info()).toMatchObject({
      experiment: 'mpm',
      reconstruction: 'marching-cubes',
      steps: 0,
      settings: { caustics: true },
    })
    expect(fixtures.canvas!.dataset.experiment).toBe('mpm')
    expect(fixtures.canvas!.dataset.reconstruction).toBe('marching-cubes')
    const renderer = fixtures.renderers[1]!
    expect(renderer.gridBounds).toEqual({ min: [-2, 0, -2], max: [3, 5, 3] })
    expect(renderer.frames.at(-1)?.revision).toBe(0)
    current.advanceFrames(1)
    expect(fixtures.solvers[1]!.inputs[0]!.input).toMatchObject({
      particleMaterial: 'warm',
      fragility: 0.88,
      gripSpace: 'current',
    })
    expect(fixtures.solvers[1]!.reads).toBe(0)
    expect(renderer.statsReads).toBe(0)
    setCaustics(false)
    current.render()
    expect(renderer.frames.at(-1)?.caustics).toBe(false)
    expect(renderer.frames.at(-1)?.revision).toBe(1)
    const cameraBefore = Array.from(
      renderer.frames.at(-1)!.frame.viewProjection,
    )
    fireEvent.keyDown(fixtures.canvas!, { key: 'ArrowLeft' })
    setPalette('amber')
    current.render()
    expect(
      Array.from(renderer.frames.at(-1)!.frame.viewProjection),
    ).not.toEqual(cameraBefore)
    expect(renderer.frames.at(-1)?.frame.palette).toBe('amber')
    expect(renderer.frames.at(-1)?.revision).toBe(1)
    expect(fixtures.solvers).toHaveLength(2)
    expect(fixtures.solvers[1]!.resets).toBe(0)
    expect(current.info().steps).toBe(1)
    current.resetPaused()
    expect(renderer.frames.at(-1)?.revision).toBe(2)
    expect(current.info().steps).toBe(0)
    current.resetPaused()
    expect(renderer.frames.at(-1)?.revision).toBe(3)
    current.advanceFrames(2)
    expect(renderer.frames.at(-1)?.revision).toBe(5)
    await current.readSurfaceStats?.()
    expect(renderer.statsReads).toBe(1)
    setReconstruction('screen-space')
    expect(fixtures.solvers[1]!.destroyed).toBe(true)
    expect(renderer.destroyed).toBe(true)
    expect(fixtures.maxActiveSolvers).toBe(1)
    expect(diagnostics().info().experiment).toBe('particle')
    view.unmount()
    expect(fixtures.solvers.every((solver) => solver.destroyed)).toBe(true)
    expect(fixtures.renderers.every((renderer) => renderer.destroyed)).toBe(
      true,
    )
    expect(frames.size).toBe(0)
  })

  it('bounds GPU work in flight and resumes fixed-step playback after completion', async () => {
    let finish!: () => void
    fixtures.completion = new Promise<void>((resolve) => {
      finish = resolve
    })
    render(() => (
      <ParticleGummyBearScene
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused={false}
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    expect(diagnostics().info()).toMatchObject({
      submittedFrames: 1,
      completedFrames: 0,
      gpuPending: true,
      steps: 0,
    })
    for (let time = 1; time <= 20; time++) drawFrame(time)
    expect(fixtures.renderers[0]!.frames).toHaveLength(1)
    expect(fixtures.solvers[0]!.inputs).toHaveLength(0)
    finish()
    await Promise.resolve()
    drawFrame(25)
    expect(diagnostics().info()).toMatchObject({
      submittedFrames: 2,
      completedFrames: 1,
      steps: 3,
    })
    expect(fixtures.solvers[0]!.reads).toBe(0)
  })
  it('replaces GPU owners on fixture changes and forwards warm settings without per-frame reads', () => {
    const [fixture, setFixture] = createSignal<'bear' | 'blobs'>('bear')
    const [paused, setPaused] = createSignal(false)
    render(() => (
      <ParticleGummyBearScene
        palette="marble"
        mode="drag"
        softness={0.55}
        fragility={0.85}
        particleMaterial="warm"
        fixture={fixture()}
        tearing
        paused={paused()}
        demoKey={0}
        resetKey={0}
        onPauseChange={setPaused}
      />
    ))
    drawFrame(0)
    const previous = diagnostics()
    previous.advanceFrames(1)
    expect(fixtures.solvers[0]!.inputs[0]!.input).toMatchObject({
      particleMaterial: 'warm',
      fragility: 0.85,
      gripSpace: 'current',
    })
    expect(fixtures.solvers[0]!.reads).toBe(0)
    setFixture('blobs')
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(fixtures.solvers).toHaveLength(2)
    drawFrame(20)
    const current = diagnostics()
    expect(current).not.toBe(previous)
    expect(current.info().fixture).toBe('blobs')
    current.resetPaused()
    expect(paused()).toBe(true)
    expect(current.info().steps).toBe(0)
    expect(current.info().demo).toBe(false)
    expect(fixtures.renderers[1]!.frames.at(-1)?.frame.palette).toBe('lagoon')
    expect(frames.size).toBe(1)
  })
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
    let resolveRead!: (state: Float32Array) => void
    record.nextPositions = new Promise((resolve) => {
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
    expect(fixtures.pointerRenderers[0]!.destroyed).toBe(true)
    expect(canvas.hasPointerCapture(7)).toBe(false)
    expect(window.__gummyParticleStudy).toBeUndefined()
    statuses.mockClear()
    resolveRead(record.snapshot().positions)
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

  it.each(['screen-space', 'marching-cubes'] as const)(
    'rolls back the solver when %s renderer initialization fails',
    (reconstruction) => {
      fixtures.rendererError = 'No attachment capacity'
      render(() => (
        <ErrorBoundary fallback={<p>Renderer unavailable</p>}>
          <ParticleGummyBearScene
            palette="blue"
            mode="orbit"
            softness={0.55}
            reconstruction={reconstruction}
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
      expect(fixtures.pointerRenderers[0]!.destroyed).toBe(true)
      expect(frames.size).toBe(0)
      expect(window.__gummyParticleStudy).toBeUndefined()
    },
  )
})
