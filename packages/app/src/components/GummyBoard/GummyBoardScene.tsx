/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, } from 'solid-js'
import { bindGummyTouchSurface, createGummyCameraInput, } from '@/components/GummyBear/gummyCameraInput'
import { bindGummyGpuErrors } from '@/components/GummyBear/gummyGpuErrors'
import { createGummyPointerRenderer } from '@/components/GummyBear/gummyPointerRenderer'
import { advanceGummyClock, GUMMY_STEP, gummyDragFrame, gummyDragTarget, gummyRay, } from '@/components/GummyBear/gummyStudyMath'
import { pickParticleGrip } from '@/components/GummyBear/particleStudyMath'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { gummyBoardCameraMatrices, gummyBoardCameraRadius, initialGummyBoardOrbit, } from './gummyBoardCamera'
import { createGummyBoardPieces, getGummyBoardPiecePalette, GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_ROOK_START, GUMMY_BOARD_VICTIM_ID, GUMMY_BOARD_VICTIM_POSITION, gummyBoardCrashDuration, gummyBoardRookPose, gummyBoardRookStep, } from './gummyBoardChoreography'
import { gummyBoardLocalRay, gummyBoardWorldPoint, pickGummyBoardMould, pickGummyBoardParticles, } from './gummyBoardPicking'
import { resolveGummyBoardQuality } from './gummyBoardQuality'
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import { createGummyBoardSimulation } from './gummyBoardSimulation'
import type { GummyBoardView } from './gummyBoardCamera'
import type { GummyBoardPhase } from './gummyBoardChoreography'
import type { GummyBoardQuality } from './gummyBoardQuality'
import type { GummyBoardCollisionMode } from './gummyBoardSimulation'
import type { GummyInteraction } from '@/components/GummyBear/GummyBearScene'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyClock, GummyDragFrame, GummyGrip, GummyVec3, } from '@/components/GummyBear/gummyStudyMath'
import type { GummyPresetSettings } from '@/pages/GummyBear/gummyPresets'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

export type GummyBoardSceneProps = {
  settings: GummyPresetSettings
  paused: boolean
  resetKey: number
  crashKey: number
  resetViewKey: number
  view: GummyBoardView
  mode: GummyInteraction
  impact: number
  collisionMode?: GummyBoardCollisionMode
  recording?: boolean
  selectedPieceId?: number
  onSelectPiece?: (id: number | undefined) => void
  paletteOverrides?: Partial<Record<number, GummyPalette>>
  pieceScale?: number
  quality?: GummyBoardQuality
  onReady?: (ready: boolean) => void
  onError?: (message: string | undefined) => void
  onPhase?: (phase: GummyBoardPhase) => void
  onPauseChange?: (paused: boolean) => void
  onReplay?: () => void
  onReset?: () => void
}

export function GummyBoardScene(props: GummyBoardSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const pinnedFeet = createMemo(() => props.settings.pinnedFeet)
  const collisionMode = createMemo(() => props.collisionMode ?? 'driven')
  const compact =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse), (max-width: 900px)').matches
  const qualityChoice = createMemo(() => props.quality ?? 'auto')
  const quality = createMemo(() =>
    resolveGummyBoardQuality(qualityChoice(), compact),
  )
  const model = createMemo(() => ({
    pinnedFeet: pinnedFeet(),
    collisionMode: collisionMode(),
    quality: quality(),
  }))
  return (
    <AutoCanvas
      pixelRatio={1}
      onVisibilityChange={setVisible}
      role="img"
      ariaLabel="Gummy chess board. Tap a piece to edit its color. Drag to orbit or use two fingers to pan. Grab mode stretches the active pawn. Space pauses and R resets."
    >
      <Show when={model()} keyed>
        {(selection) => (
          <NativeGummyBoard
            {...props}
            pinnedFeet={selection.pinnedFeet}
            collisionMode={selection.collisionMode}
            visible={visible()}
            renderQuality={selection.quality}
          />
        )}
      </Show>
    </AutoCanvas>
  )
}

