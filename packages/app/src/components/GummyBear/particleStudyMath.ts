/** Fixed-tick lateral handle motion for the isolated particle-jelly comparison. */
import { pickGummyVertex } from './gummyStudyMath'
import type { GummyBenchmarkPhase, GummyGrip, GummyRay, GummyVec3, } from './gummyStudyMath'

export const PARTICLE_STUDY_TICKS = 1440
export const PARTICLE_PULL_HANDLE: Readonly<{
  center: GummyVec3
  radius: number
  pull: GummyVec3
}> = {
  center: [0.64, 1.24, 0.08],
  radius: 0.28,
  pull: [1.2, 0.12, 0.08],
}

/** Only the handle is prescribed; the particle solver supplies every deformation. */
export function particleStudyCommand(tick: number): {
  phase: GummyBenchmarkPhase
  grip?: GummyGrip
} {
  if (!Number.isInteger(tick) || tick < 0)
    throw new RangeError('Particle study ticks must be non-negative integers')
  if (tick >= PARTICLE_STUDY_TICKS) return { phase: 'complete' }
  if (tick >= 840) return { phase: 'recovering' }
  const phase = tick >= 600 ? 'holding' : tick >= 120 ? 'loading' : 'settling'
  const t = Math.max(0, Math.min(1, (tick - 120) / 480))
  const load = t * t * (3 - 2 * t)
  const handle = PARTICLE_PULL_HANDLE
  return {
    phase,
    grip: {
      center: [...handle.center],
      radius: handle.radius,
      target: [
        handle.center[0] + handle.pull[0] * load,
        handle.center[1] + handle.pull[1] * load,
        handle.center[2] + handle.pull[2] * load,
      ],
    },
  }
}

/** Pick the deformed body while selecting the same particle in material space. */
export function pickParticleGrip(
  ray: GummyRay,
  positions: Float32Array,
  restPositions: Float32Array,
  pickRadius: number,
): { point: GummyVec3; grip: GummyGrip } | undefined {
  if (positions.length !== restPositions.length || positions.length % 4)
    throw new RangeError(
      'Particle pick arrays must contain matching packed xyzw',
    )
  const point = pickGummyVertex(ray, positions, pickRadius)
  if (!point) return undefined
  for (let i = 0; i < positions.length; i += 4) {
    if (
      positions[i + 3]! > 0 &&
      positions[i] === point[0] &&
      positions[i + 1] === point[1] &&
      positions[i + 2] === point[2]
    ) {
      return {
        point,
        grip: {
          center: [
            restPositions[i]!,
            restPositions[i + 1]!,
            restPositions[i + 2]!,
          ],
          target: [...point],
          radius: 0.28,
        },
      }
    }
  }
  return undefined
}
