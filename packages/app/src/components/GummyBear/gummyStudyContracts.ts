/** Public study controls and diagnostic snapshots, independent of scene ownership. */
import type { GummyInteraction } from './gummyCameraInput'
import type { createGummyFractureRuntime } from './gummyFractureRuntime'
import type { GUMMY_JELLY_TEAR_BODY_FIXTURE, GummyBenchmarkPhase, GummyGrip, GummyJellyProtocol, GummyPress, gummyRestBounds, } from './gummyStudyMath'
import type { analyzeGummyFragments } from '@/simulation/gummy/gummyPartition'
import type { createGummySolver, GummySolverDynamicState, } from '@/simulation/gummy/gummySolver'

export type GummyPalette =
  | 'blue'
  | 'amber'
  | 'berry'
  | 'candy'
  | 'lagoon'
  | 'marble'
export type { GummyInteraction } from './gummyCameraInput'
export type GummyExperiment = 'jelly' | 'pull' | 'crush'
export type GummyGeometry = 'standard' | 'fine'
export type GummySurface = 'original' | 'rounded'
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
  surface?: GummySurface
  tearing: boolean
  paused: boolean
  demoKey: number
  resetKey: number
  resetViewKey?: number
  recording?: boolean
  pointerGuide?: boolean
  reducedMotion?: boolean
  onReady?: (ready: boolean) => void
  onStatus?: (status: GummyStudyStatus) => void
  onError?: (message: string | undefined) => void
  onPauseChange?: (paused: boolean) => void
  onReplay?: () => void
  onReset?: () => void
}

export type GummyDiagnostics = {
  advanceFrames: (count: number) => void | Promise<void>
  startDemoPaused: () => void
  render: () => void
  /** Control corners before PN/isolated-chip patch evaluation, not the final tessellated shell. */
  readSurfacePositions: () => Promise<{
    positions: Float32Array
    restPositions: Float32Array
  }>
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
    surface: GummySurface
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

export type NativeGummyStudyProps = GummyBearSceneProps & {
  visible: boolean
  experiment: GummyExperiment
  protocol: GummyJellyProtocol
  geometry: GummyGeometry
}