function NativeGummyBoard(
  props: GummyBoardSceneProps & {
    pinnedFeet: boolean
    visible: boolean
    renderQuality: ReturnType<typeof resolveGummyBoardQuality>
  },
) {
  const { root, device } = useLiveRootContext()
  const { context, canvas, canvasFormat, canvasSize } = useCanvas()
  untrack(() => {
    props.onReady?.(false)
    props.onError?.(undefined)
  })
  const simulation = createGummyBoardSimulation(root, device, {
    collisionMode: props.collisionMode ?? 'driven',
    pinnedFeet: props.pinnedFeet,
  })
  const solver = simulation.pawn
  const rook = simulation.rook
  let renderer: Awaited<ReturnType<typeof createGummyBoardRenderer>> | undefined
  let initializing = true
  const pointerRenderer = createGummyPointerRenderer(
    root,
    device,
    context,
    canvasFormat,
  )
  const settings = createMemo(() => ({
    material: props.settings,
    paused: props.paused,
    mode: props.mode,
    visible: props.visible || props.recording === true,
    view: props.view,
    scale: props.pieceScale ?? 0.9,
    palettes: props.paletteOverrides ?? {},
    selected: props.selectedPieceId,
    recording: props.recording === true,
  }))
  const opening = createGummyBoardPieces()
  const victimHome = opening.find((p) => p.id === GUMMY_BOARD_VICTIM_ID)!
  const attackerHome = opening.find((p) => p.id === GUMMY_BOARD_ATTACKER_ID)!
  const pieces = opening
    .filter(
      (piece) =>
        piece.id !== GUMMY_BOARD_VICTIM_ID &&
        (!rook || piece.id !== GUMMY_BOARD_ATTACKER_ID),
    )
    .map((piece) => ({ ...piece, position: [...piece.position] as GummyVec3 }))
  const attacker = pieces.find((piece) => piece.id === GUMMY_BOARD_ATTACKER_ID)
  let orbit = initialGummyBoardOrbit(untrack(() => props.view))
  const vp = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  const view = new Float32Array(16),
    projection = new Float32Array(16)
  let clock: GummyClock = { time: 0, remainder: 0 }
  let ticks = 0,
    revision = 0,
    crashTime = 0,
    impact = 1,
    settleTicks = 0
  let staged = untrack(() => props.mode === 'drag')
  let initializationFailure: string | undefined
  let lastDrawState: string | undefined
  let selectionRequest = 0
  let playing = false,
    ready = false,
    failed = false,
    disposed = false,
    pending = false,
    picking = false
  let phase: GummyBoardPhase = 'ready'
  let request = 0,
    raf = 0,
    submittedFrames = 0,
    completedFrames = 0
  let grip: GummyGrip | undefined, dragFrame: GummyDragFrame | undefined
  let dragPointer: number | undefined

  function setPhase(next: GummyBoardPhase) {
    if (phase === next) return
    phase = next
    untrack(() => props.onPhase?.(next))
  }

  function cancelGrip() {
    if (grip) settleTicks = 180
    request++
    grip = undefined
    dragFrame = undefined
    dragPointer = undefined
    picking = false
  }

  function reset(crash: boolean) {
    if (initializationFailure) {
      untrack(() => props.onError?.(initializationFailure))
      return
    }
    input.cancel()
    simulation.reset()
    revision++
    clock = { time: 0, remainder: 0 }
    ticks = 0
    crashTime = 0
    settleTicks = 0
    impact = untrack(() => props.impact)
    playing = crash
    staged = crash
    selectionRequest++
    failed = false
    phase = 'ready'
    untrack(() => {
      props.onError?.(undefined)
      props.onPhase?.('ready')
    })
  }

  function camera() {
    const size = canvasSize()
    gummyBoardCameraMatrices(
      orbit,
      size.width / Math.max(1, size.height),
      settings().view,
      vp,
      inverse,
      eye,
      view,
      projection,
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
    const delta = target.map((value, axis) => value - dragFrame!.point[axis]!)
    const scale = Math.min(
      1,
      (settings().material.maxPull * settings().scale) /
        Math.max(1e-6, Math.hypot(...delta)),
    )
    grip.target = dragFrame.point.map(
      (value, axis) =>
        (value + delta[axis]! * scale - victimOffset()[axis]!) /
        settings().scale,
    ) as GummyVec3
    grip.target[1] = Math.max(0.04, grip.target[1])
  }

  async function pick(event: PointerEvent) {
    if (!staged) return
    const token = ++request
    const ray = rayAt(event.clientX, event.clientY)
    picking = true
    playing = false
    try {
      const positions = await solver.readPositions()
      if (disposed || token !== request || !input.pointer(event.pointerId))
        return
      const localRay = gummyBoardLocalRay(ray, victimOffset(), settings().scale)
      const picked = pickParticleGrip(
        localRay,
        positions,
        solver.restPositions,
        Math.max(0.08, solver.spacing * 0.85),
        settings().material.particleMaterial === 'warm' ? 'current' : 'rest',
      )
      if (!picked) return
      const world = gummyBoardWorldPoint(
        picked.point,
        victimOffset(),
        settings().scale,
      )
      dragFrame = gummyDragFrame(ray, world)
      if (!dragFrame) return
      grip = picked.grip
      grip.radius = settings().material.grabRadius
      dragPointer = event.pointerId
      const latest = input.pointer(event.pointerId)!
      updateGrip(latest.x, latest.y)
    } catch {
      if (!disposed && token === request)
        fail('Could not read the pawn for grabbing.')
    } finally {
      // The sequence rejects stale input reads; it does not compare secrets.
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
      return gummyBoardCameraRadius(
        orbit,
        size.width / Math.max(1, size.height),
        settings().view,
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

  function fail(message: string) {
    failed = true
    playing = false
    input.cancel()
    untrack(() => props.onError?.(message))
  }
  const releaseErrors = bindGummyGpuErrors(device, (message) => {
    if (!disposed) fail(message)
  })
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
      cellSize: rook ? solver.spacing : props.renderQuality.cellSize,
    },
    rook
      ? {
          positions: rook.positions,
          restPositions: rook.restPositions,
          particleCount: rook.particleCount,
          spacing: rook.spacing,
          gridBounds: rook.gridBounds,
          cellSize: rook.spacing,
        }
      : undefined,
    { lightResolution: props.renderQuality.lightResolution },
  )
    .then((created) => {
      initializing = false
      if (disposed) {
        created.destroy()
        simulation.destroy()
      } else renderer = created
    })
    .catch((error: unknown) => {
      initializing = false
      if (disposed) {
        simulation.destroy()
        return
      }
      initializationFailure =
        error instanceof Error
          ? error.message
          : 'The board could not be prepared.'
      fail(initializationFailure)
    })
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
      () => props.crashKey,
      () => {
        reset(true)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => [props.view, props.resetViewKey] as const,
      () => {
        input.cancel()
        selectionRequest++
        orbit = initialGummyBoardOrbit(props.view)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.mode,
      () => {
        input.cancel()
        selectionRequest++
        if (props.mode === 'drag' && !staged) {
          reset(false)
          staged = true
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.pieceScale,
      () => {
        input.cancel()
        selectionRequest++
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.selectedPieceId,
      () => {
        selectionRequest++
      },
      { defer: true },
    ),
  )

  function simulate() {
    const material = settings().material
    const collider = playing
      ? gummyBoardRookStep(crashTime, GUMMY_STEP, impact)
      : {
          position: gummyBoardRookPose(crashTime, impact).position,
          velocity: [0, 0, 0] as GummyVec3,
          friction: 0.45,
        }
    simulation.step(GUMMY_STEP, {
      softness: material.softness,
      fragility: material.fragility,
      tearing: material.tearing,
      particleMaterial: material.particleMaterial,
      tuning: material.tuning,
      gripSpace: material.particleMaterial === 'warm' ? 'current' : 'rest',
      grip,
      collider: staged || rook ? collider : undefined,
    })
    ticks++
    revision++
    if (settleTicks > 0) settleTicks--
    if (playing) {
      crashTime = Math.min(
        gummyBoardCrashDuration(impact),
        crashTime + GUMMY_STEP,
      )
      setPhase(gummyBoardRookPose(crashTime, impact).phase)
      if (crashTime >= gummyBoardCrashDuration(impact)) {
        playing = false
        setPhase('complete')
      }
    }
  }

  function draw() {
    if (!renderer) return
    const size = camera()
    if (size.width < 1 || size.height < 1) return
    const pose = gummyBoardRookPose(crashTime, impact)
    if (attacker)
      attacker.position = staged
        ? gummyBoardWorldPoint(
            pose.position,
            GUMMY_BOARD_VICTIM_POSITION,
            settings().scale,
          )
        : [...attackerHome.position]
    const renderedPieces = pieces.map((piece) => ({
      ...piece,
      scale: settings().scale,
      palette: getGummyBoardPiecePalette(
        piece,
        settings().material.palette,
        settings().palettes,
      ),
    }))
    renderer.render(
      {
        width: size.width,
        height: size.height,
        viewProjection: vp,
        inverseViewProjection: inverse,
        eye,
        palette: settings().material.palette,
        floor: 'chess',
      },
      {
        revision,
        caustics: settings().material.caustics,
        pieces: renderedPieces,
        movingPieceId: rook ? undefined : GUMMY_BOARD_ATTACKER_ID,
        selectedPieceId: settings().selected,
        selectionPosition:
          settings().selected === GUMMY_BOARD_ATTACKER_ID
            ? staged
              ? gummyBoardWorldPoint(
                  pose.position,
                  GUMMY_BOARD_VICTIM_POSITION,
                  settings().scale,
                )
              : attackerHome.position
            : undefined,
        victimScale: settings().scale,
        victimPalette: getGummyBoardPiecePalette(
          victimHome,
          settings().material.palette,
          settings().palettes,
        ),
        victimId: GUMMY_BOARD_VICTIM_ID,
        victimSide: 1,
        victimPosition: victimOffset(),
        secondary: rook
          ? {
              id: GUMMY_BOARD_ATTACKER_ID,
              position: rookOffset(),
              scale: settings().scale,
              palette: getGummyBoardPiecePalette(
                attackerHome,
                settings().material.palette,
                settings().palettes,
              ),
              side: 0,
              revision,
            }
          : undefined,
      },
    )
    const worldGrip = grip
      ? {
          ...grip,
          target: gummyBoardWorldPoint(
            grip.target,
            victimOffset(),
            settings().scale,
          ),
        }
      : undefined
    pointerRenderer.render({
      ...size,
      viewProjection: vp,
      pointer: input.guide(worldGrip, dragFrame?.point),
    })
    canvas.dataset.testid = 'gummy-board-canvas'
    canvas.dataset.phase = phase
    canvas.dataset.tick = String(ticks)
    canvas.dataset.crashTime = crashTime.toFixed(4)
    canvas.dataset.grip = String(!!grip)
    canvas.dataset.pieces = '32'
    canvas.dataset.layout = staged ? 'capture' : 'opening'
    canvas.dataset.quality = props.renderQuality.name
    canvas.dataset.selectedPiece = String(settings().selected ?? '')
    lastDrawState = visualState()
    if (!ready) {
      ready = true
      untrack(() => props.onReady?.(true))
    }
  }

  function frame(now: number) {
    if (disposed) return
    if (!pending && renderer) {
      const state = settings()
      const sleeping =
        state.paused ||
        picking ||
        failed ||
        !state.visible ||
        document.visibilityState === 'hidden' ||
        !(playing || grip || settleTicks > 0)
      const advanced = advanceGummyClock(clock, now / 1000, sleeping)
      clock = advanced.clock
      try {
        for (let i = 0; i < advanced.steps; i++) simulate()
        if (shouldDrawFrame()) {
          draw()
          submittedFrames++
          pending = true
          void device.queue
            .onSubmittedWorkDone()
            .then(() => {
              pending = false
              completedFrames++
            })
            .catch((error: unknown) => {
              pending = false
              if (!disposed)
                fail(
                  error instanceof Error
                    ? error.message
                    : 'The GPU could not finish the board frame.',
                )
            })
        }
      } catch (error) {
        fail(
          error instanceof Error
            ? error.message
            : 'The board could not continue.',
        )
      }
    }
    raf = requestAnimationFrame(frame)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.repeat && [' ', 'r', 'd'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      return
    }
    if (input.cameraKey(event)) {
      event.preventDefault()
      return
    }
    if (event.key === ' ') props.onPauseChange?.(!settings().paused)
    else if (event.key.toLowerCase() === 'r') props.onReset?.()
    else if (event.key.toLowerCase() === 'd') props.onReplay?.()
    else if (event.key === 'Home') {
      input.cancel()
      orbit = initialGummyBoardOrbit(settings().view)
    } else if (event.key === 'Escape') input.cancel()
    else return
    event.preventDefault()
  }

  function victimOffset(): GummyVec3 {
    return staged ? GUMMY_BOARD_VICTIM_POSITION : victimHome.position
  }

  function rookOffset(): GummyVec3 {
    return staged
      ? GUMMY_BOARD_VICTIM_POSITION
      : (attackerHome.position.map(
          (v, k) => v - GUMMY_BOARD_ROOK_START[k]! * settings().scale,
        ) as GummyVec3)
  }

  function visualState() {
    return JSON.stringify([
      revision,
      staged,
      orbit,
      canvasSize(),
      settings(),
      input.cursor(),
      grip,
    ])
  }

  function shouldDrawFrame() {
    const state = settings()
    return (
      !failed &&
      !picking &&
      document.visibilityState !== 'hidden' &&
      (state.visible || !ready) &&
      (state.recording || visualState() !== lastDrawState)
    )
  }

  async function selectAt(x: number, y: number) {
    const token = ++selectionRequest
    const ray = rayAt(x, y)
    const scale = settings().scale
    let id: number | undefined
    let nearest = Infinity
    const consider = (pieceId: number, distance: number | undefined) => {
      if (distance !== undefined && distance < nearest) {
        nearest = distance
        id = pieceId
      }
    }
    for (const piece of pieces)
      consider(piece.id, pickGummyBoardMould(ray, piece, scale))
    try {
      const [pawnPositions, rookPositions] = await Promise.all([
        solver.readPositions(),
        rook?.readPositions(),
      ])
      if (disposed || token !== selectionRequest) return
      consider(
        GUMMY_BOARD_VICTIM_ID,
        pickGummyBoardParticles(
          ray,
          pawnPositions,
          victimOffset(),
          scale,
          solver.spacing,
        ),
      )
      if (rook && rookPositions)
        consider(
          GUMMY_BOARD_ATTACKER_ID,
          pickGummyBoardParticles(
            ray,
            rookPositions,
            rookOffset(),
            scale,
            rook.spacing,
          ),
        )
      untrack(() => props.onSelectPiece?.(id))
    } catch {
      // Color editing must remain available through the piece picker if GPU readback fails.
      if (!disposed && token === selectionRequest)
        untrack(() => props.onSelectPiece?.(id))
    }
  }
  let tap: { id: number; x: number; y: number } | undefined

  function pointerDown(event: PointerEvent) {
    selectionRequest++
    if (tap) tap = undefined
    else if (
      event.isPrimary &&
      event.button === 0 &&
      settings().mode === 'orbit'
    )
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
    input.pointerDown(event)
  }

  function pointerMove(event: PointerEvent) {
    if (
      tap?.id === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
    )
      tap = undefined
    input.pointerMove(event)
  }

  function pointerEnd(event: PointerEvent) {
    const selected =
      tap?.id === event.pointerId && event.type === 'pointerup'
        ? tap
        : undefined
    tap = undefined
    input.pointerEnd(event)
    if (selected && ready && !failed) void selectAt(selected.x, selected.y)
  }
  const diagnostics = {
    resetPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(false)
      draw()
    },
    startCrashPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(true)
      draw()
    },
    advanceFrames(count: number) {
      if (!Number.isInteger(count) || count < 0 || count > 1800)
        throw new RangeError('Use 0 to 1800 diagnostic ticks')
      for (let i = 0; i < count; i++) simulate()
      draw()
    },
    render: draw,
    readRenderStats: () => {
      if (!renderer) throw new Error('Board meshes are still loading')
      return renderer.readRenderStats()
    },
    readSurfaceStats: () => {
      if (!renderer) throw new Error('Board meshes are still loading')
      return renderer.readSurfaceStats()
    },
    readSecondarySurfaceStats: () => {
      if (!renderer) throw new Error('Board meshes are still loading')
      return renderer.readSecondarySurfaceStats()
    },
    readState: async () => {
      const [pawnState, rookState] = await Promise.all([
        solver.readState(),
        rook?.readState(),
      ])
      return {
        ...pawnState,
        restPositions: solver.restPositions.slice(),
        rook:
          rook && rookState
            ? { ...rookState, restPositions: rook.restPositions.slice() }
            : undefined,
      }
    },
    info: () => ({
      ticks,
      crashTime,
      phase,
      playing,
      impact,
      ready,
      failed,
      pending,
      submittedFrames,
      completedFrames,
      particleCount: solver.particleCount,
      rookParticleCount: rook?.particleCount ?? 0,
      collisionMode: props.collisionMode ?? 'driven',
      spacing: solver.spacing,
      gridBounds: solver.gridBounds,
      pieces,
      victimPosition: victimOffset(),
      staged,
      pieceScale: settings().scale,
      quality: props.renderQuality,
      selectedPieceId: settings().selected,
      paletteOverrides: settings().palettes,
      attacker: gummyBoardRookPose(crashTime, impact).position,
      settings: settings().material,
      grip: !!grip,
      view: settings().view,
    }),
  }
  if (import.meta.env.DEV) window.__gummyBoardStudy = diagnostics
  canvas.dataset.testid = 'gummy-board-canvas'
  canvas.tabIndex = 0
  const releaseTouch = bindGummyTouchSurface(canvas)
  canvas.style.cursor = 'grab'
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)
  canvas.addEventListener('lostpointercapture', pointerEnd)
  canvas.addEventListener('pointerleave', input.pointerLeave)
  canvas.addEventListener('wheel', input.wheel, { passive: false })
  canvas.addEventListener('contextmenu', input.contextMenu)
  canvas.addEventListener('keydown', keyDown)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    input.cancel()
    releaseErrors()
    releaseTouch()
    cancelAnimationFrame(raf)
    if (window.__gummyBoardStudy === diagnostics)
      delete window.__gummyBoardStudy
    pointerRenderer.destroy()
    renderer?.destroy()
    // The asynchronous baker still needs the live particle buffer until it settles.
    if (!initializing) simulation.destroy()
    props.onReady?.(false)
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
    canvas.removeEventListener('lostpointercapture', pointerEnd)
    canvas.removeEventListener('pointerleave', input.pointerLeave)
    canvas.removeEventListener('wheel', input.wheel)
    canvas.removeEventListener('contextmenu', input.contextMenu)
    canvas.removeEventListener('keydown', keyDown)
  })
  return null
}

