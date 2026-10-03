/** Dye follows rest-space anatomy and combines extinction when an optical path crosses bands. */
import { d } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyAbsorptionAtPoint, gummyAbsorptionAtRest, gummyColourAtPoint, gummyColourAtRest, gummyMarbleWeights, gummyVolumeTransmission, } from './gummyBands'
import { GUMMY_MATERIALS, gummyTransmission } from './gummyMaterial'

const unpack = (v: d.v3f) => [v.x, v.y, v.z]
describe('gummy material bands', () => {
  it.each(Object.values(GUMMY_MATERIALS))(
    'preserves the solid material at every rest height',
    (material) => {
      const absorption = d.vec3f(
        material.absorption[0],
        material.absorption[1],
        material.absorption[2],
      )
      const colour = d.vec3f(
        material.colour[0],
        material.colour[1],
        material.colour[2],
      )
      for (const height of [-10, 0, 0.7, 1.6, 2.1, 10]) {
        expect(unpack(gummyAbsorptionAtRest(height, 0, absorption))).toEqual(
          unpack(absorption),
        )
        expect(unpack(gummyColourAtRest(height, 0, colour))).toEqual(
          unpack(colour),
        )
      }
      expect(
        unpack(
          gummyVolumeTransmission(
            d.vec3f(0),
            d.vec3f(1, 2, 0),
            0.8,
            0,
            absorption,
          ),
        ),
      ).toEqual(unpack(gummyTransmission(absorption, 0.8)))
    },
  )

  it('authors Candy amber feet, green torso, pink face and deep cherry cap', () => {
    const sample = (height: number) => gummyColourAtRest(height, 1, d.vec3f(0))
    const feet = sample(0.3),
      torso = sample(1.1),
      face = sample(1.8),
      cap = sample(2.4)
    expect(feet.x).toBeGreaterThan(feet.y)
    expect(feet.y).toBeGreaterThan(feet.z)
    expect(torso.y).toBeGreaterThan(torso.x * 4)
    expect(torso.y).toBeGreaterThan(torso.z * 4)
    expect(face.x).toBeGreaterThan(face.z)
    expect(face.z).toBeGreaterThan(face.y * 4)
    expect(cap.x).toBeLessThan(face.x * 0.5)
    expect(cap.x).toBeGreaterThan(cap.y * 10)
  })

  it('authors Lagoon amber feet, turquoise torso and cobalt head', () => {
    const feet = gummyColourAtRest(0.3, 2, d.vec3f(0))
    const torso = gummyColourAtRest(1.1, 2, d.vec3f(0))
    const head = gummyColourAtRest(2, 2, d.vec3f(0))
    expect(feet.x).toBeGreaterThan(feet.y)
    expect(torso.y).toBeGreaterThan(torso.x * 20)
    expect(torso.z).toBeGreaterThan(torso.x * 20)
    expect(head.z).toBeGreaterThan(head.y * 5)
    expect(head.z).toBeGreaterThan(head.x * 20)
  })

  it('softens each boundary continuously without averaging distant anatomical bands', () => {
    for (const [mode, height] of [
      [1, 0.69],
      [1, 1.6],
      [1, 2.09],
      [2, 0.69],
      [2, 1.67],
    ]) {
      const below = gummyColourAtRest(height! - 0.00001, mode!, d.vec3f(0))
      const above = gummyColourAtRest(height! + 0.00001, mode!, d.vec3f(0))
      for (let i = 0; i < 3; i++)
        expect(Math.abs(unpack(above)[i]! - unpack(below)[i]!)).toBeLessThan(
          0.001,
        )
    }
  })

  it('combines full-volume extinction along material coordinates, symmetrically in either direction', () => {
    const enter = d.vec3f(0, 0, 0),
      exit = d.vec3f(0, 1.4, 0)
    // Three samples are fully amber, three fully green; no midpoint hits a transition.
    const result = gummyVolumeTransmission(enter, exit, 0.8, 1, d.vec3f(0))
    expect(result.x).toBeCloseTo(Math.exp(-((0.12 + 2.8) / 2) * 0.8), 6)
    expect(result.y).toBeCloseTo(Math.exp(-((0.8 + 0.25) / 2) * 0.8), 6)
    expect(result.z).toBeCloseTo(Math.exp(-3.5 * 0.8), 6)
    const reverse = gummyVolumeTransmission(exit, enter, 0.8, 1, d.vec3f(0))
    for (let i = 0; i < 3; i++)
      expect(unpack(reverse)[i]).toBeCloseTo(unpack(result)[i]!, 6)
    expect(
      unpack(gummyVolumeTransmission(enter, exit, 0, 1, d.vec3f(0))),
    ).toEqual([1, 1, 1])
  })

  it('preserves Candy and Lagoon through the full-point material API', () => {
    const fallback = d.vec3f(0.2, 0.3, 0.4)
    for (const mode of [0, 1, 2])
      for (const height of [0.2, 1.1, 1.8, 2.4]) {
        const point = d.vec3f(-0.3, height, 0.4)
        expect(unpack(gummyAbsorptionAtPoint(point, mode, fallback))).toEqual(
          unpack(gummyAbsorptionAtRest(height, mode, fallback)),
        )
        expect(unpack(gummyColourAtPoint(point, mode, fallback))).toEqual(
          unpack(gummyColourAtRest(height, mode, fallback)),
        )
      }
  })

  it('authors amber and berry bulk with a true three-dimensional turquoise ribbon', () => {
    expect(gummyMarbleWeights(d.vec3f(0, 0.2, 0)).x).toBeGreaterThan(0.99)
    expect(gummyMarbleWeights(d.vec3f(0, 1.05, 0)).z).toBeGreaterThan(0.99)
    expect(gummyMarbleWeights(d.vec3f(0, 2, 0)).y).toBeGreaterThan(0.99)
    // Equal heights on opposite sides have different dye: this is not another horizontal band.
    const right = gummyMarbleWeights(d.vec3f(0.5, 1.05, 0.3))
    const left = gummyMarbleWeights(d.vec3f(-0.5, 1.05, -0.3))
    expect(Math.abs(right.x - left.x)).toBeGreaterThan(0.8)
    for (const x of [-0.7, 0, 0.7])
      for (const y of [0, 0.5, 1.1, 1.8, 2.5])
        for (const z of [-0.35, 0, 0.5]) {
          const weights = gummyMarbleWeights(d.vec3f(x, y, z))
          expect(weights.x + weights.y + weights.z).toBeCloseTo(1, 6)
          expect(
            unpack(weights).every((value) => value >= 0 && value <= 1),
          ).toBe(true)
        }
  })

  it('keeps Marble amber, cherry and turquoise spectrally distinct through a substantial body path', () => {
    const transmit = (height: number) =>
      gummyTransmission(
        gummyAbsorptionAtPoint(d.vec3f(0, height, 0), 3, d.vec3f(0)),
        0.6,
      )
    const amber = transmit(0.2)
    const cherry = transmit(2)
    const turquoise = transmit(1.05)
    expect(amber.x).toBeGreaterThan(amber.y * 2)
    expect(amber.z).toBeLessThan(amber.y * 0.15)
    expect(cherry.x).toBeGreaterThan(cherry.y * 10)
    expect(cherry.x).toBeGreaterThan(cherry.z * 10)
    expect(cherry.z).toBeLessThan(0.05)
    expect(turquoise.x).toBeLessThan(Math.min(turquoise.y, turquoise.z) * 0.1)
    expect(turquoise.y / turquoise.z).toBeLessThan(1.5)
  })

  it('integrates Marble pigment through a volume and preserves reciprocal segment absorption', () => {
    const enter = d.vec3f(-0.4, 0.8, 0.5),
      exit = d.vec3f(0.3, 1.7, -0.3)
    const forward = gummyVolumeTransmission(enter, exit, 0.7, 3, d.vec3f(0))
    const reverse = gummyVolumeTransmission(exit, enter, 0.7, 3, d.vec3f(0))
    for (let i = 0; i < 3; i++) {
      expect(unpack(forward)[i]).toBeGreaterThan(0)
      expect(unpack(forward)[i]).toBeLessThan(1)
      expect(unpack(forward)[i]).toBeCloseTo(unpack(reverse)[i]!, 6)
    }
  })
})
