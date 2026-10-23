/** Isolated particle-jelly GPU ownership, fixed-tick pulling and current-state input. */
import { createMemo, onCleanup, untrack } from 'solid-js'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { GUMMY_CHESS_MOULDS, isGummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'
import { gummyBlobDyePositions } from '@/simulation/gummy/gummyParticleFixtures'
import { normalizeGummyParticleTuning } from '@/simulation/gummy/gummyParticleMath'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import { bindGummyGpuErrors } from './gummyGpuErrors'
import { createGummyPointerRenderer } from './gummyPointerRenderer'
import { bindGummyStudyControls } from './gummyStudyControls'
import { bindGummyStudyCanvas, createGummyStudyInput, createGummyStudyKeyboard, } from './gummyStudyInput'
import { advanceGummyClock, DEFAULT_GUMMY_ORBIT, GUMMY_STEP, gummyCameraMatrices, gummyCameraRadius, gummyDragTarget, gummyRay, gummyRestBounds, } from './gummyStudyMath'
import { createMarchingGummyRenderer } from './marchingGummyRenderer'
import { createParticleGummyRenderer } from './particleGummyRenderer'
import { createParticleStudyDiagnostics } from './particleStudyDiagnostics'
import { PARTICLE_STUDY_TICKS, particleGripControls, particleStudyCommand, pickParticleGrip, } from './particleStudyMath'
import type { GummyStudyStatus } from './GummyBearScene'
import type { GummyBenchmarkPhase, GummyClock } from './gummyStudyMath'
import type { ParticleDiagnosticRenderOptions, ParticleGummyBearSceneProps, } from './particleStudyContracts'

export function NativeParticleGummyBear(
  props: ParticleGummyBearSceneProps & { visible: boolean },
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
  const fixture = untrack(() => props.fixture ?? 'bear')
  const reconstruction = untrack(() => props.reconstruction ?? 'screen-space')
  const experiment = reconstruction === 'marching-cubes' ? 'mpm' : 'particle'
  const solver = createGummyParticleSolver(root, device, {
    fixture,
    pinnedFeet: props.pinnedFeet,
  })
  let renderer:
    | ReturnType<typeof createParticleGummyRenderer>
    | ReturnType<typeof createMarchingGummyRenderer>
  try {
    const createRenderer =
      reconstruction === 'marching-cubes'
        ? createMarchingGummyRenderer
        : createParticleGummyRenderer
    renderer = createRenderer(root, device, context, canvasFormat, {
      positions: solver.positions,
      restPositions: solver.restPositions,
      particleCount: solver.particleCount,
      spacing: solver.spacing,
      gridBounds: solver.gridBounds,
      dyePositions:
        fixture === 'blobs'
          ? gummyBlobDyePositions(solver.restPositions)
          : undefined,
    })
  } catch (error) {
    solver.destroy()
    throw error
  }
  const restBounds = gummyRestBounds(solver.restPositions)
  const cameraFraming = isGummyChessMould(fixture)
    ? {
        ...GUMMY_CHESS_MOULDS[fixture].bounds,
        surfacePadding: solver.spacing * 1.5,
      }
    : undefined
  const settings = createMemo(() => ({
    palette: props.palette,
    mode: props.mode,
    softness: props.softness,
    tearing: props.tearing,
    paused: props.paused,
    visible: props.visible || props.recording === true,
    particleMaterial: props.particleMaterial ?? 'elastic',
    fragility: props.fragility ?? 0.75,
    caustics: props.caustics ?? true,
    tuning: normalizeGummyParticleTuning(props.tuning),
    gripControls: particleGripControls(
      props.grabRadius,
      props.maxPull,
      props.particleMaterial === 'warm',
    ),
  }))
  let orbit = { ...DEFAULT_GUMMY_ORBIT }
  const viewProjection = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  let clock: GummyClock = { time: 0, remainder: 0 }
  let steps = 0,
    surfaceRevision = 0,
    raf = 0
  let disposed = false,
    failed = false,
    ready = false,
    demo = false
  let gpuPending = false,
    submittedFrames = 0,
    completedFrames = 0
  let phase: GummyBenchmarkPhase | 'idle' = 'idle'
  let releaseGpuErrors = () => {}

  function status(value: GummyStudyStatus) {
    untrack(() => props.onStatus?.(value))
  }

  function release() {
    input.cancel()
  }

  function reset(startDemo: boolean) {
    releaseGpuErrors()
    releaseGpuErrors = watchGpuErrors()
    release()
    solver.reset()
    surfaceRevision++
    clock = { time: 0, remainder: 0 }
    steps = 0
    failed = false
    demo = startDemo
    phase = startDemo ? 'settling' : 'idle'
    untrack(() => props.onError?.(undefined))
    status(startDemo ? 'settling' : 'ready')
  }
  bindGummyStudyControls(props, {
    reset,
    release,
    resetView: () => {
      orbit = { ...DEFAULT_GUMMY_ORBIT }
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
      'pull',
      cameraFraming,
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
      phase = 'idle'
    },
    readPick: async (ray) => {
      const positions = await solver.readPositions()
      const picked = pickParticleGrip(
        ray,
        positions,
        solver.restPositions,
        Math.max(0.08, solver.spacing * 0.85),
        settings().particleMaterial === 'warm' ? 'current' : 'rest',
      )
      if (picked) picked.grip.radius = settings().gripControls.radius
      return picked
    },
    updateTarget: (grip, dragFrame, ray) => {
      const target = gummyDragTarget(ray, dragFrame)
      if (!target) return
      const start = dragFrame.point
      const dx = target[0] - start[0],
        dy = target[1] - start[1],
        dz = target[2] - start[2]
      const scale = Math.min(
        1,
        settings().gripControls.maxPull /
          Math.max(Math.hypot(dx, dy, dz), 1e-6),
      )
      grip.target = [
        start[0] + dx * scale,
        Math.max(0.04, start[1] + dy * scale),
        start[2] + dz * scale,
      ]
    },
    onFailure: () => {
      failed = true
      release()
      props.onError?.('Could not read the jelly for grabbing.')
    },
    cameraRadius: () => {
      const size = canvasSize()
      return gummyCameraRadius(
        orbit,
        size.width / Math.max(1, size.height),
        'pull',
        cameraFraming,
      )
    },
  })
  const input = interaction.input

  // Invalid WebGPU submissions need not throw or reject the queue fence. Surface
  // the device error instead of presenting a responsive handle over frozen jelly.
  function watchGpuErrors() {
    return bindGummyGpuErrors(device, (message) => {
      if (disposed) return
      failed = true
      release()
      props.onError?.(message)
    })
  }
  releaseGpuErrors = watchGpuErrors()
  onCleanup(() => {
    releaseGpuErrors()
  })

  const keyDown = createGummyStudyKeyboard({
    input,
    paused: () => settings().paused,
    onPauseChange: (paused) => props.onPauseChange?.(paused),
    onReplay: () => {
      props.onReplay?.()
    },
    onReset: () => props.onReset?.(),
    resetView: () => {
      orbit = { ...DEFAULT_GUMMY_ORBIT }
    },
  })

  function currentGrip() {
    return (
      interaction.grip ?? (demo ? particleStudyCommand(steps).grip : undefined)
    )
  }

  function simulate() {
    const state = settings()
    const command = demo ? particleStudyCommand(steps + 1) : undefined
    solver.step(GUMMY_STEP, {
      softness: state.softness,
      tearing: state.tearing,
      particleMaterial: state.particleMaterial,
      fragility: state.fragility,
      tuning: state.tuning,
      gripSpace:
        !demo && state.particleMaterial === 'warm' ? 'current' : 'rest',
      grip: command?.grip ?? interaction.grip,
    })
    surfaceRevision++
    steps++
    clock.time = steps * GUMMY_STEP
    if (!demo || !command) return
    phase = command.phase
    status(
      phase === 'loading'
        ? 'pulling'
        : phase === 'holding'
          ? 'holding'
          : 'settling',
    )
    if (steps >= PARTICLE_STUDY_TICKS) {
      demo = false
      status('ready')
    }
  }

  function draw(options: ParticleDiagnosticRenderOptions = {}) {
    const size = camera()
    if (size.width <= 0 || size.height <= 0) return
    renderer.render(
      {
        width: size.width,
        height: size.height,
        viewProjection,
        inverseViewProjection: inverse,
        eye,
        palette: fixture === 'blobs' ? 'lagoon' : settings().palette,
        floor: isGummyChessMould(fixture) ? 'chess' : 'studio',
        clay: options.clay,
      },
      {
        raw: options.raw,
        caustics: settings().caustics,
        revision: surfaceRevision,
      },
    )
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
    canvas.dataset.testid = 'gummy-bear-canvas'
    canvas.dataset.simTime = clock.time.toFixed(4)
    canvas.dataset.steps = String(steps)
    canvas.dataset.tick = String(steps)
    canvas.dataset.grip = String(!!currentGrip())
    canvas.dataset.experiment = experiment
    canvas.dataset.reconstruction = reconstruction
    canvas.dataset.fixture = fixture
    canvas.dataset.particleMaterial = settings().particleMaterial
    canvas.dataset.materialModel = 'mls-mpm'
    canvas.dataset.protocol = 'lateral-pull'
    canvas.dataset.phase = phase
    canvas.dataset.pose = 'upright'
    canvas.dataset.demo = String(demo)
    if (!ready) {
      ready = true
      props.onReady?.(true)
      status('ready')
    }
  }

  function frame(now: number) {
    if (disposed) return
    // Keep pointer latency bounded: a fast RAF source must not enqueue seconds
    // of simulation/rendering ahead of the GPU. Preserve wall time until the
    // next admitted frame; advanceGummyClock bounds catch-up after a long stall.
    if (gpuPending) {
      raf = requestAnimationFrame(frame)
      return
    }
    const state = settings()
    const sleeping =
      state.paused ||
      interaction.picking ||
      !state.visible ||
      document.visibilityState === 'hidden' ||
      failed
    const advanced = advanceGummyClock(clock, now / 1000, sleeping)
    clock.wall = advanced.clock.wall
    clock.remainder = advanced.clock.remainder
    try {
      for (let i = 0; i < advanced.steps; i++) simulate()
      if (
        !failed &&
        !interaction.picking &&
        document.visibilityState !== 'hidden' &&
        (state.visible || !ready)
      ) {
        draw()
        submittedFrames++
        gpuPending = true
        void device.queue
          .onSubmittedWorkDone()
          .then(() => {
            gpuPending = false
            completedFrames++
          })
          .catch((error: unknown) => {
            gpuPending = false
            if (disposed) return
            failed = true
            props.onError?.(
              error instanceof Error
                ? error.message
                : 'The GPU could not finish the jelly frame.',
            )
          })
      }
    } catch (error) {
      failed = true
      props.onError?.(
        error instanceof Error
          ? error.message
          : 'The particle jelly could not continue.',
      )
    }
    raf = requestAnimationFrame(frame)
  }
  const diagnostics = createParticleStudyDiagnostics({
    props,
    solver,
    renderer,
    experiment,
    reconstruction,
    fixture,
    restBounds,
    settings,
    state: () => ({
      clock,
      steps,
      phase,
      demo,
      submittedFrames,
      completedFrames,
      gpuPending,
    }),
    currentGrip,
    draw,
    reset,
    simulate,
  })
  if (import.meta.env.DEV) window.__gummyParticleStudy = diagnostics
  canvas.dataset.testid = 'gummy-bear-canvas'
  const releaseTouchSurface = bindGummyStudyCanvas(canvas, input, keyDown)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    release()
    releaseTouchSurface()
    cancelAnimationFrame(raf)
    if (window.__gummyParticleStudy === diagnostics)
      delete window.__gummyParticleStudy
    renderer.destroy()
    solver.destroy()
    props.onReady?.(false)
  })
  return null
}
