/** Owned gummy simulation, bounded fixed steps, and current-position pointer grips. */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { buildGummyJellyMesh } from '@/simulation/gummy/gummyJellyMesh'
import { buildGummyBearMesh } from '@/simulation/gummy/gummyMesh'
import { analyzeGummyFragments } from '@/simulation/gummy/gummyPartition'
import { createGummySolver } from '@/simulation/gummy/gummySolver'
import { createGummyFractureRuntime } from './gummyFractureRuntime'
import { createGummyRenderer } from './gummyRenderer'
import { advanceGummyClock, DEFAULT_GUMMY_CRUSH_ORBIT, DEFAULT_GUMMY_ORBIT, GUMMY_CRUSH_SECONDS, GUMMY_DEMO_SECONDS, GUMMY_JELLY_SECONDS, GUMMY_JELLY_TEAR_BODY_FIXTURE, GUMMY_JELLY_TEAR_GRIP_RADIUS, GUMMY_STEP, gummyCameraMatrices, gummyDemoGrip, gummyDemoPress, gummyDragFrame, gummyDragTarget, gummyJellyCommand, gummyRay, gummyRestBounds, holdGummyTearBody, layGummyBearBack, pickGummyVertex, } from './gummyStudyMath'
import type { GummyBenchmarkPhase, GummyClock, GummyDragFrame, GummyGrip, GummyJellyProtocol, GummyPress, } from './gummyStudyMath'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'
import type { GummySolverDynamicState } from '@/simulation/gummy/gummySolver'

export type GummyPalette =
  | 'blue'
  | 'amber'
  | 'berry'
  | 'candy'
  | 'lagoon'
  | 'marble'
export type GummyInteraction = 'drag' | 'orbit'
export type GummyExperiment = 'jelly' | 'pull' | 'crush'
export type GummyGeometry = 'standard' | 'fine'
export type GummyStudyStatus =
  | 'loading'
  | 'ready'
  | 'picking'
  | 'dragging'
  | 'pulling'
  | 'crushing'
  | 'stretching'
  | 'holding'
  | 'retracting'
  | 'settling'
export type GummyBearSceneProps = {
  experiment?: GummyExperiment
  protocol?: GummyJellyProtocol
  palette: GummyPalette
  mode: GummyInteraction
  softness: number
  fragility?: number
  tearResponse?: 'soft' | 'crumble'
  geometry?: GummyGeometry
  tearing: boolean
  paused: boolean
  demoKey: number
  resetKey: number
  resetViewKey?: number
  reducedMotion?: boolean
  onReady?: (ready: boolean) => void
  onStatus?: (status: GummyStudyStatus) => void
  onError?: (message: string | undefined) => void
  onPauseChange?: (paused: boolean) => void
  onReplay?: () => void
  onReset?: () => void
}

type GummyDiagnostics = {
  advanceFrames: (count: number) => void | Promise<void>
  startDemoPaused: () => void
  render: () => void
  readState: () => Promise<
    Awaited<ReturnType<ReturnType<typeof createGummySolver>['readState']>> & {
      fragments: ReturnType<typeof analyzeGummyFragments>
      restPositions: Float32Array
      topology?: ReturnType<
        ReturnType<typeof createGummyFractureRuntime>['topology']
      >
      dynamic?: GummySolverDynamicState
    }
  >
  info: () => {
    time: number
    steps: number
    vertices: number
    interfaces: number
    tetrahedra: number
    regions: number
    restVolume: number
    experiment: GummyExperiment
    geometry: GummyGeometry
    materialModel: 'neo-hookean' | 'edge-volume'
    solverIterations: number
    solverSubsteps: number
    protocol: GummyJellyProtocol | 'legacy-crush' | 'legacy-pull'
    phase: GummyBenchmarkPhase | 'idle'
    tick: number
    pose: 'laid' | 'upright'
    meshOptions: {
      fracture: 'none' | 'fine' | 'limbs'
      pinnedFeet: boolean
      pinHeight?: number
      spacing: number
    }
    restBounds: ReturnType<typeof gummyRestBounds>
    bodyFixture?: typeof GUMMY_JELLY_TEAR_BODY_FIXTURE & { heldNodes: number }
    settings: {
      softness: number
      fragility: number
      tearResponse: 'soft' | 'crumble'
      tearing: boolean
      palette: GummyPalette
      fixedDt: number
    }
    press?: GummyPress
    grip: boolean
    gripCommand?: GummyGrip
    demo: boolean
    mutationPending: boolean
    topologyRevision: number
    fractureSamplingTicks: number
    fracture?: ReturnType<typeof createGummyFractureRuntime>['diagnostics']
    fracturePerformance?: ReturnType<
      typeof createGummyFractureRuntime
    >['profile'] & {
      draws: number
      drawsDuringMutation: number
    }
  }
}
declare global {
  interface Window {
    __gummyStudy?: GummyDiagnostics
  }
}

