/** Isolated particle-jelly GPU ownership, fixed-tick pulling and current-state input. */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { GUMMY_CHESS_MOULDS, isGummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'
import { gummyBlobDyePositions } from '@/simulation/gummy/gummyParticleFixtures'
import { normalizeGummyParticleTuning } from '@/simulation/gummy/gummyParticleMath'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import { bindGummyTouchSurface, createGummyCameraInput, } from './gummyCameraInput'
import { bindGummyGpuErrors } from './gummyGpuErrors'
import { createGummyPointerRenderer } from './gummyPointerRenderer'
import { advanceGummyClock, DEFAULT_GUMMY_ORBIT, GUMMY_STEP, gummyCameraMatrices, gummyCameraRadius, gummyDragFrame, gummyDragTarget, gummyRay, gummyRestBounds, } from './gummyStudyMath'
import { createMarchingGummyRenderer } from './marchingGummyRenderer'
import { createParticleGummyRenderer } from './particleGummyRenderer'
import { PARTICLE_STUDY_TICKS, particleGripControls, particleStudyCommand, pickParticleGrip, } from './particleStudyMath'
import type { GummyBearSceneProps, GummyStudyStatus } from './GummyBearScene'
import type { GummyBenchmarkPhase, GummyClock, GummyDragFrame, GummyGrip, } from './gummyStudyMath'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleMath'

export type ParticleGummyBearSceneProps = Omit<
  GummyBearSceneProps,
  'experiment' | 'protocol'
> & {
  particleMaterial?: 'elastic' | 'warm'
  fixture?: GummyParticleFixture
  reconstruction?: 'screen-space' | 'marching-cubes'
  caustics?: boolean
  tuning?: Partial<GummyParticleTuning>
  grabRadius?: number
  maxPull?: number
  pinnedFeet?: boolean
}

type ParticleDiagnosticRenderOptions = { raw?: boolean; clay?: boolean }

type ParticleDiagnostics = {
  advanceFrames: (count: number) => void
  startDemoPaused: () => void
  resetPaused: () => void
  render: (options?: ParticleDiagnosticRenderOptions) => void
  readSurfaceStats?: ReturnType<
    typeof createMarchingGummyRenderer
  >['readSurfaceStats']
  readState: () => Promise<
    Awaited<
      ReturnType<ReturnType<typeof createGummyParticleSolver>['readState']>
    > & { restPositions: Float32Array }
  >
  info: () => {
    experiment: 'particle' | 'mpm'
    reconstruction: 'screen-space' | 'marching-cubes'
    fixture: GummyParticleFixture
    pose: 'upright'
    materialModel: 'mls-mpm'
    protocol: 'lateral-pull'
    phase: GummyBenchmarkPhase | 'idle'
    time: number
    steps: number
    tick: number
    particleCount: number
    spacing: number
    gridSpacing: number
    restVolume: number
    gridBounds: { min: number[]; max: number[] }
    substeps: number
    restBounds: ReturnType<typeof gummyRestBounds>
    grip: boolean
    gripCommand?: GummyGrip
    demo: boolean
    submittedFrames: number
    completedFrames: number
    gpuPending: boolean
    settings: {
      softness: number
      tearing: boolean
      palette: GummyBearSceneProps['palette']
      fixedDt: number
      particleMaterial: 'elastic' | 'warm'
      fragility: number
      caustics: boolean
      tuning: GummyParticleTuning
      grabRadius: number
      maxPull: number
      pinnedFeet: boolean
      pointerGuide: boolean
    }
  }
}

declare global {
  interface Window {
    __gummyParticleStudy?: ParticleDiagnostics
  }
}

export function ParticleGummyBearScene(props: ParticleGummyBearSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const model = createMemo(() => ({
    fixture: props.fixture ?? 'bear',
    reconstruction: props.reconstruction ?? 'screen-space',
    pinnedFeet: props.fixture === 'blobs' ? false : props.pinnedFeet !== false,
  }))
  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      data-testid="particle-gummy-bear-scene"
    >
      <AutoCanvas
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel="Interactive particle jelly. Drag to stretch, Space pauses, arrow keys turn the view, and Shift plus arrows pans. Two fingers pan and pinch to zoom."
      >
        <Show when={model()} keyed>
          {(selected) => (
            <NativeParticleGummyBear
              {...props}
              fixture={selected.fixture}
              reconstruction={selected.reconstruction}
              pinnedFeet={selected.pinnedFeet}
              visible={visible()}
            />
          )}
        </Show>
      </AutoCanvas>
    </div>
  )
}

