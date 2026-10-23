/** Validated particle placement and initial continuum state before GPU allocation. */
import { d } from 'typegpu'
import { GummyParticleState } from './gummyParticleLayouts'
import { GUMMY_PARTICLE_GRID_SIZE, prepareGummyParticles, } from './gummyParticleMath'
import type { GummyParticleOptions } from './gummyParticleContracts'

export function prepareGummyParticleSolver(options: GummyParticleOptions) {
  const geometry = prepareGummyParticles(options)
  const {
    restPositions,
    particleCount,
    spacing,
    gridSpacing,
    substeps,
    fixedDt,
  } = geometry
  const gridSize = options.gridSize ?? GUMMY_PARTICLE_GRID_SIZE
  if (!Number.isInteger(gridSize) || gridSize < 32 || gridSize > 64)
    throw new RangeError('Particle grid size must be an integer from 32 to 64')
  const gridCount = gridSize ** 3
  const initialOffset = options.initialOffset ?? [0, 0, 0]
  const gridOrigin = options.gridOrigin ?? geometry.gridOrigin
  if (![...initialOffset, ...gridOrigin].every(Number.isFinite))
    throw new RangeError('Particle placement and grid origin must be finite')
  const initialRotationY = options.initialRotationY ?? 0
  if (
    !Number.isFinite(initialRotationY) ||
    !Number.isFinite(options.colliderRotationY ?? 0)
  )
    throw new RangeError('Particle and collider orientations must be finite')
  const cosine = Math.cos(initialRotationY),
    sine = Math.sin(initialRotationY)
  const initialPositions = new Float32Array(restPositions)
  for (let i = 0; i < initialPositions.length; i += 4) {
    const x = restPositions[i]!,
      z = restPositions[i + 2]!
    initialPositions[i] = x * cosine + z * sine + initialOffset[0]
    initialPositions[i + 1]! += initialOffset[1]
    initialPositions[i + 2] = z * cosine - x * sine + initialOffset[2]
  }
  const initialStates = new Float32Array(
    (particleCount * d.sizeOf(GummyParticleState)) / 4,
  )
  for (let id = 0; id < particleCount; id++) {
    const base = (id * d.sizeOf(GummyParticleState)) / 4
    initialStates[base] = 1
    initialStates[base + 5] = 1
    initialStates[base + 10] = 1
    initialStates[base + 25] = 1
  }
  return {
    geometry,
    restPositions,
    particleCount,
    spacing,
    gridSpacing,
    substeps,
    fixedDt,
    gridSize,
    gridCount,
    gridOrigin,
    initialPositions,
    initialStates,
  }
}