export function GummyBearScene(props: GummyBearSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const configuration = createMemo<{
    experiment: GummyExperiment
    protocol: GummyJellyProtocol
    geometry: GummyGeometry
  }>(() => {
    const experiment = props.experiment ?? 'jelly'
    const protocol =
      experiment === 'jelly' ? (props.protocol ?? 'squeeze') : 'squeeze'
    return {
      experiment,
      protocol,
      geometry:
        experiment === 'jelly' && protocol === 'tear'
          ? (props.geometry ?? 'standard')
          : 'standard',
    }
  })
  const canvasLabel = createMemo(() =>
    configuration().experiment === 'jelly' &&
    configuration().protocol === 'tear'
      ? 'Interactive gummy bear. Grab and pull to tear. Space pauses, R resets, and arrow keys turn the view.'
      : 'Interactive gummy bear. D starts the demo, Space pauses, and arrow keys turn the view.',
  )
  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      data-testid="gummy-bear-scene"
    >
      <Show when={configuration()} keyed>
        {(active) => (
          <AutoCanvas
            pixelRatio={1}
            onVisibilityChange={setVisible}
            role="img"
            ariaLabel={canvasLabel()}
          >
            <NativeGummyBear
              {...props}
              experiment={active.experiment}
              protocol={active.protocol}
              geometry={active.geometry}
              visible={visible()}
            />
          </AutoCanvas>
        )}
      </Show>
    </div>
  )
}

type Pointer = { x: number; y: number }

