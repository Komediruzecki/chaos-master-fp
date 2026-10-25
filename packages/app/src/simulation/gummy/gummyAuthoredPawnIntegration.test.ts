/** A saved fractal body must remain the same volume in the display seed, MPM fixture and contact bake. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { MARCHING_GUMMY_FIXED_SCALE, MARCHING_GUMMY_ISO, MARCHING_GUMMY_RADIUS_SCALE, marchingGummyDensity, } from '@/components/GummyBear/marchingGummyMath'
import { authoredPawnField, createGummyAuthoredPawn } from './gummyAuthoredPawn'
import { bakeGummyChessColliderField } from './gummyChessColliderField'
import { sampleGummyChessMould } from './gummyChessMoulds'
import { prepareGummyParticles } from './gummyParticleMath'

describe('authored pawn volume adapters', () => {
  it.each([0.08, 0.12])(
    'keeps a visible air passage through the actual reconstructed crown at spacing %s',
    (spacing) => {
      const authoredPawn = createGummyAuthoredPawn()
      const particles = sampleGummyChessMould(
        'pawn',
        spacing,
        0,
        'sculpted',
        authoredPawn,
      )
      const radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
      const weight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
      const angle =
        authoredPawn.recipe.twist + Math.PI / authoredPawn.recipe.branchCount
      const y = 1.48 * 1.26 + authoredPawn.thickness
      // Traverse a 0.24-unit-high opening (.18 at coarse quality) from outside the crown through
      // its hollow centre. This samples the same quantized kernel as marching
      // cubes, so a negative-space field that the particle surface fills fails.
      for (const row of [-2, -1, 0, 1, 2]) {
        const height = row * (spacing === 0.08 ? 0.06 : 0.045)
        for (let step = -8; step <= 8; step++) {
          const distance = step * 0.08
          const point = [
            Math.cos(angle) * distance,
            y + height,
            Math.sin(angle) * distance,
          ]
          let density = 0
          for (let i = 0; i < particles.length; i += 4) {
            const relative = d.vec3f(
              point[0]! - particles[i]!,
              point[1]! - particles[i + 1]!,
              point[2]! - particles[i + 2]!,
            )
            density +=
              Math.round(
                marchingGummyDensity(relative, radius, weight) *
                  MARCHING_GUMMY_FIXED_SCALE,
              ) / MARCHING_GUMMY_FIXED_SCALE
          }
          expect(density).toBeLessThan(MARCHING_GUMMY_ISO)
        }
      }
    },
  )
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