declare global {
  interface Window {
    __gummyBoardStudy?: {
      resetPaused(): void
      startCrashPaused(): void
      advanceFrames(count: number): void
      render(): void
      readRenderStats: Awaited<
        ReturnType<typeof createGummyBoardRenderer>
      >['readRenderStats']
      readSurfaceStats: Awaited<
        ReturnType<typeof createGummyBoardRenderer>
      >['readSurfaceStats']
      readSecondarySurfaceStats: Awaited<
        ReturnType<typeof createGummyBoardRenderer>
      >['readSecondarySurfaceStats']
      readState(): Promise<
        Awaited<
          ReturnType<ReturnType<typeof createGummyParticleSolver>['readState']>
        > & {
          restPositions: Float32Array
          rook?: Awaited<
            ReturnType<
              ReturnType<typeof createGummyParticleSolver>['readState']
            >
          > & { restPositions: Float32Array }
        }
      >
      info(): {
        ticks: number
        crashTime: number
        phase: GummyBoardPhase
        playing: boolean
        impact: number
        ready: boolean
        failed: boolean
        pending: boolean
        submittedFrames: number
        completedFrames: number
        particleCount: number
        rookParticleCount: number
        collisionMode: GummyBoardCollisionMode
        spacing: number
        gridBounds: { min: number[]; max: number[] }
        pieces: ReturnType<typeof createGummyBoardPieces>
        victimPosition: GummyVec3
        staged: boolean
        pieceScale: number
        quality: ReturnType<typeof resolveGummyBoardQuality>
        selectedPieceId: number | undefined
        paletteOverrides: Partial<Record<number, GummyPalette>>
        attacker: GummyVec3
        settings: GummyPresetSettings
        grip: boolean
        view: GummyBoardView
      }
    }
  }
}
