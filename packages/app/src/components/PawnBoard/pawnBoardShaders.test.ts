/** Exercise the actual shader compiler before a scene ever reaches a GPU. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { backgroundFragment, boardFragment, cloudFragment, cloudVertex, displayFragment, fragmentVertex, glassExitFragment, glassFragment, meshVertex, shardFragment, } from './pawnBoardShaders'
import { dielectricF0, dielectricFresnel, displayColour, glassAttenuation, studioEnvironment, } from './pawnGlassMaterial'

describe('native pawn board shaders', () => {
  it.each([
    meshVertex,
    boardFragment,
    glassFragment,
    glassExitFragment,
    backgroundFragment,
    displayFragment,
    shardFragment,
    fragmentVertex,
    cloudVertex,
    cloudFragment,
  ])('resolves each native entrypoint', (shader) => {
    const source = tgpu.resolve([shader])
    expect(source).toMatch(/@(vertex|fragment)/)
  })

  it('matches glass normal-incidence reflectance and the grazing-angle limit', () => {
    expect(dielectricF0(1.5)).toBeCloseTo(0.04, 6)
    expect(dielectricFresnel(1, 1.5)).toBeCloseTo(0.04, 6)
    expect(dielectricFresnel(0, 1.5)).toBe(1)
    expect(dielectricFresnel(1, 1)).toBe(0)
  })

  it('attenuates by optical path in metres, preserving unabsorbed light at zero distance', () => {
    const colour = d.vec3f(0.5, 0.8, 1)
    const none = glassAttenuation(colour, 0.6, 0)
    const one = glassAttenuation(colour, 0.6, 0.6)
    const two = glassAttenuation(colour, 0.6, 1.2)
    expect([none.x, none.y, none.z]).toEqual([1, 1, 1])
    expect(one.x).toBeCloseTo(0.5, 6)
    expect(one.y).toBeCloseTo(0.8, 6)
    expect(two.x).toBeCloseTo(0.25, 6)
    expect(two.y).toBeCloseTo(0.64, 6)
    expect(two.z).toBe(1)
  })

  it('provides HDR studio cards rather than a dim uniform reflection', () => {
    const keyDirection = d.vec3f(-0.58, 0.64, 0.48)
    const magnitude = Math.hypot(keyDirection.x, keyDirection.y, keyDirection.z)
    const key = studioEnvironment(
      d.vec3f(
        keyDirection.x / magnitude,
        keyDirection.y / magnitude,
        keyDirection.z / magnitude,
      ),
      0.055,
    )
    const ground = studioEnvironment(d.vec3f(0, -1, 0), 0.055)
    expect(key.x).toBeGreaterThan(4)
    expect(ground.x).toBeLessThan(0.1)
    expect(
      [key.x, key.y, key.z, ground.x, ground.y, ground.z].every(
        Number.isFinite,
      ),
    ).toBe(true)
  })

  it('applies the display transfer once while preserving linear output for an sRGB canvas', () => {
    const linear = displayColour(d.vec3f(0.18), 0)
    const encoded = displayColour(d.vec3f(0.18), 1)
    expect(linear.x).toBeCloseTo(0.26689892, 6)
    expect(encoded.x).toBeCloseTo(0.55345757, 6)
    const black = displayColour(d.vec3f(0), 1)
    const bright = displayColour(d.vec3f(100), 1)
    expect([black.x, black.y, black.z]).toEqual([0, 0, 0])
    expect([bright.x, bright.y, bright.z]).toEqual([1, 1, 1])
  })
})
