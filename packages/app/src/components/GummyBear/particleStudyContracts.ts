/** Particle-jelly controls and development diagnostics without scene imports. */
import type { GummyBearSceneProps } from './gummyStudyContracts'
import type { GummyBenchmarkPhase, GummyGrip, gummyRestBounds, } from './gummyStudyMath'
import type { createMarchingGummyRenderer } from './marchingGummyRenderer'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleMath'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

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

export type ParticleDiagnosticRenderOptions = { raw?: boolean; clay?: boolean }

export type ParticleDiagnostics = {
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