function NativeGummyBear(
  props: GummyBearSceneProps & {
    visible: boolean
    experiment: GummyExperiment
    protocol: GummyJellyProtocol
    geometry: GummyGeometry
  },
) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  untrack(() => {
    props.onReady?.(false)
    props.onStatus?.('loading')
    props.onError?.(undefined)
  })
  const continuous = props.experiment === 'jelly'
  const tearProtocol = continuous && props.protocol === 'tear'
  const laid =
    props.experiment === 'crush' || (continuous && props.protocol === 'squeeze')
  const meshOptions: {
    fracture: 'none' | 'fine' | 'limbs'
    pinnedFeet: boolean
    pinHeight?: number
    spacing: number
  } = {
    fracture: continuous
      ? 'none'
      : props.experiment === 'crush'
        ? 'fine'
        : 'limbs',
    pinnedFeet: !laid,
    spacing: tearProtocol && props.geometry === 'fine' ? 0.1 : 0.14,
  }
  if (continuous && (props.protocol === 'stretch' || tearProtocol))
    meshOptions.pinHeight = 0.48
  const baseMesh = continuous
    ? buildGummyJellyMesh(meshOptions)
    : buildGummyBearMesh(meshOptions)
  const bodyFixture = tearProtocol
    ? holdGummyTearBody(baseMesh.positions)
    : undefined
  const initialMesh = bodyFixture
    ? { ...baseMesh, positions: bodyFixture.positions }
    : baseMesh
  let mesh = initialMesh
  let regions = new Set(mesh.nodeRegions).size
  let solverMesh = laid
    ? { ...mesh, positions: layGummyBearBack(mesh.positions) }
    : mesh
  const restBounds = gummyRestBounds(solverMesh.positions)
  const materialModel = continuous ? 'neo-hookean' : 'edge-volume'

  function allocatePair(
    nextMesh: GummyMesh,
    snapshot?: GummySolverDynamicState,
    sourceNodes?: Uint32Array,
  ) {
    const posedMesh = laid
      ? { ...nextMesh, positions: layGummyBearBack(nextMesh.positions) }
      : nextMesh
    const nextSolver = createGummySolver(root, device, posedMesh, {
      materialModel,
      jellyIterations: 24,
      jellySubsteps: tearProtocol && props.geometry === 'fine' ? 2 : 1,
    })
    try {
      if (snapshot) nextSolver.restoreDynamic(snapshot, sourceNodes)
      const nextRenderer = createGummyRenderer(
        root,
        device,
        context,
        canvasFormat,
        nextMesh,
        nextSolver,
      )
      return { solver: nextSolver, renderer: nextRenderer }
    } catch (error) {
      nextSolver.destroy()
      throw error
    }
  }
  const initialPair = allocatePair(mesh)
  let { solver, renderer } = initialPair
  const fractureRuntime = tearProtocol
    ? createGummyFractureRuntime<GummySolverDynamicState, typeof initialPair>(
        mesh,
        initialPair,
        allocatePair,
        (pair, nextMesh) => {
          solver = pair.solver
          renderer = pair.renderer
          mesh = nextMesh
          regions = new Set(nextMesh.nodeRegions).size
          solverMesh = nextMesh
        },
      )
    : undefined
  const settings = createMemo(() => ({
    palette: props.palette,
    mode: props.mode,
    softness: props.softness,
    fragility: tearProtocol ? (props.fragility ?? 0) : 0,
    tearResponse: props.tearResponse ?? 'crumble',
    tearing: continuous && !tearProtocol ? false : props.tearing,
    paused: props.paused,
    visible: props.visible,
  }))

  function defaultOrbit() {
    return {
      ...(laid ? DEFAULT_GUMMY_CRUSH_ORBIT : DEFAULT_GUMMY_ORBIT),
    }
  }

  let orbit = defaultOrbit()
  const viewProjection = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  let clock: GummyClock = { time: 0, remainder: 0 }
  let steps = 0,
    draws = 0,
    drawsDuringMutation = 0,
    raf = 0,
    disposed = false,
    ready = false,
    failed = false,
    request = 0
  let demo = false,
    picking = false,
    grip: GummyGrip | undefined
  let press = props.experiment === 'crush' ? gummyDemoPress(0) : undefined
  let benchmarkPhase: GummyBenchmarkPhase | 'idle' = 'idle'
  if (continuous && props.protocol === 'squeeze')
    press = gummyJellyCommand(0, props.protocol, restBounds).press
  let dragFrame: GummyDragFrame | undefined
  let dragPointer: number | undefined
  const pointers = new Map<number, Pointer>()
  let topologyEpoch = 0
  let advancing: Promise<void> | undefined
  let lastScheduledDraw = -Infinity
  let readers = 0
  const readerWaiters: (() => void)[] = []

  function status(value: GummyStudyStatus) {
    untrack(() => props.onStatus?.(value))
  }

  function release() {
    request++
    picking = false
    grip = undefined
    dragFrame = undefined
    dragPointer = undefined
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    pointers.clear()
    if (!demo) status('ready')
  }

  function reset(startDemo: boolean) {
    release()
    topologyEpoch++
    if (fractureRuntime) fractureRuntime.reset()
    else solver.reset()
    clock = { time: 0, remainder: 0 }
    steps = 0
    lastScheduledDraw = -Infinity
    draws = 0
    drawsDuringMutation = 0
    failed = false
    demo = startDemo
    press = props.experiment === 'crush' ? gummyDemoPress(0) : undefined
    benchmarkPhase = startDemo && continuous ? 'settling' : 'idle'
    if (continuous && props.protocol === 'squeeze')
      press = gummyJellyCommand(0, props.protocol, restBounds).press
    untrack(() => props.onError?.(undefined))
    status(
      startDemo
        ? props.experiment === 'crush'
          ? 'crushing'
          : continuous
            ? 'settling'
            : 'pulling'
        : 'ready',
    )
  }
  createEffect(
    on(
      () => props.resetKey,
      () => {
        reset(false)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.demoKey,
      () => {
        reset(true)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.resetViewKey,
      () => {
        orbit = defaultOrbit()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.mode,
      () => {
        release()
      },
      { defer: true },
    ),
  )

  function camera() {
    const size = canvasSize()
    gummyCameraMatrices(
      orbit,
      size.width / Math.max(1, size.height),
      viewProjection,
      inverse,
      eye,
      laid ? 'crush' : 'pull',
    )
    return size
  }

  function rayAt(x: number, y: number) {
    const bounds = canvas.getBoundingClientRect()
    camera()
    return gummyRay(
      (2 * (x - bounds.left)) / Math.max(1, bounds.width) - 1,
      1 - (2 * (y - bounds.top)) / Math.max(1, bounds.height),
      inverse,
    )
  }

  function orbitBy(dx: number, dy: number) {
    orbit.theta -= dx * 0.005
    orbit.phi = Math.max(0.4, Math.min(1.53, orbit.phi - dy * 0.005))
  }

  function zoomBy(factor: number) {
    orbit.zoom = Math.max(0.65, Math.min(1.8, orbit.zoom * factor))
  }

  function updateGrip(x: number, y: number) {
    if (!grip || !dragFrame) return
    const target = gummyDragTarget(rayAt(x, y), dragFrame)
    if (!target) return
    const delta = target.map((value, i) => value - grip!.center[i]!)
    const scale = Math.min(1, 1.6 / Math.max(Math.hypot(...delta), 1e-6))
    grip.target = [
      grip.center[0] + delta[0]! * scale,
      Math.max(0.04, grip.center[1] + delta[1]! * scale),
      grip.center[2] + delta[2]! * scale,
    ]
  }

  async function pick(event: PointerEvent) {
    const token = ++request
    const ray = rayAt(event.clientX, event.clientY)
    picking = true
    demo = false
    benchmarkPhase = 'idle'
    status('picking')
    try {
      const current = await readQuiescent(() => solver.readState())
      if (disposed || token !== request || !pointers.has(event.pointerId))
        return
      const point = pickGummyVertex(
        ray,
        current.positions,
        Math.max(0.09, (tearProtocol ? 0.14 : mesh.spacing) * 0.85),
      )
      if (!point) {
        status('ready')
        return
      }
      dragFrame = gummyDragFrame(ray, point)
      if (!dragFrame) {
        status('ready')
        return
      }
      grip = {
        center: point,
        target: [...point],
        radius: tearProtocol ? GUMMY_JELLY_TEAR_GRIP_RADIUS : 0.28,
      }
      dragPointer = event.pointerId
      const latest = pointers.get(event.pointerId)!
      updateGrip(latest.x, latest.y)
      status('dragging')
    } catch {
      if (!disposed && token === request) {
        failed = true
        release()
        props.onError?.('Could not read the bear for grabbing.')
      }
    } finally {
      // This public request sequence only rejects stale pointer reads; it is not a secret.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token === request) picking = false
    }
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || failed || !ready || pointers.size >= 2) return
    if (settings().mode === 'drag' && pointers.size > 0) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture(event.pointerId)
    canvas.focus({ preventScroll: true })
    if (settings().mode === 'drag') void pick(event)
  }

  function pointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const other = [...pointers.entries()].find(
      ([id]) => id !== event.pointerId,
    )?.[1]
    if (settings().mode === 'orbit') {
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y)
        const after = Math.hypot(
          event.clientX - other.x,
          event.clientY - other.y,
        )
        if (before > 0 && after > 0) zoomBy(before / after)
      } else orbitBy(event.clientX - previous.x, event.clientY - previous.y)
    } else if (dragPointer === event.pointerId)
      updateGrip(event.clientX, event.clientY)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  function pointerEnd(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    if (dragPointer === event.pointerId || picking) release()
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId)
  }

  function wheel(event: WheelEvent) {
    event.preventDefault()
    zoomBy(Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.0015))
  }

  function repeatedAction(event: KeyboardEvent) {
    return event.repeat && [' ', 'd', 'r'].includes(event.key.toLowerCase())
  }

  function replayFromKeyboard() {
    if (!tearProtocol) props.onReplay?.()
  }

  function keyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (repeatedAction(event)) {
      event.preventDefault()
      return
    }
    if (event.key === ' ') props.onPauseChange?.(!settings().paused)
    else if (event.key.toLowerCase() === 'd') replayFromKeyboard()
    else if (event.key.toLowerCase() === 'r') props.onReset?.()
    else if (event.key === 'ArrowLeft') orbitBy(-18, 0)
    else if (event.key === 'ArrowRight') orbitBy(18, 0)
    else if (event.key === 'ArrowUp') orbitBy(0, -18)
    else if (event.key === 'ArrowDown') orbitBy(0, 18)
    else if (event.key === '+' || event.key === '=') zoomBy(1 / 1.12)
    else if (event.key === '-') zoomBy(1.12)
    else if (event.key === 'Home') orbit = defaultOrbit()
    else if (event.key === 'Escape') release()
    else return
    event.preventDefault()
  }

  function simulate() {
    const state = settings()
    let demoGrip =
      demo && props.experiment === 'pull'
        ? gummyDemoGrip(clock.time, mesh.demoGrip)
        : undefined
    // Retain the exact last submitted command for drawing, including while paused.
    press =
      props.experiment === 'crush'
        ? gummyDemoPress(demo ? clock.time : 0)
        : undefined
    if (continuous) {
      const command = gummyJellyCommand(
        demo ? steps + 1 : 0,
        props.protocol,
        restBounds,
      )
      press = command.press
      demoGrip = demo ? command.grip : undefined
      if (demo) benchmarkPhase = command.phase
    }
    solver.step(GUMMY_STEP, {
      grip: demoGrip ?? grip,
      press,
      fragmentContact: props.experiment === 'crush',
      fractureMode: props.experiment === 'crush' ? 'tension-shear' : 'legacy',
      cohesiveStrength: props.experiment === 'crush' ? 1.5 : 1,
      softness: state.softness,
      tearing: state.tearing,
    })
    clock.time += GUMMY_STEP
    steps++
    if (demo) updateDemoStatus()
  }

  function updateDemoStatus() {
    if (continuous) {
      status(
        benchmarkPhase === 'loading'
          ? props.protocol === 'squeeze'
            ? 'crushing'
            : tearProtocol
              ? 'pulling'
              : 'stretching'
          : benchmarkPhase === 'holding'
            ? 'holding'
            : benchmarkPhase === 'releasing'
              ? 'retracting'
              : 'settling',
      )
    } else if (props.experiment === 'crush') {
      status(
        clock.time < 6.5
          ? 'crushing'
          : clock.time < 7.05
            ? 'holding'
            : clock.time < 8.45
              ? 'retracting'
              : 'settling',
      )
    } else status(clock.time < 5.4 ? 'pulling' : 'settling')
    const finished = continuous
      ? steps >= Math.round(GUMMY_JELLY_SECONDS / GUMMY_STEP)
      : clock.time >=
        (props.experiment === 'crush'
          ? GUMMY_CRUSH_SECONDS
          : GUMMY_DEMO_SECONDS)
    if (finished) {
      demo = false
      status('ready')
    }
  }

  function draw() {
    const size = camera()
    if (size.width <= 0 || size.height <= 0) return
    draws++
    if (advancing || fractureRuntime?.pending) drawsDuringMutation++
    renderer.render({
      width: size.width,
      height: size.height,
      viewProjection,
      inverseViewProjection: inverse,
      eye,
      palette: settings().palette,
      press,
    })
    canvas.dataset.simTime = clock.time.toFixed(4)
    canvas.dataset.steps = String(steps)
    canvas.dataset.grip = String(!!currentGrip())
    canvas.dataset.experiment = props.experiment
    canvas.dataset.materialModel = materialModel
    canvas.dataset.protocol = continuous ? props.protocol : props.experiment
    canvas.dataset.phase = benchmarkPhase
    canvas.dataset.tick = String(steps)
    canvas.dataset.pose = laid ? 'laid' : 'upright'
    canvas.dataset.regions = String(regions)
    canvas.dataset.pressHeight = press ? String(press.height) : ''
    canvas.dataset.demo = String(demo)
    canvas.dataset.topologyRevision = String(
      fractureRuntime?.diagnostics.topologyVersion ?? 0,
    )
    if (!ready) {
      ready = true
      props.onReady?.(true)
      status('ready')
    }
  }

  function currentGrip() {
    if (grip) return grip
    if (!demo) return undefined
    if (continuous)
      return gummyJellyCommand(steps, props.protocol, restBounds).grip
    if (props.experiment === 'pull')
      return gummyDemoGrip(clock.time, mesh.demoGrip)
    return undefined
  }

  function drawScheduled(now: number) {
    if (ready && now - lastScheduledDraw < 1000 / 60) return
    lastScheduledDraw = now
    draw()
  }

  function drawIdleFrame(now: number, busy: boolean, batchWillDraw: boolean) {
    if (
      failed ||
      document.visibilityState === 'hidden' ||
      (!settings().visible && ready)
    )
      return
    if (!fractureRuntime) draw()
    else if (!busy && !batchWillDraw) drawScheduled(now)
  }

  function reportFailure(error: unknown) {
    if (disposed) return
    failed = true
    release()
    props.onError?.(
      error instanceof Error
        ? error.message
        : 'The gummy simulation could not continue.',
    )
  }

  async function readQuiescent<T>(read: () => Promise<T>): Promise<T> {
    if (!fractureRuntime) return read()
    while (!disposed) {
      await advancing
      await fractureRuntime.pending
      const token = topologyEpoch
      readers++
      try {
        const value = await read()
        if (!disposed && token === topologyEpoch) return value
      } catch (error) {
        if (!disposed && token === topologyEpoch) throw error
      } finally {
        readers--
        if (!readers) for (const resume of readerWaiters.splice(0)) resume()
      }
    }
    throw new Error('The gummy study was replaced during readback.')
  }

  function advanceTearFrames(count: number, forceDraw = true): Promise<void> {
    const token = topologyEpoch
    const previous = advancing
    const task = (async () => {
      await previous
      for (let i = 0; i < count; i++) {
        if (readers)
          await new Promise<void>((resolve) => readerWaiters.push(resolve))
        if (disposed || failed || token !== topologyEpoch) return
        simulate()
        if (steps % 6 === 0)
          await fractureRuntime!.check(6 * GUMMY_STEP, settings())
      }
      if (!disposed && token === topologyEpoch) {
        if (forceDraw) draw()
        else drawScheduled(globalThis.performance.now())
      }
    })()
    const tracked = task.finally(() => {
      if (advancing === tracked) advancing = undefined
    })
    advancing = tracked
    return tracked
  }

  function frame(now: number) {
    if (disposed) return
    const state = settings()
    const sleeping =
      state.paused ||
      picking ||
      !state.visible ||
      document.visibilityState === 'hidden' ||
      failed
    const busy = !!advancing || !!fractureRuntime?.pending || readers > 0
    if (fractureRuntime && busy && !sleeping) {
      // Keep elapsed playing time for bounded catch-up after the readback; do not queue renders behind it.
      raf = requestAnimationFrame(frame)
      return
    }
    const advanced = advanceGummyClock(clock, now / 1000, sleeping)
    clock.wall = advanced.clock.wall
    clock.remainder = advanced.clock.remainder
    try {
      if (fractureRuntime) {
        if (!busy && advanced.steps)
          void advanceTearFrames(advanced.steps, false).catch(reportFailure)
      } else for (let i = 0; i < advanced.steps; i++) simulate()
      drawIdleFrame(now, busy, advanced.steps > 0)
    } catch (error) {
      reportFailure(error)
    }
    raf = requestAnimationFrame(frame)
  }
  const diagnostics: GummyDiagnostics = {
    advanceFrames(count) {
      if (!Number.isInteger(count) || count < 0 || count > 3600)
        throw new RangeError('Diagnostic steps must be between 0 and 3600')
      if (fractureRuntime) return advanceTearFrames(count)
      for (let i = 0; i < count; i++) simulate()
      draw()
    },
    startDemoPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(true)
      draw()
    },
    render: draw,
    readState: () =>
      readQuiescent(async () => {
        const state = await solver.readState()
        const dynamic = fractureRuntime
          ? await solver.snapshotDynamic()
          : undefined
        return {
          ...state,
          restPositions: solverMesh.positions.slice(),
          fragments: analyzeGummyFragments(mesh, state.damage),
          topology: fractureRuntime?.topology(),
          dynamic,
        }
      }),
    info: () => ({
      time: clock.time,
      steps,
      vertices: solver.vertexCount,
      interfaces: solver.interfaceCount,
      tetrahedra: mesh.tetrahedra.length / 4,
      regions,
      restVolume: mesh.restVolume,
      experiment: props.experiment,
      geometry: props.geometry,
      materialModel,
      solverIterations: solver.iterations,
      solverSubsteps: solver.jellySubsteps ?? 1,
      protocol: continuous
        ? props.protocol
        : props.experiment === 'crush'
          ? 'legacy-crush'
          : 'legacy-pull',
      phase: benchmarkPhase,
      tick: steps,
      pose: laid ? 'laid' : 'upright',
      meshOptions: { ...meshOptions },
      restBounds: { min: [...restBounds.min], max: [...restBounds.max] },
      bodyFixture: bodyFixture
        ? { ...GUMMY_JELLY_TEAR_BODY_FIXTURE, heldNodes: bodyFixture.heldNodes }
        : undefined,
      settings: {
        softness: settings().softness,
        fragility: settings().fragility,
        tearResponse: settings().tearResponse,
        tearing: settings().tearing,
        palette: settings().palette,
        fixedDt: GUMMY_STEP,
      },
      press: press ? { ...press } : undefined,
      grip: !!currentGrip(),
      gripCommand: currentGrip(),
      demo,
      mutationPending: !!advancing || !!fractureRuntime?.pending,
      topologyRevision: fractureRuntime?.diagnostics.topologyVersion ?? 0,
      fractureSamplingTicks: 6,
      fracture: fractureRuntime?.diagnostics,
      fracturePerformance: fractureRuntime
        ? { ...fractureRuntime.profile, draws, drawsDuringMutation }
        : undefined,
    }),
  }
  if (import.meta.env.DEV) window.__gummyStudy = diagnostics
  canvas.dataset.testid = 'gummy-bear-canvas'
  canvas.tabIndex = 0
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)
  canvas.addEventListener('lostpointercapture', pointerEnd)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', keyDown)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    topologyEpoch++
    release()
    cancelAnimationFrame(raf)
    if (window.__gummyStudy === diagnostics) delete window.__gummyStudy
    if (fractureRuntime) fractureRuntime.destroy()
    else {
      renderer.destroy()
      solver.destroy()
    }
    props.onReady?.(false)
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
    canvas.removeEventListener('lostpointercapture', pointerEnd)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('keydown', keyDown)
  })
  return null
}
