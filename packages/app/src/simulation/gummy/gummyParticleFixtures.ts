/** Jelly study fixture identities and free, separated contact samples. */
import { GUMMY_CHESS_MOULDS, isGummyChessMould, sampleGummyChessMould, } from './gummyChessMoulds'
import { gummyBearField } from './gummyMesh'
import type { GummyAuthoredPawn } from './gummyAuthoredPawn'
import type { GummyChessArtStyle, GummyChessMould } from './gummyChessMoulds'

export type GummyParticleFixture = 'bear' | 'blobs' | GummyChessMould

export type GummyParticleFixtureOptions = {
  spacing?: number
  pinnedFeet?: boolean
  pinHeight?: number
  fixture?: GummyParticleFixture
  artStyle?: GummyChessArtStyle
  authoredPawn?: GummyAuthoredPawn
}

/** Preserve the original bear lattice exactly when selecting a different study mould. */
function sampleBear(spacing: number, pinHeight: number) {
  const points: number[] = []
  for (let iy = 0; iy * spacing < 2.6; iy++)
    for (let iz = Math.floor(-0.55 / spacing); iz * spacing < 0.6; iz++)
      for (let ix = Math.floor(-0.8 / spacing); ix * spacing < 0.8; ix++) {
        const x = (ix + 0.5) * spacing
        const y = (iy + 0.5) * spacing
        const z = (iz + 0.5) * spacing
        if (gummyBearField([x, y, z]) > 0) continue
        points.push(x, y, z, y < pinHeight ? 0 : 1)
      }
  return points
}

/** Fixture selection and anchoring leave the solver's mass and timestep calculation shared. */
export function sampleGummyParticleFixture(
  options: GummyParticleFixtureOptions,
) {
  const spacing = options.spacing ?? 0.08
  if (!Number.isFinite(spacing) || spacing < 0.06 || spacing > 0.12)
    throw new RangeError('Particle spacing must be between 0.06 and 0.12')
  const fixture = options.fixture ?? 'bear'
  const chess = isGummyChessMould(fixture) ? fixture : undefined
  const requestedPinHeight =
    options.pinHeight ?? (chess ? GUMMY_CHESS_MOULDS[chess].pinHeight : 0.48)
  if (
    !Number.isFinite(requestedPinHeight) ||
    requestedPinHeight < 0 ||
    requestedPinHeight > 0.6
  )
    throw new RangeError('Particle pin height must be between zero and 0.6')
  let pinHeight = options.pinnedFeet !== false ? requestedPinHeight : 0
  if (fixture === 'blobs')
    return { spacing, points: sampleGummyParticleBlobs(spacing), pinHeight: 0 }
  if (chess) {
    pinHeight = Math.min(pinHeight, GUMMY_CHESS_MOULDS[chess].pinHeight)
    return {
      spacing,
      points: sampleGummyChessMould(
        chess,
        spacing,
        pinHeight,
        options.artStyle,
        options.authoredPawn,
      ),
      pinHeight,
    }
  }
  return { spacing, points: sampleBear(spacing, pinHeight), pinHeight }
}

export const GUMMY_BLOB_RADIUS = 0.42
export const GUMMY_BLOB_CENTERS = [
  [-0.7, 0.55, 0],
  [0.7, 0.55, 0],
] as const

/** Equal-volume samples, symmetric about x=0; no pinned particles or prejoined seam. */
export function sampleGummyParticleBlobs(spacing: number): number[] {
  if (!Number.isFinite(spacing) || spacing < 0.06 || spacing > 0.12)
    throw new RangeError('Particle spacing must be between 0.06 and 0.12')
  const points: number[] = []
  for (let iy = 0; iy * spacing < 1; iy++)
    for (let iz = Math.floor(-0.5 / spacing); iz * spacing < 0.5; iz++)
      for (let ix = Math.floor(-1.2 / spacing); ix * spacing < 1.2; ix++) {
        const x = (ix + 0.5) * spacing
        const y = (iy + 0.5) * spacing
        const z = (iz + 0.5) * spacing
        if (
          !GUMMY_BLOB_CENTERS.some(
            ([cx, cy, cz]) =>
              (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <
              GUMMY_BLOB_RADIUS ** 2,
          )
        )
          continue
        points.push(x, y, z, 1)
      }
  return points
}

/** Stable Lagoon palette coordinates label original bodies without recolouring their motion. */
export function gummyBlobDyePositions(rest: Float32Array): Float32Array {
  const dye = new Float32Array(rest.length)
  for (let i = 0; i < rest.length; i += 4) dye[i + 1] = rest[i]! < 0 ? 0.4 : 1.1
  return dye
}
