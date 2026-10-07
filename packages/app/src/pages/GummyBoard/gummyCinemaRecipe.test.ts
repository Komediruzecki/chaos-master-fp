/** Portable cinema recipes preserve exact materials and reject invalid positions before application. */
import { describe, expect, it } from 'vitest'
import { GUMMY_BOARD_SHOTS } from '@/components/GummyBoard/gummyBoardShots'
import { createGummyCinemaRecipe, parseGummyCinemaRecipe, } from './gummyCinemaRecipe'

export const ROCK_GUMMY_SETTINGS = {
  palette: 'marble',
  particleMaterial: 'warm',
  softness: 0.65,
  fragility: 0.7,
  tearing: true,
  tuning: {
    grabStrength: 0.65,
    flow: 1,
    gravity: 1,
    floorDrag: 8.5,
    viscosity: 0.61,
  },
  grabRadius: 0.26,
  maxPull: 0.6,
  pinnedFeet: true,
  caustics: true,
} as const

describe('gummy cinema recipes', () => {
  it('round-trips every RockGummy setting with the complete shot configuration', () => {
    const recipe = createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1])
    expect(recipe.material).toEqual(ROCK_GUMMY_SETTINGS)
    const decoded = parseGummyCinemaRecipe(JSON.stringify(recipe))
    expect(decoded).toEqual(recipe)
    expect(decoded.material).toEqual(ROCK_GUMMY_SETTINGS)
    expect(decoded.material).not.toBe(recipe.material)
    expect(decoded.material.tuning).not.toBe(recipe.material.tuning)
    expect(decoded.shot).not.toBe(recipe.shot)
    expect(decoded.shot.motion).not.toBe(recipe.shot.motion)
    expect(decoded).toMatchObject({
      version: 2,
      shot: { motion: { shearOnset: 1, shearDistance: 0.18 } },
    })
    decoded.material.tuning.flow = 0.3
    expect(recipe.material.tuning.flow).toBe(1)
  })

  it('round-trips custom physics instead of reconstructing material from its preset label', () => {
    const recipe = createGummyCinemaRecipe()
    recipe.shot.presetId = 'custom'
    recipe.material = {
      palette: 'berry',
      particleMaterial: 'elastic',
      softness: 0.13,
      fragility: 0.27,
      tearing: false,
      tuning: {
        grabStrength: 0.31,
        flow: 0.12,
        gravity: 1.34,
        floorDrag: 10.7,
        viscosity: 0.92,
      },
      grabRadius: 0.17,
      maxPull: 1.19,
      pinnedFeet: false,
      caustics: false,
    }
    recipe.artStyle = 'classic'
    recipe.scale = 0.95
    recipe.quality = 'tablet'
    recipe.attackerPalette = 'candy'
    recipe.victimPalette = 'lagoon'
    recipe.shot.cameraStyle = 'hero'
    recipe.shot.boardTheme = 'lava'
    expect(parseGummyCinemaRecipe(JSON.stringify(recipe))).toEqual(recipe)
  })

  it('accepts older version-one recipes with explicit defaults for optional appearance', () => {
    const {
      artStyle: _art,
      attackerPalette: _attacker,
      victimPalette: _victim,
      ...oldRecipe
    } = createGummyCinemaRecipe()
    const { motion: _motion, ...shot } = oldRecipe.shot
    expect(
      parseGummyCinemaRecipe({ ...oldRecipe, version: 1, shot }),
    ).toMatchObject({
      version: 2,
      shot: { motion: { shearOnset: 1, shearDistance: 0.18 } },
      artStyle: 'sculpted',
      attackerPalette: 'amber',
      victimPalette: 'blue',
    })
  })

  it('round-trips explicit version-two early motion without mutating the recipe or built-in shot', () => {
    const recipe = createGummyCinemaRecipe(GUMMY_BOARD_SHOTS[1])
    recipe.shot.motion = {
      shearOnset: 0.35,
      shearDistance: 0.42,
      contactHold: 0.35,
    }
    const decoded = parseGummyCinemaRecipe(JSON.stringify(recipe))
    expect(decoded).toEqual(recipe)
    decoded.shot.motion.shearDistance = 0.6
    expect(recipe.shot.motion.shearDistance).toBe(0.42)
    expect(recipe.material).toEqual(ROCK_GUMMY_SETTINGS)
    expect(GUMMY_BOARD_SHOTS[1]!.motion).toBeUndefined()
  })

  it('requires explicit version-two motion and refuses new motion in version-one recipes', () => {
    const recipe = createGummyCinemaRecipe()
    const { motion: _motion, ...shot } = recipe.shot
    expect(() => parseGummyCinemaRecipe({ ...recipe, shot })).toThrow(
      /explicit shot motion/,
    )
    expect(() => parseGummyCinemaRecipe({ ...recipe, version: 1 })).toThrow(
      /version 2/,
    )
  })

  it('defaults the hold to zero when importing an earlier two-control v2 recipe', () => {
    const recipe = createGummyCinemaRecipe()
    recipe.shot.motion = { shearOnset: 0.35, shearDistance: 0.6 }
    expect(parseGummyCinemaRecipe(recipe).shot.motion).toEqual({
      shearOnset: 0.35,
      shearDistance: 0.6,
      contactHold: 0,
    })
  })

  it.each([
    null,
    [],
    {},
    { shearOnset: 1.01, shearDistance: 0.18 },
    { shearOnset: 0.35, shearDistance: 1.21 },
    { shearOnset: 0.35, shearDistance: NaN },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: 0.61 },
    { shearOnset: 0.35, shearDistance: 0.6, contactHold: '0.35' },
  ])('rejects invalid v2 motion %j before application', (motion) => {
    const recipe = createGummyCinemaRecipe()
    expect(() =>
      parseGummyCinemaRecipe({ ...recipe, shot: { ...recipe.shot, motion } }),
    ).toThrow()
  })

  it.each([
    ['missing kings', { fen: '8/8/8/8/8/8/8/8 w - - 0 1' }],
    ['empty source', { from: 'e3' }],
    ['empty target', { to: 'e5' }],
    ['wrong side', { from: 'd5', to: 'e4' }],
    ['invalid square', { from: 'i4' }],
  ])('rejects %s without changing the source recipe', (_label, fields) => {
    const recipe = createGummyCinemaRecipe()
    const before = JSON.stringify(recipe)
    expect(() =>
      parseGummyCinemaRecipe({
        ...recipe,
        shot: { ...recipe.shot, ...fields },
      }),
    ).toThrow()
    expect(JSON.stringify(recipe)).toBe(before)
  })

  it.each([
    { scale: 0.84 },
    { scale: 1.01 },
    { scale: NaN },
    { quality: 'ultra' },
    { artStyle: 'unknown' },
    { attackerPalette: 'green' },
    { victimPalette: 'silver' },
    { version: 3 },
    { format: 'different' },
    { material: {} },
  ])('rejects invalid recipe fields %j', (fields) => {
    expect(() =>
      parseGummyCinemaRecipe({ ...createGummyCinemaRecipe(), ...fields }),
    ).toThrow()
  })

  it('rejects malformed JSON and incomplete material tuning', () => {
    expect(() => parseGummyCinemaRecipe('{')).toThrow()
    expect(() => parseGummyCinemaRecipe(null)).toThrow()
    const recipe = createGummyCinemaRecipe()
    const { viscosity: _viscosity, ...incomplete } = recipe.material.tuning
    expect(() =>
      parseGummyCinemaRecipe({
        ...recipe,
        material: { ...recipe.material, tuning: incomplete },
      }),
    ).toThrow(/Fine tuning/)
  })
})
