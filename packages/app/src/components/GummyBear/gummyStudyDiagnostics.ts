/** Development inspection of elastic studies without taking ownership of live GPU state. */
import { untrack } from 'solid-js'
import { analyzeGummyFragments } from '@/simulation/gummy/gummyPartition'
import { GUMMY_JELLY_TEAR_BODY_FIXTURE, GUMMY_STEP } from './gummyStudyMath'
import type { GummyDiagnostics, GummySurface, NativeGummyStudyProps, } from './gummyStudyContracts'
import type { GummyBenchmarkPhase, GummyClock, GummyGrip, GummyPress, } from './gummyStudyMath'
import type { GummyStudyResources } from './gummyStudyResources'

type Context = {
  props: NativeGummyStudyProps
  resources: GummyStudyResources
  surface: () => GummySurface
  settings: () => ReturnType<GummyDiagnostics['info']>['settings']
  state: () => {
    clock: GummyClock
    steps: number
    benchmarkPhase: GummyBenchmarkPhase | 'idle'
    demo: boolean
    advancing: boolean
    draws: number
    drawsDuringMutation: number
  }
  currentGrip: () => GummyGrip | undefined
  press: () => GummyPress | undefined
  draw: () => void
  reset: (demo: boolean) => void
  simulate: () => void
  advanceTearFrames: (count: number) => Promise<void>
  readQuiescent: <T>(read: () => Promise<T>) => Promise<T>
}

export function createGummyStudyDiagnostics(
  context: Context,
): GummyDiagnostics {
  const {
    props,
    resources,
    surface,
    settings,
    state,
    currentGrip,
    draw,
    reset,
    simulate,
    advanceTearFrames,
    readQuiescent,
  } = context
  const {
    continuous,
    laid,
    meshOptions,
    restBounds,
    materialModel,
    bodyFixture,
    fractureRuntime,
  } = resources
  return {
    advanceFrames(count) {
      if (!Number.isInteger(count) || count < 0 || count > 3600)
        throw new RangeError('Diagnostic steps must be between 0 and 3600')
      if (fractureRuntime) return advanceTearFrames(count)
      for (let i = 0; i < count; i++) simulate()
      draw()
    },
    startDemoPaused() {
      untrack(() => props.onPauseChange?.(true))
      reset(true)
      draw()
    },
    render: draw,
    readSurfacePositions: () =>
      readQuiescent(() => resources.renderer.readSurfacePositions()),
    readState: () =>
      readQuiescent(async () => {
        const state = await resources.solver.readState()
        const dynamic = fractureRuntime
          ? await resources.solver.snapshotDynamic()
          : undefined
        return {
          ...state,
          restPositions: resources.solverMesh.positions.slice(),
          fragments: analyzeGummyFragments(resources.mesh, state.damage),
          topology: fractureRuntime?.topology(),
          dynamic,
        }
      }),
    info: () => ({
      time: state().clock.time,
      steps: state().steps,
      vertices: resources.solver.vertexCount,
      interfaces: resources.solver.interfaceCount,
      tetrahedra: resources.mesh.tetrahedra.length / 4,
      regions: resources.regions,
      restVolume: resources.mesh.restVolume,
      experiment: props.experiment,
      geometry: props.geometry,
      surface: surface(),
      materialModel,
      solverIterations: resources.solver.iterations,
      solverSubsteps: resources.solver.jellySubsteps ?? 1,
      protocol: continuous
        ? props.protocol
        : props.experiment === 'crush'
          ? 'legacy-crush'
          : 'legacy-pull',
      phase: state().benchmarkPhase,
      tick: state().steps,
      pose: laid ? 'laid' : 'upright',
      meshOptions: { ...meshOptions },
      restBounds: { min: [...restBounds.min], max: [...restBounds.max] },
      bodyFixture: bodyFixture
        ? { ...GUMMY_JELLY_TEAR_BODY_FIXTURE, heldNodes: bodyFixture.heldNodes }
        : undefined,
      settings: {
        softness: settings().softness,
        fragility: settings().fragility,
        tearResponse: settings().tearResponse,
        tearing: settings().tearing,
        palette: settings().palette,
        fixedDt: GUMMY_STEP,
      },
      press: context.press() ? { ...context.press()! } : undefined,
      grip: !!currentGrip(),
      gripCommand: currentGrip(),
      demo: state().demo,
      mutationPending: state().advancing || !!fractureRuntime?.pending,
      topologyRevision: fractureRuntime?.diagnostics.topologyVersion ?? 0,
      fractureSamplingTicks: 6,
      fracture: fractureRuntime?.diagnostics,
      fracturePerformance: fractureRuntime
        ? {
            ...fractureRuntime.profile,
            draws: state().draws,
            drawsDuringMutation: state().drawsDuringMutation,
          }
        : undefined,
    }),
  }
}
