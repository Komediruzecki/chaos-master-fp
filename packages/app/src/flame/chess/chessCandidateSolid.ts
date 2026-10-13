/** Versioned finite-volume requests are plain data, safe to validate in a worker. */
/** A reproducible finite-volume request, not proof that this source is a playable solid. */
export type ChessCandidateSolid = {
  adapter: 'affine-ifs-volume'
  version: 1
  seed: number
  /** Surface thickness in placed-world metres, independent of the original source scale. */
  thickness: number
  /** Particle sampling distance in placed-world metres. */
  spacing: 0.04 | 0.06 | 0.08
}

export const CHESS_CANDIDATE_SOLID_MIN_THICKNESS = 0.025
export const CHESS_CANDIDATE_SOLID_MAX_THICKNESS = 0.18
export const CHESS_CANDIDATE_SOLID_SPACINGS: readonly ChessCandidateSolid['spacing'][] =
  [0.04, 0.06, 0.08]
export const CHESS_CANDIDATE_SOLID_DEFAULT: Readonly<ChessCandidateSolid> =
  Object.freeze({
    adapter: 'affine-ifs-volume',
    version: 1,
    seed: 42,
    thickness: 0.05,
    spacing: 0.04,
  })
export function validateChessCandidateSolid(
  value: unknown,
): ChessCandidateSolid {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Finite solid settings must be an object.')
  const data = value as Record<string, unknown>
  const keys = ['adapter', 'version', 'seed', 'thickness', 'spacing']
  if (Object.keys(data).some((key) => !keys.includes(key)))
    throw new Error('Finite solid settings contain an unsupported option.')
  if (data.adapter !== 'affine-ifs-volume' || data.version !== 1)
    throw new Error('This finite solid adapter or version is not supported.')
  if (
    typeof data.seed !== 'number' ||
    !Number.isInteger(data.seed) ||
    data.seed < 0 ||
    data.seed > 0xffffffff
  )
    throw new Error(
      'Finite solid seed must be an integer between 0 and 4294967295.',
    )
  if (
    typeof data.thickness !== 'number' ||
    !Number.isFinite(data.thickness) ||
    data.thickness < CHESS_CANDIDATE_SOLID_MIN_THICKNESS ||
    data.thickness > CHESS_CANDIDATE_SOLID_MAX_THICKNESS
  )
    throw new Error(
      'Finite solid thickness must be between 0.025 and 0.18 metres.',
    )
  if (
    !CHESS_CANDIDATE_SOLID_SPACINGS.includes(
      data.spacing as ChessCandidateSolid['spacing'],
    )
  )
    throw new Error('Finite solid spacing must be 0.04, 0.06 or 0.08 metres.')
  return {
    adapter: 'affine-ifs-volume',
    version: 1,
    seed: data.seed,
    thickness: data.thickness,
    spacing: data.spacing as ChessCandidateSolid['spacing'],
  }
}
