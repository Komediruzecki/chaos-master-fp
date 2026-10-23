/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import type { GummyBoardView } from './gummyBoardCamera'
import type { createGummyBoardPieces, GummyBoardPhase, } from './gummyBoardChoreography'
import type { GummyBoardQuality, resolveGummyBoardQuality, } from './gummyBoardQuality'
import type { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { GummyBoardCollisionMode } from './gummyBoardSimulation'
import type { GummyInteraction } from '@/components/GummyBear/GummyBearScene'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyVec3 } from '@/components/GummyBear/gummyStudyMath'
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

export type NativeGummyBoardProps = GummyBoardSceneProps & {
  pinnedFeet: boolean
  visible: boolean
  renderQuality: ReturnType<typeof resolveGummyBoardQuality>
}
export type GummyBoardStudySettings = {
  material: GummyPresetSettings
  paused: boolean
  mode: GummyInteraction
  visible: boolean
  view: GummyBoardView
  scale: number
  palettes: Partial<Record<number, GummyPalette>>
  selected: number | undefined
  recording: boolean
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

export type GummyBoardDiagnostics = NonNullable<Window['__gummyBoardStudy']>
