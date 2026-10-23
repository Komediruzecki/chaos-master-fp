/** Development inspection of the particle studies with live access to simulation counters. */
import { untrack } from 'solid-js'
import { GUMMY_STEP } from './gummyStudyMath'
import type { GummyBenchmarkPhase, GummyClock, GummyGrip, gummyRestBounds, } from './gummyStudyMath'
import type { createMarchingGummyRenderer } from './marchingGummyRenderer'
import type { createParticleGummyRenderer } from './particleGummyRenderer'
import type { ParticleDiagnosticRenderOptions, ParticleDiagnostics, ParticleGummyBearSceneProps, } from './particleStudyContracts'
import type { particleGripControls } from './particleStudyMath'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

type Info = ReturnType<ParticleDiagnostics['info']>
type Context = {
  props: ParticleGummyBearSceneProps
  solver: ReturnType<typeof createGummyParticleSolver>
  renderer:
    | ReturnType<typeof createParticleGummyRenderer>
    | ReturnType<typeof createMarchingGummyRenderer>
  experiment: Info['experiment']
  reconstruction: Info['reconstruction']
  fixture: Info['fixture']
  restBounds: ReturnType<typeof gummyRestBounds>
  settings: () => Omit<
    Info['settings'],
    'fixedDt' | 'grabRadius' | 'maxPull' | 'pinnedFeet' | 'pointerGuide'
  > & { gripControls: ReturnType<typeof particleGripControls> }
  state: () => {
    clock: GummyClock
    steps: number
    phase: GummyBenchmarkPhase | 'idle'
    demo: boolean
    submittedFrames: number
    completedFrames: number
    gpuPending: boolean
  }
  currentGrip: () => GummyGrip | undefined
  draw: (options?: ParticleDiagnosticRenderOptions) => void
  reset: (demo: boolean) => void
  simulate: () => void
}

export function createParticleStudyDiagnostics(
  context: Context,
): ParticleDiagnostics {
  const {
    props,
    solver,
    renderer,
    experiment,
    reconstruction,
    fixture,
    restBounds,
    settings,
    state,
    currentGrip,
    draw,
    reset,
    simulate,
  } = context
  return {
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
      phase: state().phase,
      time: state().clock.time,
      steps: state().steps,
      tick: state().steps,
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
      demo: state().demo,
      submittedFrames: state().submittedFrames,
      completedFrames: state().completedFrames,
      gpuPending: state().gpuPending,
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
}
