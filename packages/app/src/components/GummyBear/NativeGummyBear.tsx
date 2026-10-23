/** Owned gummy simulation, bounded fixed steps, and current-position pointer grips. */
import { createMemo, onCleanup, untrack } from 'solid-js'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { createGummyPointerRenderer } from './gummyPointerRenderer'
import { bindGummyStudyControls } from './gummyStudyControls'
import { createGummyStudyDiagnostics } from './gummyStudyDiagnostics'
import { bindGummyStudyCanvas, createGummyStudyInput, createGummyStudyKeyboard, } from './gummyStudyInput'
import { advanceGummyClock, DEFAULT_GUMMY_CRUSH_ORBIT, DEFAULT_GUMMY_ORBIT, GUMMY_JELLY_TEAR_GRIP_RADIUS, GUMMY_STEP, gummyCameraMatrices, gummyDemoGrip, gummyDemoPress, gummyDragTarget, gummyJellyCommand, gummyRay, pickGummyVertex, } from './gummyStudyMath'
import { gummyStudyProgress } from './gummyStudyProgress'
import { createGummyStudyResources } from './gummyStudyResources'
import type { GummyBearSceneProps, GummyExperiment, GummyGeometry, GummyStudyStatus, GummySurface, } from './gummyStudyContracts'
import type { GummyBenchmarkPhase, GummyClock, GummyJellyProtocol, } from './gummyStudyMath'

