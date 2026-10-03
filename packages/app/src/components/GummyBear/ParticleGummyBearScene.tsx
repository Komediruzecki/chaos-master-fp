/** Isolated particle-jelly GPU ownership, fixed-tick pulling and current-state input. */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import { advanceGummyClock, DEFAULT_GUMMY_ORBIT, GUMMY_STEP, gummyCameraMatrices, gummyDragFrame, gummyDragTarget, gummyRay, gummyRestBounds, } from './gummyStudyMath'
import { createParticleGummyRenderer } from './particleGummyRenderer'
import { PARTICLE_STUDY_TICKS, particleStudyCommand, pickParticleGrip, } from './particleStudyMath'
import type { GummyBearSceneProps, GummyStudyStatus } from './GummyBearScene'
import type { GummyBenchmarkPhase, GummyClock, GummyDragFrame, GummyGrip, } from './gummyStudyMath'

export type ParticleGummyBearSceneProps = Omit<
  GummyBearSceneProps,
  'experiment' | 'protocol'
>

type ParticleDiagnosticRenderOptions = { raw?: boolean; clay?: boolean }

type ParticleDiagnostics = {
  advanceFrames: (count: number) => void
  startDemoPaused: () => void
  render: (options?: ParticleDiagnosticRenderOptions) => void
  readState: () => Promise<
    Awaited<
      ReturnType<ReturnType<typeof createGummyParticleSolver>['readState']>
    > & { restPositions: Float32Array }
  >
  info: () => {
    experiment: 'particle'
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
    settings: {
      softness: number
      tearing: boolean
      palette: GummyBearSceneProps['palette']
      fixedDt: number
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
  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      data-testid="particle-gummy-bear-scene"
    >
      <AutoCanvas
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel="Interactive particle jelly. D starts the pull, Space pauses, and arrow keys turn the view."
      >
        <NativeParticleGummyBear {...props} visible={visible()} />
      </AutoCanvas>
    </div>
  )
}

function NativeParticleGummyBear(
  props: ParticleGummyBearSceneProps & { visible: boolean },
) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  untrack(() => {
    props.onReady?.(false)
    props.onStatus?.('loading')
    props.onError?.(undefined)
  })
  const solver = createGummyParticleSolver(root, device, {})
  let renderer: ReturnType<typeof createParticleGummyRenderer>
  try {
    renderer = createParticleGummyRenderer(
      root,
      device,
      context,
      canvasFormat,
      {
        positions: solver.positions,
        restPositions: solver.restPositions,
        particleCount: solver.particleCount,
        spacing: solver.spacing,
      },
    )
  } catch (error) {
    solver.destroy()
    throw error
  }
  const restBounds = gummyRestBounds(solver.restPositions)
  const settings = createMemo(() => ({
    palette: props.palette,
    mode: props.mode,
    softness: props.softness,
    tearing: props.tearing,
    paused: props.paused,
    visible: props.visible,
  }))
  let orbit = { ...DEFAULT_GUMMY_ORBIT }
  const viewProjection = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  let clock: GummyClock = { time: 0, remainder: 0 }
  let steps = 0,
    raf = 0,
    request = 0
  let disposed = false,
    failed = false,
    ready = false,
    demo = false,
    picking = false
  let phase: GummyBenchmarkPhase | 'idle' = 'idle'
  let grip: GummyGrip | undefined,
    dragFrame: GummyDragFrame | undefined,
    dragPointer: number | undefined
  const pointers = new Map<number, { x: number; y: number }>()

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
    solver.reset()
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
    const start = dragFrame.point
    const dx = target[0] - start[0],
      dy = target[1] - start[1],
      dz = target[2] - start[2]
    const scale = Math.min(1, 1.8 / Math.max(Math.hypot(dx, dy, dz), 1e-6))
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
      const current = await solver.readState()
      if (disposed || token !== request || !pointers.has(event.pointerId))
        return
      const picked = pickParticleGrip(
        ray,
        current.positions,
        solver.restPositions,
        Math.max(0.08, solver.spacing * 0.85),
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
      dragPointer = event.pointerId
      const latest = pointers.get(event.pointerId)!
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

  function keyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (repeatedAction(event)) {
      event.preventDefault()
      return
    }
    if (event.key === ' ') props.onPauseChange?.(!settings().paused)
    else if (event.key.toLowerCase() === 'd') props.onReplay?.()
    else if (event.key.toLowerCase() === 'r') props.onReset?.()
    else if (event.key === 'ArrowLeft') orbitBy(-18, 0)
    else if (event.key === 'ArrowRight') orbitBy(18, 0)
    else if (event.key === 'ArrowUp') orbitBy(0, -18)
    else if (event.key === 'ArrowDown') orbitBy(0, 18)
    else if (event.key === '+' || event.key === '=') zoomBy(1 / 1.12)
    else if (event.key === '-') zoomBy(1.12)
    else if (event.key === 'Home') orbit = { ...DEFAULT_GUMMY_ORBIT }
    else if (event.key === 'Escape') release()
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
      grip: command?.grip ?? grip,
    })
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
        palette: settings().palette,
        clay: options.clay,
      },
      { raw: options.raw },
    )
    canvas.dataset.testid = 'gummy-bear-canvas'
    canvas.dataset.simTime = clock.time.toFixed(4)
    canvas.dataset.steps = String(steps)
    canvas.dataset.tick = String(steps)
    canvas.dataset.grip = String(!!currentGrip())
    canvas.dataset.experiment = 'particle'
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
        document.visibilityState !== 'hidden' &&
        (state.visible || !ready)
      )
        draw()
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
    render: draw,
    readState: async () => ({
      ...(await solver.readState()),
      restPositions: solver.restPositions.slice(),
    }),
    info: () => ({
      experiment: 'particle',
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
      settings: {
        softness: settings().softness,
        tearing: settings().tearing,
        palette: settings().palette,
        fixedDt: GUMMY_STEP,
      },
    }),
  }
  if (import.meta.env.DEV) window.__gummyParticleStudy = diagnostics
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
    release()
    cancelAnimationFrame(raf)
    if (window.__gummyParticleStudy === diagnostics)
      delete window.__gummyParticleStudy
    renderer.destroy()
    solver.destroy()
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
