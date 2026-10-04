/** Experiment replacement must dispose owned GPU state and keep the press command in sync. */
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library'
import { createSignal, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGummyBearMesh } from '@/simulation/gummy/gummyMesh'
import { GummyBearScene } from './GummyBearScene'
import * as gummyStudyMath from './gummyStudyMath'
import type { ParentProps } from 'solid-js'
import type { GummyExperiment, GummyGeometry } from './GummyBearScene'
import type { GummyFrame } from './gummyRenderer'
import type { GummyJellyProtocol } from './gummyStudyMath'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'
import type { GummySolver, GummySolverDynamicState, GummySolverOptions, } from '@/simulation/gummy/gummySolver'

type Snapshot = Awaited<ReturnType<GummySolver['readState']>>
type SolverRecord = {
  mesh: GummyMesh
  materialModel: NonNullable<GummySolverOptions['materialModel']>
  destroyed: boolean
  inputs: Parameters<GummySolver['step']>[1][]
  nextRead?: Promise<Snapshot>
  nextDynamic?: Promise<GummySolverDynamicState>
  snapshot: () => Snapshot
}
type RendererRecord = {
  destroyed: boolean
  frames: GummyFrame[]
  mesh: GummyMesh
}
const fixtures = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  solvers: [] as SolverRecord[],
  renderers: [] as RendererRecord[],
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
vi.mock('@/simulation/gummy/gummySolver', () => ({
  createGummySolver(
    _root: unknown,
    _device: unknown,
    mesh: GummyMesh,
    options?: GummySolverOptions,
  ) {
    const record: SolverRecord = {
      mesh,
      materialModel: options?.materialModel ?? 'edge-volume',
      destroyed: false,
      inputs: [],
      snapshot: () =>
        ({
          positions: mesh.positions.slice(),
          damage: new Float32Array(mesh.interfaces.length / 8),
          simulationTime: 0,
          maxCohesiveForce: 0,
        }) as Snapshot,
    }
    fixtures.solvers.push(record)
    return {
      materialModel: record.materialModel,
      iterations: record.materialModel === 'neo-hookean' ? 12 : 5,
      vertexCount: mesh.positions.length / 4,
      interfaceCount: mesh.interfaces.length / 8,
      step(_dt: number, input: Parameters<GummySolver['step']>[1]) {
        if (record.destroyed) throw new Error('Stepped a destroyed solver')
        record.inputs.push(input)
      },
      reset() {
        record.inputs.length = 0
      },
      readState: () => record.nextRead ?? Promise.resolve(record.snapshot()),
      snapshotDynamic: () =>
        record.nextDynamic ??
        Promise.resolve({
          positions: mesh.positions.slice(),
          previous: mesh.positions.slice(),
          velocities: new Float32Array(mesh.positions.length),
          grip: new Float32Array(mesh.positions.length),
          simulationTime: 0,
          accumulator: 0,
          gripKey: '',
          gripping: false,
        }),
      restoreDynamic() {},
      destroy() {
        record.destroyed = true
      },
    }
  },
}))
vi.mock('./gummyRenderer', () => ({
  createGummyRenderer(
    _root: unknown,
    _device: unknown,
    _context: unknown,
    _format: unknown,
    mesh: GummyMesh,
  ) {
    const record: RendererRecord = { destroyed: false, frames: [], mesh }
    fixtures.renderers.push(record)
    return {
      render(frame: GummyFrame) {
        if (record.destroyed) throw new Error('Rendered destroyed resources')
        record.frames.push(frame)
      },
      destroy() {
        record.destroyed = true
      },
    }
  },
}))

let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()

function drawFrame(time: number) {
  const queued = frames.entries().next().value
  if (!queued) throw new Error('No animation frame was scheduled')
  const [id, callback] = queued
  frames.delete(id)
  callback(time)
}

