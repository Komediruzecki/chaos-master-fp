/** Numerical depth tests for large imported solids, preserving ordinary camera projection. */
import { describe, expect, it } from 'vitest'
import { gummyCameraMatrices } from '../GummyBear/gummyStudyMath'
import { restPieceFarPlane } from './restPieceCamera'
import type { GummyCameraFraming, GummyOrbit, } from '../GummyBear/gummyStudyMath'

const project = (
  orbit: GummyOrbit,
  framing: GummyCameraFraming,
  aspect: number,
  far?: number,
) => {
  const vp = new Float32Array(16)
  gummyCameraMatrices(
    orbit,
    aspect,
    vp,
    new Float32Array(16),
    new Float32Array(3),
    'pull',
    framing,
    far,
  )
  return vp
}
const depth = (vp: Float32Array, x: number, y: number, z: number) =>
  (vp[2]! * x + vp[6]! * y + vp[10]! * z + vp[14]!) /
  (vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!)

describe('resting solid preview depth range', () => {
  it('keeps the established projection for ordinary chess geometry', () => {
    const framing: GummyCameraFraming = {
      min: [-1.6, 0, 0],
      max: [1.6, 2.7, 1.6],
      surfacePadding: 0.144,
    }
    const orbit = { theta: 0.32, phi: 1.15, zoom: 1 }
    const far = restPieceFarPlane(orbit, 1, framing)
    expect(far).toBe(50)
    expect(project(orbit, framing, 1, far)).toEqual(project(orbit, framing, 1))
  })

  it('keeps every padded corner inside the depth range for a distant candidate beside the pawn', () => {
    const framing: GummyCameraFraming = {
      min: [-1.538, 0, -0.1],
      max: [91.3, 2.7, 1.6],
      surfacePadding: 0.144,
    }
    for (const aspect of [0.4, 1, 1.8])
      for (const orbit of [
        { theta: 0.32, phi: 1.15, zoom: 1 },
        {
          theta: 1.5,
          phi: 0.4,
          zoom: 1.2,
          pan: [25, 0, 0] as [number, number, number],
        },
      ]) {
        const vp = project(
          orbit,
          framing,
          aspect,
          restPieceFarPlane(orbit, aspect, framing),
        )
        const legacy = project(orbit, framing, aspect)
        let legacyClips = 0
        const padding = framing.surfacePadding!
        for (const x of [framing.min[0] - padding, framing.max[0] + padding])
          for (const y of [framing.min[1] - padding, framing.max[1] + padding])
            for (const z of [
              framing.min[2] - padding,
              framing.max[2] + padding,
            ]) {
              expect(depth(vp, x, y, z)).toBeGreaterThan(0)
              expect(depth(vp, x, y, z)).toBeLessThan(1)
              if (depth(legacy, x, y, z) >= 1) legacyClips++
            }
        expect(legacyClips).toBeGreaterThan(0)
      }
  })
})
