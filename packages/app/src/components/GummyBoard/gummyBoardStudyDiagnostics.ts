/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { untrack } from 'solid-js'
import { gummyBoardRookPose } from './gummyBoardChoreography'
import type { createGummyBoardPieces } from './gummyBoardChoreography'
import type { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { GummyBoardDiagnostics, GummyBoardStudySettings, NativeGummyBoardProps, } from './gummyBoardStudyContracts'
import type { GummyGrip, GummyVec3, } from '@/components/GummyBear/gummyStudyMath'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

type Context = {
  props: NativeGummyBoardProps
  solver: ReturnType<typeof createGummyParticleSolver>
  rook: ReturnType<typeof createGummyParticleSolver> | undefined
  pieces: ReturnType<typeof createGummyBoardPieces>
  settings: () => GummyBoardStudySettings
  victimOffset: () => GummyVec3
  renderer(): Awaited<ReturnType<typeof createGummyBoardRenderer>> | undefined
  draw: () => void
  reset: (crash: boolean) => void
  simulate: () => void
  state(): Pick<
    ReturnType<GummyBoardDiagnostics['info']>,
    | 'ticks'
    | 'crashTime'
    | 'phase'
    | 'playing'
    | 'impact'
    | 'ready'
    | 'failed'
    | 'pending'
    | 'submittedFrames'
    | 'completedFrames'
    | 'staged'
  > & { grip: GummyGrip | undefined }
}
export function createGummyBoardStudyDiagnostics(
  context: Context,
): GummyBoardDiagnostics {
  const {
    props,
    solver,
    rook,
    pieces,
    settings,
    victimOffset,
    draw,
    reset,
    simulate,
  } = context
  return {
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
      const renderer = context.renderer()
      if (!renderer) throw new Error('Board meshes are still loading')
      return renderer.readRenderStats()
    },
    readSurfaceStats: () => {
      const renderer = context.renderer()
      if (!renderer) throw new Error('Board meshes are still loading')
      return renderer.readSurfaceStats()
    },
    readSecondarySurfaceStats: () => {
      const renderer = context.renderer()
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
    info: () => {
      const {
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
        grip,
      } = context.state()
      return {
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
      }
    },
  }
}
