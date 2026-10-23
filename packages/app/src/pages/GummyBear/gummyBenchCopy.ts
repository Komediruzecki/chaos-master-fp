/** Status and interaction instructions for each gummy workbench model. */
import { isGummyChessMould } from '@/simulation/gummy/gummyChessMoulds'
import type { GummyExperiment, GummyInteraction, GummyStudyStatus, } from '@/components/GummyBear/GummyBearScene'
import type { GummyJellyProtocol } from '@/components/GummyBear/gummyStudyMath'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'

export type GummyBenchModel = GummyExperiment | 'particle' | 'mpm'

const READY_LABELS = {
  tear: 'Ready to tear',
  squeeze: 'Ready to squeeze',
  stretch: 'Ready to stretch',
} satisfies Record<GummyJellyProtocol, string>

const ACTIVE_LABELS: Partial<Record<GummyStudyStatus, string>> = {
  pulling: 'Pulling the right arm',
  stretching: 'Stretching the jelly',
  retracting: 'Raising the press',
  settling: 'Releasing and settling',
  picking: 'Finding your grip…',
  dragging: 'Release to let it settle',
}

function holdingLabel(
  experiment: GummyBenchModel,
  protocol: GummyJellyProtocol,
) {
  if (experiment === 'particle' || experiment === 'mpm')
    return 'Holding the pull'
  if (experiment !== 'jelly') return 'Holding compression'
  if (protocol === 'tear') return 'Holding the pull'
  return protocol === 'stretch' ? 'Holding the stretch' : 'Holding compression'
}

export function gummyBenchStatus(state: {
  error?: string
  ready: boolean
  paused: boolean
  status: GummyStudyStatus
  experiment: GummyBenchModel
  protocol: GummyJellyProtocol
}): string {
  if (state.error) return 'The study stopped'
  if (!state.ready) return 'Preparing the gummy…'
  if (state.paused) return 'Paused'
  const activeLabel = ACTIVE_LABELS[state.status]
  if (activeLabel) return activeLabel
  if (state.status === 'crushing')
    return state.experiment === 'jelly'
      ? 'Squeezing the jelly'
      : 'Lowering the press'
  if (state.status === 'holding')
    return holdingLabel(state.experiment, state.protocol)
  if (state.experiment === 'jelly') return READY_LABELS[state.protocol]
  return state.experiment === 'crush' ? 'Ready to crush' : 'Ready to pull'
}

function particleHint(
  fixture: GummyParticleFixture,
  pinnedFeet: boolean,
): string {
  if (fixture === 'blobs')
    return 'Drag one blob toward the other, release, then pull it away.'
  if (isGummyChessMould(fixture))
    return pinnedFeet
      ? 'Base held. Pull the head or crown, release, then grab the fallen jelly.'
      : 'Free piece. Grab the head or crown and pull, or lift the whole piece.'
  return pinnedFeet
    ? 'Feet held. Try a short pull, release, then grab the fallen jelly.'
    : 'Free bear. Grab and pull, then release to let it settle.'
}

export function gummyBenchHint(state: {
  mode: GummyInteraction
  experiment: GummyBenchModel
  fixture: GummyParticleFixture
  pinnedFeet: boolean
  protocol: GummyJellyProtocol
}): string {
  if (state.mode === 'pan')
    return 'Drag to move the view. Scroll or pinch to move closer.'
  if (state.mode !== 'drag')
    return 'Drag to turn around the bear. Scroll or pinch to move closer.'
  if (state.experiment === 'mpm' || state.experiment === 'particle')
    return particleHint(state.fixture, state.pinnedFeet)
  if (state.experiment === 'jelly')
    return state.protocol === 'tear'
      ? 'Body held. Grab an arm or ear, pull a little, then release.'
      : 'Grab and stretch the jelly. Release to watch it recover.'
  return state.experiment === 'crush'
    ? 'Grab any part and pull, or run the press demo.'
    : 'Grab the arm or ear and pull. Release to watch it settle.'
}

export function gummyBenchMaterialHint(
  experiment: GummyBenchModel,
  protocol: GummyJellyProtocol,
  material: 'warm' | 'elastic',
): string {
  if (experiment === 'particle' || experiment === 'mpm')
    return material === 'warm'
      ? 'Higher fragility softens stretched jelly sooner. Turn tearing off to compare how it yields without damage.'
      : 'The earlier elastic response. Turn tearing off to compare its spring back, then reset before another pull.'
  if (experiment === 'jelly')
    return protocol === 'tear'
      ? 'Higher fragility breaks connections sooner. Turn tearing off to compare the stretch.'
      : 'This motion keeps the jelly joined. Choose Pull to tear to test separation.'
  return 'Reset to restore the bear before trying another pull or crush.'
}
