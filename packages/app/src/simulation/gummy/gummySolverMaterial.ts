/** Fixed-step calibration and validated controls for the XPBD gummy materials. */
import type { GummyPress, GummyStep } from './gummySolverContracts'

export function normalizeGummyPress(press?: GummyPress) {
  if (
    !press ||
    !Number.isFinite(press.height) ||
    !Number.isFinite(press.halfExtent) ||
    press.height < 0.02 ||
    press.halfExtent <= 0
  )
    return undefined
  return press
}

export function gummyCohesiveStrength(value?: number) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0.05, Math.min(8, value))
    : 1
}
export const GUMMY_FIXED_DT = 1 / 120
export const GUMMY_SOLVER_ITERATIONS = 5
export const GUMMY_FINE_SOLVER_ITERATIONS = 16

export function gummyMaterial(
  softness: number,
  mode: GummyStep['fractureMode'] = 'legacy',
) {
  const s = Number.isFinite(softness) ? Math.min(1, Math.max(0, softness)) : 0.5
  const fine = mode === 'tension-shear'
  return {
    // Crush needs compliant lateral strain with a stiff bulk response, not compressible shrinkage.
    stretchCompliance: 0.0000002 * 120 ** s * (fine ? 8 : 1),
    volumeCompliance: 0.00002 * 12 ** s * (fine ? 0.01 : 1),
    damping: 2.6,
  }
}
