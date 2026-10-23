/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { createMemo, onCleanup, untrack } from 'solid-js'
import { bindGummyGpuErrors } from '@/components/GummyBear/gummyGpuErrors'
import { createGummyPointerRenderer } from '@/components/GummyBear/gummyPointerRenderer'
import { advanceGummyClock, GUMMY_STEP, gummyDragTarget, gummyRay, } from '@/components/GummyBear/gummyStudyMath'
import { pickParticleGrip } from '@/components/GummyBear/particleStudyMath'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { bindGummyStudyCanvas, createGummyStudyInput, createGummyStudyKeyboard, } from '../GummyBear/gummyStudyInput'
import { gummyBoardCameraMatrices, gummyBoardCameraRadius, initialGummyBoardOrbit, } from './gummyBoardCamera'
import { createGummyBoardPieces, GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_ROOK_START, GUMMY_BOARD_VICTIM_ID, GUMMY_BOARD_VICTIM_POSITION, gummyBoardCrashDuration, gummyBoardRookPose, gummyBoardRookStep, } from './gummyBoardChoreography'
import { gummyBoardLocalRay, gummyBoardWorldPoint } from './gummyBoardPicking'
import { createGummyBoardSimulation } from './gummyBoardSimulation'
import { bindGummyBoardStudyControls } from './gummyBoardStudyControls'
import { createGummyBoardStudyDiagnostics } from './gummyBoardStudyDiagnostics'
import { createGummyBoardStudyDraw } from './gummyBoardStudyDraw'
import { createGummyBoardStudyRenderer } from './gummyBoardStudyRenderer'
import { createGummyBoardStudySelection } from './gummyBoardStudySelection'
import type { GummyBoardPhase } from './gummyBoardChoreography'
import type { resolveGummyBoardQuality } from './gummyBoardQuality'
import type { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { GummyBoardSceneProps } from './gummyBoardStudyContracts'
import type { GummyClock, GummyVec3, } from '@/components/GummyBear/gummyStudyMath'

export function NativeGummyBoard(
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
  let playing = false,
    ready = false,
    failed = false,
    disposed = false,
    pending = false
  let phase: GummyBoardPhase = 'ready'
  let raf = 0,
    submittedFrames = 0,
    completedFrames = 0

  function setPhase(next: GummyBoardPhase) {
    if (phase === next) return
    phase = next
    untrack(() => props.onPhase?.(next))
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
    selection.invalidate()
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

  const interaction = createGummyStudyInput({
    canvas,
    orbit: () => orbit,
    mode: () => settings().mode,
    ready: () => ready && !failed,
    disposed: () => disposed,
    rayAt,
    canPick: () => staged,
    onPickStart: () => {
      playing = false
    },
    onRelease: (grip) => {
      if (grip) settleTicks = 180
    },
    readPick: async (ray) => {
      const positions = await solver.readPositions()
      const localRay = gummyBoardLocalRay(ray, victimOffset(), settings().scale)
      const picked = pickParticleGrip(
        localRay,
        positions,
        solver.restPositions,
        Math.max(0.08, solver.spacing * 0.85),
        settings().material.particleMaterial === 'warm' ? 'current' : 'rest',
      )
      if (!picked) return undefined
      picked.grip.radius = settings().material.grabRadius
      return {
        grip: picked.grip,
        point: gummyBoardWorldPoint(
          picked.point,
          victimOffset(),
          settings().scale,
        ),
      }
    },
    updateTarget: (grip, dragFrame, ray) => {
      const target = gummyDragTarget(ray, dragFrame)
      if (!target) return
      const delta = target.map((value, axis) => value - dragFrame.point[axis]!)
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
    },
    onFailure: () => {
      fail('Could not read the pawn for grabbing.')
    },
    cameraRadius: () => {
      const size = canvasSize()
      return gummyBoardCameraRadius(
        orbit,
        size.width / Math.max(1, size.height),
        settings().view,
      )
    },
  })
  const input = interaction.input

  const selection = createGummyBoardStudySelection({
    input,
    solver,
    rook,
    pieces,
    settings,
    rayAt,
    victimOffset,
    rookOffset,
    disposed: () => disposed,
    ready: () => ready && !failed,
    onSelectPiece: (id) => props.onSelectPiece?.(id),
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
  void createGummyBoardStudyRenderer(
    root,
    device,
    context,
    canvasFormat,
    simulation,
    props.renderQuality,
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
  bindGummyBoardStudyControls(props, {
    reset,
    cancel: () => {
      input.cancel()
      selection.invalidate()
    },
    resetView: () => {
      orbit = initialGummyBoardOrbit(props.view)
    },
    enterDrag: () => {
      if (!staged) {
        reset(false)
        staged = true
      }
    },
    invalidateSelection: () => {
      selection.invalidate()
    },
  })

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
      grip: interaction.grip,
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

  const draw = createGummyBoardStudyDraw({
    props,
    pieces,
    attacker,
    attackerHome,
    victimHome,
    rook,
    canvas,
    vp,
    inverse,
    eye,
    pointerRenderer,
    input,
    settings,
    camera,
    victimOffset,
    rookOffset,
    state: () => ({
      renderer,
      crashTime,
      impact,
      staged,
      revision,
      phase,
      ticks,
      grip: interaction.grip,
      dragFrame: interaction.dragFrame,
    }),
    didDraw: () => {
      lastDrawState = visualState()
      if (!ready) {
        ready = true
        untrack(() => props.onReady?.(true))
      }
    },
  })

  function frame(now: number) {
    if (disposed) return
    if (!pending && renderer) {
      const state = settings()
      const sleeping =
        state.paused ||
        interaction.picking ||
        failed ||
        !state.visible ||
        document.visibilityState === 'hidden' ||
        !(playing || interaction.grip || settleTicks > 0)
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

  const keyDown = createGummyStudyKeyboard({
    input,
    paused: () => settings().paused,
    onPauseChange: (paused) => props.onPauseChange?.(paused),
    onReplay: () => props.onReplay?.(),
    onReset: () => props.onReset?.(),
    resetView: () => {
      orbit = initialGummyBoardOrbit(settings().view)
    },
  })

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
      interaction.grip,
    ])
  }

  function shouldDrawFrame() {
    const state = settings()
    return (
      !failed &&
      !interaction.picking &&
      document.visibilityState !== 'hidden' &&
      (state.visible || !ready) &&
      (state.recording || visualState() !== lastDrawState)
    )
  }

  const diagnostics = createGummyBoardStudyDiagnostics({
    props,
    solver,
    rook,
    pieces,
    settings,
    victimOffset,
    draw,
    reset,
    simulate,
    renderer: () => renderer,
    state: () => ({
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
      staged,
      grip: interaction.grip,
    }),
  })
  if (import.meta.env.DEV) window.__gummyBoardStudy = diagnostics
  canvas.dataset.testid = 'gummy-board-canvas'
  const releaseTouch = bindGummyStudyCanvas(canvas, input, keyDown, selection)
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
  })
  return null
}