function diagnostics() {
  if (!window.__gummyStudy)
    throw new Error('The study diagnostics were not mounted')
  return window.__gummyStudy
}
beforeEach(() => {
  fixtures.solvers.length = 0
  fixtures.renderers.length = 0
  frames.clear()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('owned gummy experiment scene', () => {
  it.each(['standard', 'fine'] as const)(
    'keeps the tear pick tolerance and grip footprint fixed for %s geometry',
    async (geometry) => {
      const pick = vi.spyOn(gummyStudyMath, 'pickGummyVertex')
      render(() => (
        <GummyBearScene
          experiment="jelly"
          protocol="tear"
          geometry={geometry}
          palette="marble"
          mode="drag"
          softness={0.55}
          tearing={false}
          paused
          demoKey={0}
          resetKey={0}
        />
      ))
      drawFrame(0)
      const pointer = new Event('pointerdown', { bubbles: true })
      Object.assign(pointer, {
        pointerId: 1,
        button: 0,
        clientX: 200,
        clientY: 200,
      })
      fixtures.canvas!.dispatchEvent(pointer)
      await waitFor(() => {
        expect(pick).toHaveBeenCalledOnce()
      })
      expect(pick.mock.calls[0]![2]).toBeCloseTo(0.119)
      expect(diagnostics().info().gripCommand?.radius).toBe(
        gummyStudyMath.GUMMY_JELLY_TEAR_GRIP_RADIUS,
      )
    },
  )

  it('replaces geometry safely during an outstanding fracture readback and preserves the chosen material', async () => {
    const [geometry, setGeometry] = createSignal<GummyGeometry>('standard')
    const ready: boolean[] = []
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        geometry={geometry()}
        palette="candy"
        mode="drag"
        softness={0.75}
        fragility={0.93}
        tearing
        paused
        demoKey={0}
        resetKey={0}
        onReady={(value) => ready.push(value)}
      />
    ))
    drawFrame(0)
    const previous = diagnostics()
    const current = fixtures.solvers[0]!
    expect(previous.info()).toMatchObject({
      geometry: 'standard',
      meshOptions: { spacing: 0.14 },
    })
    let complete!: (state: GummySolverDynamicState) => void
    current.nextDynamic = new Promise<GummySolverDynamicState>((resolve) => {
      complete = resolve
    })
    const advancing = previous.advanceFrames(6)
    await Promise.resolve()
    expect(previous.info().mutationPending).toBe(true)
    setGeometry('fine')
    expect(ready.at(-1)).toBe(false)
    drawFrame(20)
    expect(ready.at(-1)).toBe(true)
    expect(fixtures.solvers).toHaveLength(2)
    expect(current.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(diagnostics()).not.toBe(previous)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(frames.size).toBe(1)
    expect(diagnostics().info()).toMatchObject({
      geometry: 'fine',
      tick: 0,
      meshOptions: { spacing: 0.1 },
      settings: {
        palette: 'candy',
        softness: 0.75,
        fragility: 0.93,
        tearing: true,
      },
    })
    expect(fixtures.solvers[1]!.mesh.tetrahedra.length).toBeGreaterThan(
      current.mesh.tetrahedra.length,
    )
    complete({
      positions: current.mesh.positions.slice(),
      previous: current.mesh.positions.slice(),
      velocities: new Float32Array(current.mesh.positions.length),
      grip: new Float32Array(current.mesh.positions.length),
      simulationTime: 0.05,
      accumulator: 0,
      gripKey: '',
      gripping: false,
    })
    await advancing
    expect(fixtures.solvers).toHaveLength(2)
    expect(fixtures.solvers[1]!.inputs).toHaveLength(0)
    expect(diagnostics().info()).toMatchObject({
      geometry: 'fine',
      tick: 0,
      topologyRevision: 0,
      mutationPending: false,
    })
  })

  it('keeps all other protocols and models at standard geometry without remounting on an unused choice', () => {
    const [geometry, setGeometry] = createSignal<GummyGeometry>('fine')
    const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('squeeze')
    const [experiment, setExperiment] = createSignal<GummyExperiment>('jelly')
    render(() => (
      <GummyBearScene
        experiment={experiment()}
        protocol={protocol()}
        geometry={geometry()}
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing={false}
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    for (const mode of ['squeeze', 'stretch', 'pull', 'crush'] as const) {
      if (mode === 'squeeze' || mode === 'stretch') setProtocol(mode)
      else setExperiment(mode)
      const generation = diagnostics()
      expect(generation.info()).toMatchObject({
        geometry: 'standard',
        meshOptions: { spacing: 0.14 },
      })
      const resources = fixtures.solvers.length
      setGeometry(geometry() === 'fine' ? 'standard' : 'fine')
      expect(diagnostics()).toBe(generation)
      expect(fixtures.solvers).toHaveLength(resources)
    }
  })

  it('updates manual fragility without resetting GPU resources and keeps replay scoped to comparison protocols', () => {
    const [fragility, setFragility] = createSignal(0.88)
    const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('tear')
    const replay = vi.fn()
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol={protocol()}
        palette="marble"
        mode="drag"
        softness={0.55}
        fragility={fragility()}
        tearing={false}
        paused
        demoKey={0}
        resetKey={0}
        onReplay={replay}
      />
    ))
    drawFrame(0)
    expect(diagnostics().info().geometry).toBe('standard')
    expect(diagnostics().info().settings.fragility).toBe(0.88)
    fireEvent.keyDown(fixtures.canvas!, { key: 'd' })
    expect(replay).not.toHaveBeenCalled()
    setFragility(0.95)
    drawFrame(20)
    expect(diagnostics().info().settings.fragility).toBe(0.95)
    expect(fixtures.solvers).toHaveLength(1)
    expect(fixtures.renderers).toHaveLength(1)
    setProtocol('stretch')
    drawFrame(40)
    expect(diagnostics().info().settings.fragility).toBe(0)
    fireEvent.keyDown(fixtures.canvas!, { key: 'd' })
    expect(replay).toHaveBeenCalledOnce()
  })

  it('applies a waist hold only to tear without changing rest coordinates, normals or shared tetrahedra', () => {
    const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('tear')
    const original = buildGummyBearMesh({
      fracture: 'none',
      pinnedFeet: true,
      pinHeight: 0.48,
      spacing: 0.14,
    })
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol={protocol()}
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing={false}
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const held = fixtures.solvers[0]!.mesh
    expect(diagnostics().info().bodyFixture).toEqual({
      halfWidth: 0.3,
      minY: 0.85,
      maxY: 1.2,
      heldNodes: 135,
    })
    expect(held.tetrahedra).toEqual(original.tetrahedra)
    expect(fixtures.renderers[0]!.mesh.restNormals).toEqual(
      original.restNormals,
    )
    for (let i = 0; i < held.positions.length; i++)
      if (i % 4 !== 3) expect(held.positions[i]).toBe(original.positions[i])
    expect(
      held.positions.filter((_, i) => i % 4 === 3 && held.positions[i] === 0)
        .length,
    ).toBe(
      original.positions.filter(
        (_, i) => i % 4 === 3 && original.positions[i] === 0,
      ).length + 135,
    )
    setProtocol('stretch')
    drawFrame(1)
    expect(diagnostics().info().bodyFixture).toBeUndefined()
    expect(fixtures.solvers[1]!.mesh.positions).toEqual(original.positions)
  })
  it('bounds idle tear rendering and submits no RAF draws while an exact-step readback is pending', async () => {
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    for (let i = 1; i <= 1000; i++) drawFrame(i / 10)
    const renderer = fixtures.renderers[0]!
    expect(renderer.frames.length).toBeGreaterThanOrEqual(6)
    expect(renderer.frames.length).toBeLessThanOrEqual(7)
    const bounded = renderer.frames.length
    diagnostics().render()
    expect(renderer.frames).toHaveLength(bounded + 1)

    const current = fixtures.solvers[0]!
    let complete!: (state: GummySolverDynamicState) => void
    current.nextDynamic = new Promise<GummySolverDynamicState>((resolve) => {
      complete = resolve
    })
    const advancing = diagnostics().advanceFrames(6)
    await Promise.resolve()
    const beforeReadback = renderer.frames.length
    for (let i = 1; i <= 200; i++) drawFrame(100 + i)
    expect(renderer.frames).toHaveLength(beforeReadback)
    complete({
      positions: current.mesh.positions.slice(),
      previous: current.mesh.positions.slice(),
      velocities: new Float32Array(current.mesh.positions.length),
      grip: new Float32Array(current.mesh.positions.length),
      simulationTime: 0.05,
      accumulator: 0,
      gripKey: '',
      gripping: false,
    })
    await advancing
    expect(renderer.frames).toHaveLength(beforeReadback + 1)
    expect(diagnostics().info().fracturePerformance?.drawsDuringMutation).toBe(
      1,
    )
  })
  it('retains playing wall time across readback and catches up through the stable eight-tick limit', async () => {
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused={false}
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const current = fixtures.solvers[0]!
    let complete!: (state: GummySolverDynamicState) => void
    current.nextDynamic = new Promise<GummySolverDynamicState>((resolve) => {
      complete = resolve
    })
    const advancing = diagnostics().advanceFrames(6)
    await Promise.resolve()
    drawFrame(100)
    expect(current.inputs).toHaveLength(6)
    complete({
      positions: current.mesh.positions.slice(),
      previous: current.mesh.positions.slice(),
      velocities: new Float32Array(current.mesh.positions.length),
      grip: new Float32Array(current.mesh.positions.length),
      simulationTime: 0.05,
      accumulator: 0,
      gripKey: '',
      gripping: false,
    })
    await advancing
    drawFrame(150)
    await diagnostics().advanceFrames(0)
    expect(diagnostics().info().tick).toBe(14)
    expect(current.inputs).toHaveLength(14)
  })
  it('accepts a live grab during fracture readback and queues picking until the simulation is quiescent', async () => {
    const statuses: string[] = []
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused
        demoKey={0}
        resetKey={0}
        onStatus={(status) => statuses.push(status)}
      />
    ))
    drawFrame(0)
    const current = fixtures.solvers[0]!
    let complete!: (state: GummySolverDynamicState) => void
    current.nextDynamic = new Promise<GummySolverDynamicState>((resolve) => {
      complete = resolve
    })
    const advancing = diagnostics().advanceFrames(6)
    await Promise.resolve()
    expect(diagnostics().info().mutationPending).toBe(true)
    const pointer = new Event('pointerdown', { bubbles: true })
    Object.assign(pointer, {
      pointerId: 1,
      button: 0,
      clientX: 200,
      clientY: 200,
    })
    fixtures.canvas!.dispatchEvent(pointer)
    expect(statuses.at(-1)).toBe('picking')
    expect(fixtures.canvas!.hasPointerCapture(1)).toBe(true)
    drawFrame(5000)
    expect(current.inputs).toHaveLength(6)
    complete({
      positions: current.mesh.positions.slice(),
      previous: current.mesh.positions.slice(),
      velocities: new Float32Array(current.mesh.positions.length),
      grip: new Float32Array(current.mesh.positions.length),
      simulationTime: 0.05,
      accumulator: 0,
      gripKey: '',
      gripping: false,
    })
    await advancing
    await Promise.resolve()
    await Promise.resolve()
    expect(diagnostics().info().mutationPending).toBe(false)
    expect(current.inputs).toHaveLength(6)
  })
  it('pauses all tear stepping during assessment and discards readbacks taken before reset', async () => {
    const [resetKey, setResetKey] = createSignal(0)
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused
        demoKey={0}
        resetKey={resetKey()}
      />
    ))
    drawFrame(0)
    const current = fixtures.solvers[0]!
    let complete!: (state: GummySolverDynamicState) => void
    current.nextDynamic = new Promise<GummySolverDynamicState>((resolve) => {
      complete = resolve
    })
    diagnostics().startDemoPaused()
    const advancing = diagnostics().advanceFrames(12)
    await Promise.resolve()
    expect(diagnostics().info().tick).toBe(6)
    expect(diagnostics().info().mutationPending).toBe(true)
    drawFrame(5000)
    expect(current.inputs).toHaveLength(6)
    setResetKey(1)
    complete({
      positions: current.mesh.positions.slice(),
      previous: current.mesh.positions.slice(),
      velocities: new Float32Array(current.mesh.positions.length),
      grip: new Float32Array(current.mesh.positions.length),
      simulationTime: 0.05,
      accumulator: 0,
      gripping: true,
      gripKey: 'arm',
    })
    await advancing
    expect(diagnostics().info()).toMatchObject({
      tick: 0,
      topologyRevision: 0,
      mutationPending: false,
      demo: false,
    })
    expect(fixtures.solvers).toHaveLength(1)
    expect(current.inputs).toHaveLength(0)
    expect(diagnostics().info().settings.tearing).toBe(true)
  })
  it('returns a quiescent tear snapshot with current material topology while leaving disabled material welded', async () => {
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="tear"
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing={false}
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    diagnostics().startDemoPaused()
    await diagnostics().advanceFrames(12)
    const state = await diagnostics().readState()
    expect(diagnostics().info()).toMatchObject({
      tick: 12,
      protocol: 'tear',
      topologyRevision: 0,
      meshOptions: { fracture: 'none', pinHeight: 0.48 },
    })
    expect(state.topology?.initialVertexCount).toBe(state.positions.length / 4)
    expect(state.topology?.tetrahedra).toEqual(
      fixtures.solvers[0]!.mesh.tetrahedra,
    )
    expect(state.topology?.originalNodeIds.length).toBe(
      state.positions.length / 4,
    )
    expect(state.topology?.failedFaces).toEqual([])
    expect(state.dynamic?.velocities.length).toBe(state.positions.length)
    expect(state.fragments.connectedParts).toBe(1)
    expect(fixtures.solvers[0]!.inputs.every((input) => !input.tearing)).toBe(
      true,
    )
  })
  it('starts a paused continuous benchmark at tick zero and submits exact matching squeeze commands', async () => {
    const [paused, setPaused] = createSignal(false)
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol="squeeze"
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused={paused()}
        demoKey={0}
        resetKey={0}
        onPauseChange={setPaused}
      />
    ))
    drawFrame(0)
    diagnostics().startDemoPaused()
    expect(paused()).toBe(true)
    expect(diagnostics().info()).toMatchObject({
      tick: 0,
      steps: 0,
      phase: 'settling',
      protocol: 'squeeze',
      materialModel: 'neo-hookean',
      solverIterations: 12,
      pose: 'laid',
      regions: 1,
      interfaces: 0,
      meshOptions: { fracture: 'none', pinnedFeet: false, spacing: 0.14 },
      settings: {
        tearing: false,
        softness: 0.55,
        palette: 'marble',
        fixedDt: 1 / 120,
      },
    })
    drawFrame(10000)
    expect(diagnostics().info().tick).toBe(0)
    await diagnostics().advanceFrames(360)
    const info = diagnostics().info()
    expect(info.tick).toBe(360)
    expect(info.phase).toBe('holding')
    const expectedHeight =
      info.restBounds.min[1] +
      (info.restBounds.max[1] - info.restBounds.min[1]) * 0.6
    const submitted = fixtures.solvers[0]!.inputs.at(-1)!
    expect(submitted.press?.height).toBeCloseTo(expectedHeight)
    expect(submitted.tearing).toBe(false)
    expect(submitted.fragmentContact).toBe(false)
    expect(fixtures.renderers[0]!.frames.at(-1)!.press).toEqual(submitted.press)
    const state = await diagnostics().readState()
    expect(state.damage).toHaveLength(0)
    expect(state.fragments.connectedParts).toBe(1)
    expect(state.restPositions).toEqual(fixtures.solvers[0]!.mesh.positions)
    await diagnostics().advanceFrames(1080)
    expect(diagnostics().info()).toMatchObject({
      tick: 1440,
      phase: 'complete',
      demo: false,
    })
  })
  it('disposes the squeeze generation when switching to an anchored continuous stretch', async () => {
    const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('squeeze')
    render(() => (
      <GummyBearScene
        experiment="jelly"
        protocol={protocol()}
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing={false}
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    const previous = diagnostics()
    setProtocol('stretch')
    drawFrame(1)
    expect(fixtures.solvers).toHaveLength(2)
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(diagnostics()).not.toBe(previous)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(frames.size).toBe(1)
    expect(diagnostics().info()).toMatchObject({
      protocol: 'stretch',
      pose: 'upright',
      tick: 0,
      meshOptions: { fracture: 'none', pinnedFeet: true, pinHeight: 0.48 },
    })
    diagnostics().startDemoPaused()
    await diagnostics().advanceFrames(360)
    expect(diagnostics().info().grip).toBe(true)
    const held = fixtures.solvers[1]!.inputs.at(-1)!
    expect(held.press).toBeUndefined()
    expect(held.grip?.target[1]).toBeGreaterThan(held.grip!.center[1])
    await diagnostics().advanceFrames(360)
    expect(diagnostics().info().phase).toBe('recovering')
    expect(diagnostics().info().grip).toBe(false)
    expect(fixtures.solvers[1]!.inputs.at(-1)!.grip).toBeUndefined()
  })
  it('replaces the entire simulation on experiment change and disposes both generations', () => {
    const [experiment, setExperiment] = createSignal<GummyExperiment>('pull')
    const mounted = render(() => (
      <GummyBearScene
        experiment={experiment()}
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused
        demoKey={0}
        resetKey={0}
      />
    ))
    drawFrame(0)
    expect(diagnostics().info().experiment).toBe('pull')
    expect(
      fixtures.solvers[0]!.mesh.positions.some(
        (value, index) => index % 4 === 3 && value === 0,
      ),
    ).toBe(true)
    setExperiment('crush')
    drawFrame(1)
    expect(fixtures.solvers).toHaveLength(2)
    expect(fixtures.solvers[0]!.destroyed).toBe(true)
    expect(fixtures.renderers[0]!.destroyed).toBe(true)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(frames.size).toBe(1)
    expect(diagnostics().info().experiment).toBe('crush')
    expect(diagnostics().info().regions).toBe(116)
    expect(
      fixtures.solvers[1]!.mesh.positions.every(
        (value, index) => index % 4 !== 3 || value > 0,
      ),
    ).toBe(true)
    expect(fixtures.renderers[1]!.mesh.positions).not.toBe(
      fixtures.solvers[1]!.mesh.positions,
    )
    expect(
      Math.max(
        ...fixtures.renderers[1]!.mesh.positions.filter(
          (_, index) => index % 4 === 1,
        ),
      ),
    ).toBeGreaterThan(2.5)
    expect(
      Math.max(
        ...fixtures.solvers[1]!.mesh.positions.filter(
          (_, index) => index % 4 === 1,
        ),
      ),
    ).toBeLessThan(0.9)
    mounted.unmount()
    expect(fixtures.solvers.every((record) => record.destroyed)).toBe(true)
    expect(fixtures.renderers.every((record) => record.destroyed)).toBe(true)
    expect(frames.size).toBe(0)
    expect(window.__gummyStudy).toBeUndefined()
  })
  it('draws the exact press submitted to the solver and resets it above the mould', async () => {
    const [demoKey, setDemoKey] = createSignal(0)
    const [resetKey, setResetKey] = createSignal(0)
    render(() => (
      <GummyBearScene
        experiment="crush"
        palette="marble"
        mode="orbit"
        softness={0.55}
        tearing
        paused
        demoKey={demoKey()}
        resetKey={resetKey()}
      />
    ))
    drawFrame(0)
    setDemoKey(1)
    await diagnostics().advanceFrames(403)
    const submitted = fixtures.solvers[0]!.inputs.at(-1)!
    const rendered = fixtures.renderers[0]!.frames.at(-1)!
    expect(submitted.press?.height).toBeCloseTo(0.675)
    expect(submitted.press?.halfExtent).toBe(1.4)
    expect(submitted.fragmentContact).toBe(true)
    expect(submitted.fractureMode).toBe('tension-shear')
    expect(submitted.cohesiveStrength).toBe(1.5)
    expect(rendered.press).toEqual(submitted.press)
    expect(diagnostics().info().press).toEqual(submitted.press)
    expect((await diagnostics().readState()).fragments.connectedParts).toBe(1)
    setResetKey(1)
    diagnostics().render()
    expect(diagnostics().info().time).toBe(0)
    expect(fixtures.renderers[0]!.frames.at(-1)!.press).toEqual({
      height: 1.2,
      halfExtent: 1.4,
    })
  })
  it('ignores a pointer readback that completes after the old experiment is destroyed', async () => {
    const [experiment, setExperiment] = createSignal<GummyExperiment>('pull')
    const errors: (string | undefined)[] = []
    render(() => (
      <GummyBearScene
        experiment={experiment()}
        palette="marble"
        mode="drag"
        softness={0.55}
        tearing
        paused
        demoKey={0}
        resetKey={0}
        onError={(error) => {
          errors.push(error)
        }}
      />
    ))
    drawFrame(0)
    let complete!: (state: Snapshot) => void
    const old = fixtures.solvers[0]!
    old.nextRead = new Promise((resolve) => {
      complete = resolve
    })
    const pointer = new Event('pointerdown', { bubbles: true })
    Object.assign(pointer, {
      pointerId: 1,
      button: 0,
      clientX: 200,
      clientY: 200,
    })
    fixtures.canvas!.dispatchEvent(pointer)
    setExperiment('crush')
    drawFrame(1)
    complete(old.snapshot())
    await old.nextRead
    await Promise.resolve()
    expect(old.destroyed).toBe(true)
    expect(diagnostics().info().experiment).toBe('crush')
    expect(diagnostics().info().grip).toBe(false)
    expect(errors.filter((error) => error !== undefined)).toEqual([])
  })
})
