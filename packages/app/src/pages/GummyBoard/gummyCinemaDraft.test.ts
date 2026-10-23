/** Fixed choices track edited board clearance without rewriting loaded or custom trajectories. */
import { describe, expect, it } from 'vitest'
import { GUMMY_BOARD_SHOTS } from '@/components/GummyBoard/gummyBoardShots'
import { createGummyCaptureMechanic, gummyCaptureMechanicContext, } from '@/components/GummyBoard/gummyCaptureMechanics'
import { updateGummyCinemaCaptureContext } from './gummyCinemaDraft'
import { createGummyCinemaRecipe } from './gummyCinemaRecipe'

const sparse = '7k/8/8/3n4/4P3/8/8/K7 w - - 0 1'

function fixed(fen = sparse) {
  const recipe = createGummyCinemaRecipe()
  recipe.shot.fen = fen
  Object.assign(
    recipe.shot,
    createGummyCaptureMechanic(
      'rock-shear',
      73,
      gummyCaptureMechanicContext(recipe.shot, recipe.scale),
    ),
  )
  return recipe
}

describe('Cinema context edits', () => {
  it('preserves exact imported motion when context did not change', () => {
    const recipe = fixed()
    recipe.shot.motion = {
      ...recipe.shot.motion,
      shearDistance: 0.17,
      twistAngle: 0.09,
    }
    expect(
      updateGummyCinemaCaptureContext(recipe, { scale: recipe.scale }),
    ).toBe(recipe)
    expect(
      updateGummyCinemaCaptureContext(recipe, {
        fen: recipe.shot.fen,
        from: recipe.shot.from,
        to: recipe.shot.to,
      }),
    ).toBe(recipe)
  })

  it('keeps the same seed and material while bounding a fixed choice to added neighbours and larger pieces', () => {
    const recipe = fixed()
    const crowded = updateGummyCinemaCaptureContext(recipe, {
      fen: GUMMY_BOARD_SHOTS[0]!.fen,
    })
    expect(crowded.shot.motion.shearDistance).toBeLessThan(
      recipe.shot.motion.shearDistance,
    )
    expect(crowded.shot.motion.twistAngle).toBeLessThan(
      recipe.shot.motion.twistAngle!,
    )
    const larger = updateGummyCinemaCaptureContext(crowded, { scale: 1 })
    expect(larger.shot.motion.shearDistance).toBeLessThan(
      crowded.shot.motion.shearDistance,
    )
    expect(larger.shot.motion.twistAngle).toBeLessThan(
      crowded.shot.motion.twistAngle!,
    )
    expect(larger.shot.mechanic).toEqual(recipe.shot.mechanic)
    expect(larger.material).toBe(recipe.material)
    expect(larger.shot.motion).toEqual(
      createGummyCaptureMechanic(
        'rock-shear',
        73,
        gummyCaptureMechanicContext(larger.shot, larger.scale),
      ).motion,
    )
  })

  it('retries clearance after incomplete FEN and square edits become valid', () => {
    const recipe = fixed()
    let draft = updateGummyCinemaCaptureContext(recipe, { fen: '' })
    draft = updateGummyCinemaCaptureContext(draft, { from: 'h', to: 'd' })
    expect(draft.shot.fen).toBe('')
    expect(draft.shot.from).toBe('h')
    expect(draft.shot.to).toBe('d')
    expect(draft.shot.motion).toEqual(recipe.shot.motion)
    draft = updateGummyCinemaCaptureContext(draft, {
      fen: 'k7/8/8/3n4/2P5/8/8/K6Q w - - 0 1',
    })
    draft = updateGummyCinemaCaptureContext(draft, { from: 'h1' })
    draft = updateGummyCinemaCaptureContext(draft, { to: 'd5' })
    expect(draft.shot.mechanic).toEqual(recipe.shot.mechanic)
    expect(draft.shot.motion.shearDistance).toBeLessThan(
      recipe.shot.motion.shearDistance,
    )
    expect(draft.shot.motion).toEqual(
      createGummyCaptureMechanic(
        'rock-shear',
        73,
        gummyCaptureMechanicContext(draft.shot, draft.scale),
      ).motion,
    )
  })

  it('preserves custom and legacy explicit motion across context edits', () => {
    const recipe = createGummyCinemaRecipe()
    recipe.version = 2
    const custom = {
      ...recipe,
      version: 3 as const,
      shot: {
        ...recipe.shot,
        motion: {
          ...recipe.shot.motion,
          shearSign: -1 as const,
          twistAngle: 0.1,
        },
      },
    }
    for (const source of [recipe, custom]) {
      const edited = updateGummyCinemaCaptureContext(source, {
        fen: sparse,
        scale: 1,
      })
      expect(edited.shot.motion).toBe(source.shot.motion)
      expect(edited.version).toBe(source.version)
    }
  })
})
