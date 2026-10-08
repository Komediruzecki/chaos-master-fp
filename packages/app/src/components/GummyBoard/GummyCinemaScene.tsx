/** Fixed-step shot playback and deterministic frame access for real WebGPU capture footage. */
import { createEffect, createSignal, onCleanup, untrack } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'
import { bindGummyGpuErrors } from '../GummyBear/gummyGpuErrors'
import { GUMMY_STEP } from '../GummyBear/gummyStudyMath'
import { resolveGummyBoardQuality } from './gummyBoardQuality'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import { gummyBoardShotCamera } from './gummyBoardShotCamera'
import { gummyBoardShotPose, gummyBoardShotSimulationTime, gummyBoardShotStep, resolveGummyBoardShot, } from './gummyBoardShots'
import { gummyMatchShotCamera } from './gummyMatchShotCamera'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyOrbit, GummyVec3 } from '../GummyBear/gummyStudyMath'
import type { GummyBoardQuality } from './gummyBoardQuality'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { GummyBoardShot } from './gummyBoardShots'
import type { GummyPresetSettings } from '@/pages/GummyBear/gummyPresets'

export type GummyCinemaController = {
  info(): {
    ready: boolean
    shotId: string
    config: GummyBoardShot
    displayDuration: number
    displayTime: number
    simulationTime: number
    phase: string
    error?: string
    scale: number
    artStyle: string
    quality: string
    material: GummyPresetSettings
    attackerPalette: GummyPalette
    victimPalette: GummyPalette
  }
  resetPaused(): Promise<void>
  seekFrame(frame: number, fps?: number): Promise<void>
  setCaptureSize(
    size: { width: number; height: number } | undefined,
  ): Promise<void>
  captureFrame(frame: number, fps: number): Promise<ImageBitmap>
  render(): Promise<void>
  play(): void
  pause(): void
  readState: ReturnType<typeof createGummyParticleSolver>['readState']
  readRenderStats(): ReturnType<
    Awaited<ReturnType<typeof createGummyBoardRenderer>>['readRenderStats']
  >
  readSurfaceStats(): ReturnType<
    Awaited<ReturnType<typeof createGummyBoardRenderer>>['readSurfaceStats']
  >
}

type Props = {
  shot: GummyBoardShot
  material: GummyPresetSettings
  scale: number
  quality: GummyBoardQuality
  artStyle: 'classic' | 'sculpted'
  attackerPalette: GummyPalette
  victimPalette: GummyPalette
  backgroundPalettes?: readonly [GummyPalette, GummyPalette]
  /** Match-only resources and camera; standalone studio shots retain their own framing. */
  restMeshPool?: GummyBoardRestMeshPool
  matchOrbit?: GummyOrbit
  onController: (controller: GummyCinemaController | undefined) => void
  onProgress: (time: number, playing: boolean) => void
  onError: (message: string) => void
  onReady: (ready: boolean) => void
}

export function GummyCinemaScene(props: Props) {
  const [captureSize, setCaptureSize] = createSignal<{
    width: number
    height: number
  }>()
  return (
    <AutoCanvas
      pixelRatio={1}
      fixedResolution={captureSize()}
      role="img"
      ariaLabel="Gummy chess cinematic capture preview"
    >
      <NativeGummyCinema {...props} setCaptureSize={setCaptureSize} />
    </AutoCanvas>
  )
}

