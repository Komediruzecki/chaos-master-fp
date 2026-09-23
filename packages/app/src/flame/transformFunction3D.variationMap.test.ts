/**
 * How the 3D pipeline resolves a variation type, for every registered type.
 *
 * `createFlameWgsl3D` picks each variation's shader function through
 * `resolveVariationType3D` alone, so this table is what decides how a saved
 * flame renders in 3D. Eleven registered 2D types resolve to a 3D analog
 * through the legacy map; every other registered type, 2D or 3D, resolves to
 * itself. The Flame Clash converts 2D fighters by its own rule
 * (flame/clash/convert2Dto3D.ts) and must never move a row of this table.
 */
import { describe, expect, it } from 'vitest'
import { resolveVariationType3D } from './transformFunction3D'
import { transformVariations } from './variations'
import { transformVariations3D } from './variations3D'

/** The registered 2D types the legacy map sends to a 3D analog. */
const LIVE_LEGACY_ANALOGS: Record<string, string> = {
  bubbleVar: 'bubble3D',
  cylinderVar: 'cylinder3D',
  cylinder2Var: 'cylindrical3D',
  cylinderApoVar: 'cylinder3D',
  gaussianVar: 'gaussian3D',
  blurVar: 'blur3D',
  squareVar: 'square3D',
  scryVar: 'scry3D',
  crossVar: 'cross3D',
  curlVar: 'curl3D',
  pdjVar: 'pdj3D',
}

describe('resolveVariationType3D over the registries', () => {
  it('sends exactly the eleven live legacy types to their 3D analogs', () => {
    const moved = Object.keys(transformVariations)
      .filter((type) => resolveVariationType3D(type) !== type)
      .sort()
    expect(moved).toEqual(Object.keys(LIVE_LEGACY_ANALOGS).sort())
    for (const [type, analog] of Object.entries(LIVE_LEGACY_ANALOGS)) {
      expect(resolveVariationType3D(type)).toBe(analog)
    }
  })

  it('resolves every other registered 2D type to itself', () => {
    for (const type of Object.keys(transformVariations)) {
      if (type in LIVE_LEGACY_ANALOGS) continue
      expect(resolveVariationType3D(type)).toBe(type)
    }
  })

  it('resolves every registered 3D type to itself', () => {
    for (const type of Object.keys(transformVariations3D)) {
      expect(resolveVariationType3D(type)).toBe(type)
    }
  })

  it('resolves an unknown type to nothing', () => {
    expect(resolveVariationType3D('noSuchVariation')).toBeUndefined()
  })
})
