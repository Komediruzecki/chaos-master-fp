/** A saved fractal body must remain the same volume in the display seed, MPM fixture and contact bake. */
import { describe, expect, it } from 'vitest'
import { authoredPawnField, createGummyAuthoredPawn } from './gummyAuthoredPawn'
import { bakeGummyChessColliderField } from './gummyChessColliderField'
import { sampleGummyChessMould } from './gummyChessMoulds'
import { prepareGummyParticles } from './gummyParticleMath'

describe('authored pawn volume adapters', () => {
  it('uses identical equal-volume material cells for a resting pawn and the capture victim', () => {
    const authoredPawn = createGummyAuthoredPawn()
    const display = sampleGummyChessMould(
      'pawn',
      0.08,
      0,
      'sculpted',
      authoredPawn,
    )
    const physics = prepareGummyParticles({
      fixture: 'pawn',
      spacing: 0.08,
      pinnedFeet: false,
      artStyle: 'sculpted',
      authoredPawn,
    })
    expect(physics.restPositions).toEqual(new Float32Array(display))
    expect(physics.particleVolume).toBe(0.08 ** 3)
    expect(display).not.toEqual(
      sampleGummyChessMould('pawn', 0.08, 0, 'sculpted'),
    )
    expect(
      sampleGummyChessMould('rook', 0.08, 0, 'sculpted', authoredPawn),
    ).toEqual(sampleGummyChessMould('rook', 0.08, 0, 'sculpted'))
  })

  it('samples the authored pawn field into contact distances and finite outward gradients', () => {
    const authoredPawn = createGummyAuthoredPawn()
    const field = bakeGummyChessColliderField('pawn', 'sculpted', authoredPawn)
    const [nx, ny, nz] = field.size
    expect(field.values.byteLength).toBeLessThan(4 * 1024 * 1024)
    for (let z = 1; z < nz - 1; z += 5)
      for (let y = 1; y < ny - 1; y += 5)
        for (let x = 1; x < nx - 1; x += 5) {
          const offset = ((z * ny + y) * nx + x) * 4
          const point = [
            field.origin[0] + x * field.step,
            field.origin[1] + y * field.step,
            field.origin[2] + z * field.step,
          ] as const
          expect(field.values[offset + 3]).toBeCloseTo(
            authoredPawnField(point, authoredPawn),
            6,
          )
          expect(
            [...field.values.subarray(offset, offset + 4)].every(
              Number.isFinite,
            ),
          ).toBe(true)
        }
  })
})
