/**
 * The fight flame: both fighters tagged with their teams, one shader for a
 * whole bout, and the fight uniforms carried through to the renderer.
 */
import { describe, expect, it } from 'vitest'
import { clashTeamsOf, clashTeamsSignature } from '../clashTeams'
import { examples } from '../examples'
import { resolveIfsWgsl } from '../ifsPipelineWgsl.testUtils'
import { shaderShapeOf } from '../shaderShape'
import { extractFlameUniforms3D } from '../transformFunction3D'
import { BOUT_SECONDS, boutFrame } from './choreographer'
import { clashFighter, fightFlame, STAGE_SETTINGS, unfitReason, } from './fightFlame'
import type { FlameDescriptor } from '../schema/flameSchema'

const galaxy = clashFighter(examples.example37)
const gasket = clashFighter(examples.goldenApollonianGasket)
const options = { winner: 'A' as const, reducedMotion: false }

describe('fightFlame', () => {
  const flame = fightFlame(galaxy, gasket, boutFrame(4, options))

  it('puts every transform of each fighter on its team', () => {
    const teams = clashTeamsOf(flame.transforms)
    expect(teams.enabled).toBe(true)
    expect(teams.a).toEqual(
      Object.keys(examples.example37.transforms).map((t) => `a_${t}`),
    )
    expect(teams.b).toEqual(
      Object.keys(examples.goldenApollonianGasket.transforms).map(
        (t) => `b_${t}`,
      ),
    )
  })

  it('compiles one shader for the whole bout', () => {
    const key = (f: FlameDescriptor) =>
      JSON.stringify([
        shaderShapeOf(f.transforms),
        clashTeamsSignature(clashTeamsOf(f.transforms)),
      ])
    const first = key(fightFlame(galaxy, gasket, boutFrame(0, options)))
    for (let wall = 0; wall <= BOUT_SECONDS; wall += 0.25) {
      const f = fightFlame(galaxy, gasket, boutFrame(wall, options))
      expect(key(f)).toBe(first)
    }
  })

  it('compiles the team kernel for it', () => {
    const wgsl = resolveIfsWgsl({ transforms: flame.transforms, dims: 3 })
    expect(wgsl).toContain('fn setClashTeam(')
  })

  it('carries the fight uniforms and the flash', () => {
    const frame = boutFrame(4, options)
    expect(flame.renderSettings.clash).toEqual({
      split: frame.split,
      leakA: frame.leakA,
      leakB: frame.leakB,
    })
    const flash = fightFlame(galaxy, gasket, { ...frame, exposure: 2 })
    expect(flash.renderSettings.exposure).toBeCloseTo(
      STAGE_SETTINGS.exposure + Math.log(2),
      12,
    )
  })

  it('renders on the neutral 3D stage, without a palette', () => {
    expect(flame.renderSettings.dimensions).toBe(3)
    expect(flame.renderSettings.palette).toBeUndefined()
  })

  it('gives the renderer finite uniforms for every transform', () => {
    const uniforms = extractFlameUniforms3D(flame)
    expect(Object.keys(uniforms)).toHaveLength(
      Object.keys(flame.transforms).length,
    )
    const numbers = JSON.stringify(uniforms).match(/-?[\d.e+-]+|null/g) ?? []
    expect(numbers).not.toContain('null')
  })

  it('keeps a hidden transform hidden', () => {
    const hidden = structuredClone(examples.example37)
    Object.values(hidden.transforms)[0]!.visible = false
    const f = fightFlame(clashFighter(hidden), gasket, boutFrame(4, options))
    expect(Object.values(f.transforms)[0]!.visible).toBe(false)
  })
})

describe('unfitReason', () => {
  it('accepts a flame with a live transform', () => {
    expect(unfitReason(examples.example37)).toBeUndefined()
  })

  it('refuses a flame whose transforms are all hidden or weightless', () => {
    const dead = structuredClone(examples.example2)
    for (const t of Object.values(dead.transforms)) t.visible = false
    expect(unfitReason(dead)).toMatch(/no visible transform/)
    const weightless = structuredClone(examples.example2)
    for (const t of Object.values(weightless.transforms)) t.probability = 0
    expect(unfitReason(weightless)).toMatch(/no visible transform/)
  })
})
