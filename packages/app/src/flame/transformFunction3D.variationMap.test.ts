/**
 * How the 3D pipeline resolves a variation type: every registered type, and
 * every name main's legacy map knew.
 *
 * `createFlameWgsl3D` picks each variation's shader function through
 * `resolveVariationType3D` alone, so this table decides how a saved flame
 * renders in 3D. Validation keeps any type string and rewrites only the names
 * migrateFlameTypes.ts lists, so set_flame, a JSON import or a share link can
 * hand the 3D pipeline an unregistered name, and it must render as it did on
 * main. The Flame Clash converts 2D fighters by its own rule
 * (flame/clash/convert2Dto3D.ts) and must never move a row of this table.
 */
import { VARIATION_TYPE_MIGRATIONS } from '@chaos-master/core'
import { describe, expect, it } from 'vitest'
import { buildIfsPipeline, resolveIfsWgsl } from './ifsPipelineWgsl.testUtils'
import { renderSettingsDefault, validateFlame } from './schema/flameSchema'
import { resolveVariationType3D, VARIATION_2D_TO_3D_MAP, } from './transformFunction3D'
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

/**
 * Every key of main's VARIATION_2D_TO_3D_MAP (at 8e42c078), and the type main
 * rendered a loaded 3D flame that carries it with: validation's migration
 * first, then the map, then the registries. Recorded from main's sources.
 */
const MAIN_RESOLVED: Record<string, string> = {
  linear: 'linearVar',
  linearT: 'linear3D',
  spherical: 'sphericalVar',
  sinusoidal: 'sinusoidalVar',
  swirl: 'swirlVar',
  swirl3: 'swirl3D',
  horseshoe: 'horseshoeVar',
  polar: 'polarVar',
  polar2: 'polar3D',
  nPolar: 'polar3D',
  handkerchief: 'handkerchiefVar',
  heart: 'heartVar',
  disc: 'discVar',
  spiral: 'spiralVar',
  diamond: 'diamondVar',
  ex: 'ex3D',
  julia: 'juliaVar',
  juliaN: 'juliaNVar',
  juliaScope: 'juliaScopeVar',
  bent: 'bentVar',
  waves: 'wavesVar',
  fisheye: 'fisheyeVar',
  exponential: 'exponentialVar',
  power: 'powerVar',
  rings: 'ringsVar',
  rings2: 'rings2Var',
  eyefish: 'eyefishVar',
  bubble: 'bubble3D',
  bubbleVar: 'bubble3D',
  cylinder: 'cylinder3D',
  cylinderVar: 'cylinder3D',
  cylinder2Var: 'cylindrical3D',
  cylindrical: 'cylindrical3D',
  cylinderApoVar: 'cylinder3D',
  gaussian: 'gaussian3D',
  gaussianVar: 'gaussian3D',
  sphere: 'sphere3D',
  sphereVar: 'sphere3D',
  blur: 'blur3D',
  blurVar: 'blur3D',
  square: 'square3D',
  squareVar: 'square3D',
  scry: 'scry3D',
  scryVar: 'scry3D',
  cross: 'cross3D',
  crossVar: 'cross3D',
  curl: 'curl3D',
  curlVar: 'curl3D',
  pdj: 'pdj3D',
  pdjVar: 'pdj3D',
  hemisphere: 'hemisphere3D',
  starfield: 'starfield3D',
}

/** What validation turns a type string into. */
const migrated = (type: string) =>
  Object.hasOwn(VARIATION_TYPE_MIGRATIONS, type)
    ? VARIATION_TYPE_MIGRATIONS[type]!
    : type

/**
 * A raw one-transform flame whose variation has `type`, as JSON brings it.
 * Its params hold every key the parametric names here read, so each reads
 * values of the flame's and none falls back to a default unnoticed.
 */
function rawFlame(type: string, dimensions: 2 | 3) {
  const identity = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }
  return {
    renderSettings: { ...renderSettingsDefault, dimensions },
    transforms: {
      t1: {
        probability: 1,
        preAffine: { ...identity, a: 0.6, e: 0.6 },
        postAffine: identity,
        color: { x: 0.2, y: -0.1 },
        variations: {
          v1: {
            type,
            weight: 0.7,
            params: { a: 0.3, b: 1.1, c: -0.4, d: 0.8, e: 0.1, f: -0.2 },
          },
        },
      },
    },
  }
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

