/**
 * One frame of a Flame Clash as the flame the renderer draws: both fighters'
 * transforms placed, tinted and tagged with their team, and the fight
 * uniforms, on a neutral stage.
 *
 * The fight flame is rebuilt every frame, but its shape never changes during
 * a bout (the same transform ids, variation ids and types, and teams), so
 * the renderer compiles it once and every frame after is a uniform write.
 *
 * The stage is neutral on purpose: neither fighter brings its palette or its
 * grading, so neither side looks stronger for its author's exposure. Each
 * keeps its own transform colours, turned toward its team's hue.
 */
import { latestSchemaVersion, renderSettingsDefault, } from '../schema/flameSchema'
import { fighterForm } from './convert2Dto3D'
import { authoredFraming } from './framing'
import { composeAffine, fighterFrame, invertAffine, placementAffine, placeTransform, } from './placement'
import { tintColour } from './tint'
import type { FlameDescriptor, TransformFunction } from '../schema/flameSchema'
import type { BoutFrame, FighterPose } from './choreographer'
import type { FighterForm } from './convert2Dto3D'
import type { Affine3 } from './placement'
import type { Team } from './tint'

export type ClashFighter = {
  name: string
  form: FighterForm
  framing: Affine3
}

/**
 * Why a flame cannot fight, or undefined when it can. A fighter needs at
 * least one visible transform with a positive probability: with none, its
 * walkers would have no map to take and would sit where they started.
 */
export function unfitReason(flame: FlameDescriptor): string | undefined {
  const live = Object.values(flame.transforms).some(
    (t) => t.visible && t.probability > 0,
  )
  return live ? undefined : 'it has no visible transform to fight with'
}

export function clashFighter(
  flame: FlameDescriptor,
  name = flame.metadata.name || 'Untitled',
): ClashFighter {
  return { name, form: fighterForm(flame), framing: authoredFraming(flame) }
}

/** The neutral stage every bout renders on. */
export const STAGE_SETTINGS: FlameDescriptor['renderSettings'] = {
  ...renderSettingsDefault,
  dimensions: 3,
  drawMode: 'light',
  exposure: 0.35,
  vibrancy: 1,
  contrast: 1.15,
  gamma: 2.4,
  depthColorPower: 0.3,
  autoExposure3D: true,
  pointInitMode: 'pointInitUnitBall',
  colorInitMode: 'colorInitZero',
  skipIters: 20,
  densityEstimationQuality: 0.8,
}

const prefixOf = (team: Team) => (team === 'A' ? 'a_' : 'b_')

/** One fighter's transforms for this frame, keyed `a_<id>` or `b_<id>`. */
export function fighterTransforms(
  fighter: ClashFighter,
  team: Team,
  pose: FighterPose,
): Record<string, TransformFunction> {
  const place = composeAffine(placementAffine(pose.placement), fighter.framing)
  const frame = fighterFrame(place, fighter.form.finalTransform)
  // A placement always inverts (its scale and squash are positive), so the
  // fallback only guards a degenerate framing.
  const inverse = invertAffine(frame)
  const out: Record<string, TransformFunction> = {}
  for (const [tid, t] of Object.entries(
    fighter.form.transformsAt(pose.morph),
  )) {
    const placed = inverse ? placeTransform(t, frame, inverse) : t
    out[`${prefixOf(team)}${tid}`] = {
      ...placed,
      color: tintColour(t.color, team, pose.tint),
      team,
    }
  }
  return out
}

/** The fight flame at `frame`. */
export function fightFlame(
  a: ClashFighter,
  b: ClashFighter,
  frame: BoutFrame,
): FlameDescriptor {
  return {
    version: latestSchemaVersion,
    metadata: {
      name: `${a.name} vs ${b.name}`,
      author: 'Flame Clash',
      description: 'A Flame Clash preview bout.',
    },
    renderSettings: {
      ...STAGE_SETTINGS,
      exposure: STAGE_SETTINGS.exposure + Math.log(frame.exposure),
      clash: { split: frame.split, leakA: frame.leakA, leakB: frame.leakB },
    },
    transforms: {
      ...fighterTransforms(a, 'A', frame.a),
      ...fighterTransforms(b, 'B', frame.b),
    },
  }
}