function NativeGummyCinema(
  props: Props & {
    setCaptureSize(size: { width: number; height: number } | undefined): void
  },
) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  const shot = resolveGummyBoardShot(props.shot)
  const scale = props.scale
  const material = props.material
  const compact =
    window.matchMedia?.('(pointer: coarse), (max-width: 900px)').matches ??
    false
  const quality = resolveGummyBoardQuality(props.quality, compact)
  const solver = createGummyParticleSolver(root, device, {
    fixture: shot.victim.mould,
    pinnedFeet: material.pinnedFeet,
    initialRotationY: shot.victim.rotationY,
    colliderMould: shot.attacker.mould,
    colliderRotationY: shot.attacker.rotationY,
    artStyle: props.artStyle,
  })
  let renderer: Awaited<ReturnType<typeof createGummyBoardRenderer>> | undefined
  let initializing = true,
    disposed = false,
    ready = false,
    playing = false,
    pendingActions = 0
  let failure: string | undefined
  let displayTime = 0,
    ticks = 0,
    raf = 0,
    previous = 0
  let queue = Promise.resolve()
  const duration = 8
  const simulationTime = () => ticks * GUMMY_STEP
  const pieces = shot.pieces
    .filter((p) => p.id !== shot.victim.id)
    .map((p) => ({
      ...p,
      scale,
      palette:
        p.id === shot.attacker.id
          ? props.attackerPalette
          : (props.backgroundPalettes?.[p.side] ??
            (p.side === 0 ? ('berry' as const) : ('blue' as const))),
    }))
  const attacker = pieces.find((p) => p.id === shot.attacker.id)!

  function fail(error: unknown) {
    if (disposed) return
    failure = error instanceof Error ? error.message : String(error)
    playing = false
    untrack(() => {
      props.onError(failure!)
      props.onProgress(displayTime, false)
    })
  }
  const releaseErrors = bindGummyGpuErrors(device, fail)

  function reset() {
    solver.reset()
    ticks = 0
    displayTime = 0
    previous = 0
  }

  function advanceTo(time: number) {
    if (!ready || disposed) throw new Error('The shot is still loading.')
    if (failure) throw new Error(failure)
    if (!Number.isFinite(time) || time < 0 || time > duration)
      throw new RangeError('Shot time must be between zero and eight seconds.')
    if (time < displayTime) reset()
    const targetTicks = Math.floor(
      (gummyBoardShotSimulationTime(time) + 1e-8) / GUMMY_STEP,
    )
    while (ticks < targetTicks) {
      const world = gummyBoardShotStep(
        shot,
        simulationTime(),
        GUMMY_STEP,
        scale,
      )
      solver.step(GUMMY_STEP, {
        softness: material.softness,
        fragility: material.fragility,
        tearing: material.tearing,
        particleMaterial: material.particleMaterial,
        tuning: material.tuning,
        collider: {
          position: world.position.map(
            (v, k) => (v - shot.target[k]!) / scale,
          ) as GummyVec3,
          velocity: world.velocity.map((v) => v / scale) as GummyVec3,
          friction: world.friction,
        },
      })
      ticks++
    }
    displayTime = time
  }

  async function draw() {
    if (!renderer || disposed) return false
    const size = canvasSize()
    // AutoCanvas debounces its initial size. A cached renderer can be ready
    // earlier, but rendering a zero-sized frame is a no-op, not a first frame.
    if (size.width < 1 || size.height < 1) return false
    const aspect = size.width / Math.max(1, size.height)
    const camera = props.matchOrbit
      ? gummyMatchShotCamera(shot, displayTime, aspect, scale, props.matchOrbit)
      : gummyBoardShotCamera(shot, displayTime, aspect, scale)
    attacker.position = gummyBoardShotPose(
      shot,
      simulationTime(),
      scale,
    ).position
    renderer.render(
      {
        width: size.width,
        height: size.height,
        viewProjection: camera.viewProjection,
        inverseViewProjection: camera.inverse,
        eye: camera.eye,
        palette: material.palette,
        floor: 'chess',
      },
      {
        pieces,
        revision: ticks,
        victimId: shot.victim.id,
        victimSide: shot.victim.side,
        victimPosition: shot.target,
        victimScale: scale,
        victimPalette: props.victimPalette,
        movingPieceId: shot.attacker.id,
        caustics: material.caustics,
        boardTheme: shot.shot.boardTheme,
        boardTime: displayTime,
        supportingDensity: props.matchOrbit ? 1 : 1.8,
      },
    )
    canvas.dataset.testid = 'gummy-cinema-canvas'
    canvas.dataset.time = displayTime.toFixed(4)
    canvas.dataset.shot = shot.shot.id
    await device.queue.onSubmittedWorkDone()
    if (!disposed && failure) throw new Error(failure)
    const currentSize = canvasSize()
    return (
      !disposed &&
      currentSize.width === size.width &&
      currentSize.height === size.height
    )
  }

  function enqueue<T>(action: () => Promise<T>) {
    pendingActions++
    const pending = queue
      .then(async () => {
        if (disposed) throw new Error('This shot has been replaced.')
        return await action()
      })
      .finally(() => {
        pendingActions--
      })
    queue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }

  function serialize(action: () => Promise<unknown>) {
    playing = false
    return enqueue(async () => {
      await action()
    })
  }

  async function refreshCanvas() {
    const rendered = await enqueue(draw)
    if (disposed || ready || !rendered || pendingActions) return
    ready = true
    // Notify outside the render queue so the match can start playback now.
    untrack(() => {
      props.onReady(true)
    })
  }

  async function seek(frame: number, fps: number) {
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      !Number.isFinite(fps) ||
      fps < 1 ||
      fps > 120
    )
      throw new RangeError('Frame and frame rate must be valid.')
    advanceTo(Math.min(duration, frame / fps))
    await draw()
    untrack(() => {
      if (!disposed) props.onProgress(displayTime, false)
    })
  }

  const controller: GummyCinemaController = {
    info: () => ({
      ready,
      shotId: shot.shot.id,
      config: shot.shot,
      displayDuration: duration,
      displayTime,
      simulationTime: simulationTime(),
      phase: gummyBoardShotPose(shot, simulationTime(), scale).phase,
      error: failure,
      scale,
      artStyle: props.artStyle,
      quality: quality.name,
      material,
      attackerPalette: props.attackerPalette,
      victimPalette: props.victimPalette,
    }),
    resetPaused: () =>
      serialize(async () => {
        reset()
        await draw()
        if (!disposed) props.onProgress(0, false)
      }),
    seekFrame: (frame, fps = 60) => serialize(() => seek(frame, fps)),
    setCaptureSize: (size) =>
      serialize(async () => {
        if (
          size &&
          [size.width, size.height].some(
            (v) =>
              !Number.isInteger(v) ||
              v < 1 ||
              v > Math.min(4096, device.limits.maxTextureDimension2D),
          )
        )
          throw new RangeError(
            'This GPU cannot render the requested video size.',
          )
        props.setCaptureSize(size)
        // Let AutoCanvas update its backing texture before drawing. This is an
        // event-loop yield, not a playback delay or a resize of encoded pixels.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (
          size &&
          (canvas.width !== size.width || canvas.height !== size.height)
        )
          throw new Error(
            'The canvas could not switch to the requested video size.',
          )
        await draw()
      }),
    captureFrame: (frame, fps) => {
      let bitmap: ImageBitmap | undefined
      return serialize(async () => {
        await seek(frame, fps)
        // Snapshot inside the render queue so resize/preview draws cannot
        // replace this frame between simulation advancement and capture.
        bitmap = await globalThis.createImageBitmap(canvas)
      }).then(() => bitmap!)
    },
    render: () => serialize(draw),
    play() {
      if (!ready || pendingActions || failure) return
      if (displayTime >= duration) reset()
      playing = true
      previous = 0
      untrack(() => {
        props.onProgress(displayTime, true)
      })
    },
    pause() {
      playing = false
      untrack(() => {
        if (!disposed) props.onProgress(displayTime, false)
      })
    },
    readState: () => solver.readState(),
    readRenderStats() {
      if (!renderer) throw new Error('The shot is still loading.')
      return renderer.readRenderStats()
    },
    readSurfaceStats() {
      if (!renderer) throw new Error('The shot is still loading.')
      return renderer.readSurfaceStats()
    },
  }
  untrack(() => {
    props.onReady(false)
    props.onController(controller)
  })

  const preparation = new AbortController()
  void createGummyBoardRenderer(
    root,
    device,
    context,
    canvasFormat,
    {
      positions: solver.positions,
      restPositions: solver.restPositions,
      particleCount: solver.particleCount,
      spacing: solver.spacing,
      gridBounds: solver.gridBounds,
      cellSize: quality.cellSize,
    },
    undefined,
    {
      lightResolution: quality.lightResolution,
      artStyle: props.artStyle,
      signal: preparation.signal,
      restMeshPool: props.restMeshPool,
      restSpacing: props.restMeshPool ? 0.08 : undefined,
    },
  )
    .then(async (created) => {
      initializing = false
      if (disposed) {
        created.destroy()
        solver.destroy()
        return
      }
      renderer = created
      await refreshCanvas()
    })
    .catch((error: unknown) => {
      initializing = false
      if (disposed) solver.destroy()
      else fail(error)
    })

  async function frame(now: number) {
    if (disposed) return
    if (playing && !pendingActions && ready && !failure) {
      const dt = previous
        ? Math.min(1 / 20, Math.max(0, (now - previous) / 1000))
        : 0
      previous = now
      try {
        await enqueue(async () => {
          if (!playing) return
          advanceTo(Math.min(duration, displayTime + dt))
          await draw()
          if (disposed) return
          if (displayTime >= duration) playing = false
          untrack(() => {
            props.onProgress(displayTime, playing)
          })
        })
      } catch (error) {
        fail(error)
      }
    } else previous = 0
    if (!disposed)
      raf = requestAnimationFrame((now) => {
        void frame(now)
      })
  }
  raf = requestAnimationFrame((now) => {
    void frame(now)
  })
  createEffect(() => {
    canvasSize()
    if (renderer) void refreshCanvas().catch(fail)
  })
  onCleanup(() => {
    disposed = true
    preparation.abort()
    playing = false
    cancelAnimationFrame(raf)
    releaseErrors()
    renderer?.destroy()
    if (!initializing) solver.destroy()
    // Release this shot's presentation textures without waiting for canvas GC.
    context.unconfigure()
    props.onController(undefined)
  })
  return null
}