describe('every name main resolved in 3D', () => {
  const names = Object.keys(MAIN_RESOLVED)

  it('is migrated by validation or still mapped', () => {
    const lost = names.filter(
      (name) =>
        !Object.hasOwn(VARIATION_TYPE_MIGRATIONS, name) &&
        !Object.hasOwn(VARIATION_2D_TO_3D_MAP, name),
    )
    expect(lost).toEqual([])
  })

  it('resolves, once validated, to the type main resolved it to', () => {
    const moved = names
      .map((name) => [name, resolveVariationType3D(migrated(name))] as const)
      .filter(([name, now]) => now !== MAIN_RESOLVED[name])
    expect(moved).toEqual([])
  })

  it.each(names)(
    'compiles %s, once validated, to the shader and uniforms of what main resolved it to',
    (name) => {
      const render = (type: string) => {
        const flame = validateFlame(rawFlame(type, 3))
        const pipeline = buildIfsPipeline({
          transforms: flame.transforms,
          dims: 3,
        })
        pipeline.update(flame)
        return { wgsl: pipeline.wgsl(), writes: pipeline.writes }
      }
      const legacy = render(name)
      const main = render(MAIN_RESOLVED[name]!)
      expect(legacy.wgsl).toBe(main.wgsl)
      expect(legacy.writes).toEqual(main.writes)
    },
  )
})

describe('the legacy names validation migrates', () => {
  const rewritten = Object.keys(MAIN_RESOLVED).filter(
    (name) =>
      Object.hasOwn(VARIATION_TYPE_MIGRATIONS, name) &&
      !(name in transformVariations),
  )

  it('leave no row in the map, since no loaded flame keeps them', () => {
    expect(
      rewritten.filter((name) => Object.hasOwn(VARIATION_2D_TO_3D_MAP, name)),
    ).toEqual([])
  })

  it('draw in 2D too, where main skipped the ones it did not migrate', () => {
    for (const name of ['blur', 'square', 'scry', 'cross', 'curl', 'pdj']) {
      const flame = validateFlame(rawFlame(name, 2))
      const variation = Object.values(flame.transforms)[0]!.variations
      expect(Object.values(variation)[0]!.type).toBe(`${name}Var`)
      expect(resolveIfsWgsl({ transforms: flame.transforms, dims: 2 })).toMatch(
        /\bvariationv1\b/,
      )
    }
  })
})

describe('VARIATION_2D_TO_3D_MAP', () => {
  it('holds the live analogs, and the names validation keeps that no registered type renders as', () => {
    const kept = Object.keys(VARIATION_2D_TO_3D_MAP).filter(
      (type) => !(type in LIVE_LEGACY_ANALOGS),
    )
    for (const type of kept) {
      expect(Object.hasOwn(transformVariations, type)).toBe(false)
      expect(Object.hasOwn(VARIATION_TYPE_MIGRATIONS, type)).toBe(false)
      expect(VARIATION_2D_TO_3D_MAP[type]).toBe(MAIN_RESOLVED[type])
    }
    for (const [type, analog] of Object.entries(LIVE_LEGACY_ANALOGS)) {
      expect(VARIATION_2D_TO_3D_MAP[type]).toBe(analog)
    }
  })

  it('sends each to a registered 3D type', () => {
    for (const analog of Object.values(VARIATION_2D_TO_3D_MAP)) {
      expect(Object.hasOwn(transformVariations3D, analog)).toBe(true)
    }
  })
})

describe('resolveVariationType3D for a transform from a 2D fighter', () => {
  // The Flame Clash marks each transform of a 2D fighter `from2D`: its 2D
  // variations run as the fighter's own 2D functions, never as the 3D
  // analogs this table gives a saved flame (flame/clash/convert2Dto3D.ts).
  it('resolves every registered 2D type to itself, the live analogs too', () => {
    for (const type of Object.keys(transformVariations)) {
      expect(resolveVariationType3D(type, true)).toBe(type)
    }
  })

  it('resolves every registered 3D type to itself', () => {
    for (const type of Object.keys(transformVariations3D)) {
      expect(resolveVariationType3D(type, true)).toBe(type)
    }
  })

  it('resolves an unregistered name to nothing, as the 2D pipeline does', () => {
    for (const type of ['sphere', 'linearT', 'noSuchVariation']) {
      expect(resolveVariationType3D(type, true)).toBeUndefined()
    }
  })
})