export function NativeGummyBear(
  props: GummyBearSceneProps & {
    visible: boolean
    experiment: GummyExperiment
    protocol: GummyJellyProtocol
    geometry: GummyGeometry
  },
) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  const pointerRenderer = createGummyPointerRenderer(
    root,
    device,
    context,
    canvasFormat,
  )
  onCleanup(() => {
    pointerRenderer.destroy()
  })
  untrack(() => {
    props.onReady?.(false)
    props.onStatus?.('loading')
    props.onError?.(undefined)
  })
  const resources = createGummyStudyResources(
    root,
    device,
    context,
    canvasFormat,
    props,
  )
  const {
    continuous,
    tearProtocol,
    laid,
    restBounds,
    materialModel,
    fractureRuntime,
  } = resources
  const surface = createMemo<GummySurface>(() =>
    tearProtocol ? (props.surface ?? 'original') : 'original',
  )
  const settings = createMemo(() => ({
    palette: props.palette,
    mode: props.mode,
    softness: props.softness,
    fragility: tearProtocol ? (props.fragility ?? 0) : 0,
    tearResponse: props.tearResponse ?? 'crumble',
    tearing: continuous && !tearProtocol ? false : props.tearing,
    paused: props.paused,
    visible: props.visible || props.recording === true,
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
    failed = false
  let demo = false
  let press = props.experiment === 'crush' ? gummyDemoPress(0) : undefined
  let benchmarkPhase: GummyBenchmarkPhase | 'idle' = 'idle'
  if (continuous && props.protocol === 'squeeze')
    press = gummyJellyCommand(0, props.protocol, restBounds).press
  let topologyEpoch = 0
  let advancing: Promise<void> | undefined
  let lastScheduledDraw = -Infinity
  let readers = 0
  const readerWaiters: (() => void)[] = []

  function status(value: GummyStudyStatus) {
    untrack(() => props.onStatus?.(value))
  }

  function release() {
    input.cancel()
  }

  function reset(startDemo: boolean) {
    release()
    topologyEpoch++
    if (fractureRuntime) fractureRuntime.reset()
    else resources.solver.reset()
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
  bindGummyStudyControls(props, {
    reset,
    release,
    resetView: () => {
      orbit = defaultOrbit()
    },
  })

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

  const interaction = createGummyStudyInput({
    canvas,
    orbit: () => orbit,
    mode: () => settings().mode,
    ready: () => ready && !failed,
    disposed: () => disposed,
    rayAt,
    demo: () => demo,
    onStatus: status,
    onPickStart: () => {
      demo = false
      benchmarkPhase = 'idle'
    },
    readPick: async (ray) => {
      const positions = await readQuiescent(() =>
        resources.solver.readPositions(),
      )
      const point = pickGummyVertex(
        ray,
        positions,
        Math.max(0.09, (tearProtocol ? 0.14 : resources.mesh.spacing) * 0.85),
      )
      return point
        ? {
            point,
            grip: {
              center: point,
              target: [...point],
              radius: tearProtocol ? GUMMY_JELLY_TEAR_GRIP_RADIUS : 0.28,
            },
          }
        : undefined
    },
    updateTarget: (grip, dragFrame, ray) => {
      const target = gummyDragTarget(ray, dragFrame)
      if (!target) return
      const delta = target.map((value, i) => value - grip.center[i]!)
      const scale = Math.min(1, 1.6 / Math.max(Math.hypot(...delta), 1e-6))
      grip.target = [
        grip.center[0] + delta[0]! * scale,
        Math.max(0.04, grip.center[1] + delta[1]! * scale),
        grip.center[2] + delta[2]! * scale,
      ]
    },
    onFailure: () => {
      failed = true
      release()
      props.onError?.('Could not read the bear for grabbing.')
    },
    experiment: laid ? 'crush' : 'pull',
  })
  const input = interaction.input

  const keyDown = createGummyStudyKeyboard({
    input,
    paused: () => settings().paused,
    onPauseChange: (paused) => props.onPauseChange?.(paused),
    onReplay: () => {
      if (!tearProtocol) props.onReplay?.()
    },
    onReset: () => props.onReset?.(),
    resetView: () => {
      orbit = defaultOrbit()
    },
  })

  function simulate() {
    const state = settings()
    let demoGrip =
      demo && props.experiment === 'pull'
        ? gummyDemoGrip(clock.time, resources.mesh.demoGrip)
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
    resources.solver.step(GUMMY_STEP, {
      grip: demoGrip ?? interaction.grip,
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
    const progress = gummyStudyProgress(
      props,
      benchmarkPhase,
      clock.time,
      steps,
    )
    status(progress.status)
    if (progress.finished) {
      demo = false
      status('ready')
    }
  }

  function publishMutationState() {
    if (disposed) return
    canvas.dataset.mutationPending = String(
      !!advancing || !!fractureRuntime?.pending,
    )
    canvas.dataset.topologyRevision = String(
      fractureRuntime?.diagnostics.topologyVersion ?? 0,
    )
  }

  function draw() {
    const size = camera()
    if (size.width <= 0 || size.height <= 0) return
    draws++
    if (advancing || fractureRuntime?.pending) drawsDuringMutation++
    resources.renderer.render({
      width: size.width,
      height: size.height,
      viewProjection,
      inverseViewProjection: inverse,
      eye,
      palette: settings().palette,
      surface: surface(),
      press,
    })
    const pointer =
      props.pointerGuide === false
        ? undefined
        : input.guide(interaction.grip, interaction.dragFrame?.point)
    pointerRenderer.render({ ...size, viewProjection, pointer })
    canvas.dataset.pointerGuide = pointer
      ? pointer.active
        ? 'grab'
        : 'hover'
      : 'off'
    canvas.dataset.simTime = clock.time.toFixed(4)
    canvas.dataset.steps = String(steps)
    canvas.dataset.grip = String(!!currentGrip())
    canvas.dataset.experiment = props.experiment
    canvas.dataset.materialModel = materialModel
    canvas.dataset.surface = surface()
    canvas.dataset.protocol = continuous ? props.protocol : props.experiment
    canvas.dataset.phase = benchmarkPhase
    canvas.dataset.tick = String(steps)
    canvas.dataset.pose = laid ? 'laid' : 'upright'
    canvas.dataset.regions = String(resources.regions)
    canvas.dataset.pressHeight = press ? String(press.height) : ''
    canvas.dataset.demo = String(demo)
    publishMutationState()
    if (!ready) {
      ready = true
      props.onReady?.(true)
      status('ready')
    }
  }

  function currentGrip() {
    if (interaction.grip) return interaction.grip
    if (!demo) return undefined
    if (continuous)
      return gummyJellyCommand(steps, props.protocol, restBounds).grip
    if (props.experiment === 'pull')
      return gummyDemoGrip(clock.time, resources.mesh.demoGrip)
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
      interaction.picking ||
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
      if (advancing === tracked) {
        advancing = undefined
        // A scheduled draw may be throttled. Publish the matching revision
        // before exposing quiescence, without adding another render.
        publishMutationState()
      }
    })
    advancing = tracked
    publishMutationState()
    return tracked
  }

  function frame(now: number) {
    if (disposed) return
    const state = settings()
    const sleeping =
      state.paused ||
      interaction.picking ||
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
  const diagnostics = createGummyStudyDiagnostics({
    props,
    resources,
    surface,
    settings: () => ({ ...settings(), fixedDt: GUMMY_STEP }),
    state: () => ({
      clock,
      steps,
      benchmarkPhase,
      demo,
      advancing: !!advancing,
      draws,
      drawsDuringMutation,
    }),
    currentGrip,
    press: () => press,
    draw,
    reset,
    simulate,
    advanceTearFrames,
    readQuiescent,
  })
  if (import.meta.env.DEV) window.__gummyStudy = diagnostics
  canvas.dataset.testid = 'gummy-bear-canvas'
  const releaseTouchSurface = bindGummyStudyCanvas(canvas, input, keyDown)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    topologyEpoch++
    release()
    releaseTouchSurface()
    cancelAnimationFrame(raf)
    if (window.__gummyStudy === diagnostics) delete window.__gummyStudy
    resources.destroy()
    props.onReady?.(false)
  })
  return null
}