function NativeParticleGummyBear(
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
    raf = 0,
    request = 0
  let disposed = false,
    failed = false,
    ready = false,
    demo = false,
    picking = false
  let gpuPending = false,
    submittedFrames = 0,
    completedFrames = 0
  let phase: GummyBenchmarkPhase | 'idle' = 'idle'
  let grip: GummyGrip | undefined,
    dragFrame: GummyDragFrame | undefined,
    dragPointer: number | undefined
  let releaseGpuErrors = () => {}

  function status(value: GummyStudyStatus) {
    untrack(() => props.onStatus?.(value))
  }

  function cancelGrip() {
    request++
    picking = false
    grip = undefined
    dragFrame = undefined
    dragPointer = undefined
    if (!demo) status('ready')
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
        release()
        orbit = { ...DEFAULT_GUMMY_ORBIT }
      },
      { defer: true },
    ),
  )
  createEffect(on(() => props.mode, release, { defer: true }))

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

  function updateGrip(x: number, y: number) {
    if (!grip || !dragFrame) return
    const target = gummyDragTarget(rayAt(x, y), dragFrame)
    if (!target) return
    const start = dragFrame.point
    const dx = target[0] - start[0],
      dy = target[1] - start[1],
      dz = target[2] - start[2]
    const scale = Math.min(
      1,
      settings().gripControls.maxPull / Math.max(Math.hypot(dx, dy, dz), 1e-6),
    )
    grip.target = [
      start[0] + dx * scale,
      Math.max(0.04, start[1] + dy * scale),
      start[2] + dz * scale,
    ]
  }

  async function pick(event: PointerEvent) {
    const token = ++request
    const ray = rayAt(event.clientX, event.clientY)
    picking = true
    demo = false
    phase = 'idle'
    status('picking')
    try {
      const positions = await solver.readPositions()
      if (disposed || token !== request || !input.pointer(event.pointerId))
        return
      const picked = pickParticleGrip(
        ray,
        positions,
        solver.restPositions,
        Math.max(0.08, solver.spacing * 0.85),
        settings().particleMaterial === 'warm' ? 'current' : 'rest',
      )
      if (!picked) {
        status('ready')
        return
      }
      dragFrame = gummyDragFrame(ray, picked.point)
      if (!dragFrame) {
        status('ready')
        return
      }
      grip = picked.grip
      grip.radius = settings().gripControls.radius
      dragPointer = event.pointerId
      const latest = input.pointer(event.pointerId)!
      updateGrip(latest.x, latest.y)
      status('dragging')
    } catch {
      if (!disposed && token === request) {
        failed = true
        release()
        props.onError?.('Could not read the jelly for grabbing.')
      }
    } finally {
      // The request sequence rejects stale pointer reads; it is not a secret.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token === request) picking = false
    }
  }

  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => settings().mode,
    ready: () => ready && !failed,
    cameraRadius: () => {
      const size = canvasSize()
      return gummyCameraRadius(
        orbit,
        size.width / Math.max(1, size.height),
        'pull',
        cameraFraming,
      )
    },
    cancelGrip,
    pick: (event) => {
      void pick(event)
    },
    moveGrip: (x, y) => {
      if (dragPointer !== undefined) updateGrip(x, y)
    },
  })

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

  function repeatedAction(event: KeyboardEvent) {
    return event.repeat && [' ', 'd', 'r'].includes(event.key.toLowerCase())
  }

  function keyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (repeatedAction(event)) {
      event.preventDefault()
      return
    }
    if (input.cameraKey(event)) {
      event.preventDefault()
      return
    }
    if (event.key === ' ') props.onPauseChange?.(!settings().paused)
    else if (event.key.toLowerCase() === 'd') props.onReplay?.()
    else if (event.key.toLowerCase() === 'r') props.onReset?.()
    else if (event.key === 'Home') {
      release()
      orbit = { ...DEFAULT_GUMMY_ORBIT }
    } else if (event.key === 'Escape') release()
    else return
    event.preventDefault()
  }

  function currentGrip() {
    return grip ?? (demo ? particleStudyCommand(steps).grip : undefined)
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
      grip: command?.grip ?? grip,
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
        : input.guide(grip, dragFrame?.point)
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
      picking ||
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
        !picking &&
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
  const diagnostics: ParticleDiagnostics = {
    advanceFrames(count) {
      if (!Number.isInteger(count) || count < 0 || count > 3600)
        throw new RangeError('Diagnostic steps must be between 0 and 3600')
      for (let i = 0; i < count; i++) simulate()
      draw()
    },
    startDemoPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(true)
      draw()
    },
    resetPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(false)
      draw()
    },
    render: draw,
    readSurfaceStats:
      'readSurfaceStats' in renderer ? renderer.readSurfaceStats : undefined,
    readState: async () => ({
      ...(await solver.readState()),
      restPositions: solver.restPositions.slice(),
    }),
    info: () => ({
      experiment,
      reconstruction,
      fixture,
      pose: 'upright',
      materialModel: 'mls-mpm',
      protocol: 'lateral-pull',
      phase,
      time: clock.time,
      steps,
      tick: steps,
      particleCount: solver.particleCount,
      spacing: solver.spacing,
      gridSpacing: solver.gridSpacing,
      restVolume: solver.restVolume,
      gridBounds: {
        min: [...solver.gridBounds.min],
        max: [...solver.gridBounds.max],
      },
      substeps: solver.substeps,
      restBounds: { min: [...restBounds.min], max: [...restBounds.max] },
      grip: !!currentGrip(),
      gripCommand: currentGrip(),
      demo,
      submittedFrames,
      completedFrames,
      gpuPending,
      settings: {
        softness: settings().softness,
        tearing: settings().tearing,
        palette: settings().palette,
        fixedDt: GUMMY_STEP,
        particleMaterial: settings().particleMaterial,
        fragility: settings().fragility,
        caustics: settings().caustics,
        tuning: settings().tuning,
        grabRadius: settings().gripControls.radius,
        maxPull: settings().gripControls.maxPull,
        pinnedFeet: fixture !== 'blobs' && props.pinnedFeet !== false,
        pointerGuide: props.pointerGuide !== false,
      },
    }),
  }
  if (import.meta.env.DEV) window.__gummyParticleStudy = diagnostics
  canvas.dataset.testid = 'gummy-bear-canvas'
  canvas.tabIndex = 0
  const releaseTouchSurface = bindGummyTouchSurface(canvas)
  canvas.style.cursor = 'grab'
  canvas.addEventListener('pointerdown', input.pointerDown)
  canvas.addEventListener('pointermove', input.pointerMove)
  canvas.addEventListener('pointerleave', input.pointerLeave)
  canvas.addEventListener('pointerup', input.pointerEnd)
  canvas.addEventListener('pointercancel', input.pointerEnd)
  canvas.addEventListener('lostpointercapture', input.pointerEnd)
  canvas.addEventListener('wheel', input.wheel, { passive: false })
  canvas.addEventListener('keydown', keyDown)
  canvas.addEventListener('contextmenu', input.contextMenu)
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
    canvas.removeEventListener('pointerdown', input.pointerDown)
    canvas.removeEventListener('pointermove', input.pointerMove)
    canvas.removeEventListener('pointerleave', input.pointerLeave)
    canvas.removeEventListener('pointerup', input.pointerEnd)
    canvas.removeEventListener('pointercancel', input.pointerEnd)
    canvas.removeEventListener('lostpointercapture', input.pointerEnd)
    canvas.removeEventListener('wheel', input.wheel)
    canvas.removeEventListener('keydown', keyDown)
    canvas.removeEventListener('contextmenu', input.contextMenu)
  })
  return null
}
