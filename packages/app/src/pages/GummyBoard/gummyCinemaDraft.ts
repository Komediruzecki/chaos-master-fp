/** Rebound fixed capture choices only when the user edits their board context. */
import { createGummyCaptureMechanic, gummyCaptureMechanicContext, } from '@/components/GummyBoard/gummyCaptureMechanics'
import type { GummyCinemaRecipe } from './gummyCinemaRecipe'
import type { GummyBoardShot } from '@/components/GummyBoard/gummyBoardShots'

type CaptureContextEdit = Partial<
  Pick<GummyBoardShot, 'fen' | 'from' | 'to'>
> & {
  scale?: number
}

export function updateGummyCinemaCaptureContext(
  recipe: GummyCinemaRecipe,
  edit: CaptureContextEdit,
): GummyCinemaRecipe {
  const { scale = recipe.scale, ...position } = edit
  const shot = { ...recipe.shot, ...position }
  if (
    scale === recipe.scale &&
    shot.fen === recipe.shot.fen &&
    shot.from === recipe.shot.from &&
    shot.to === recipe.shot.to
  )
    return recipe
  const next = { ...recipe, shot, scale }
  if (!shot.mechanic) return next
  try {
    const choice = createGummyCaptureMechanic(
      shot.mechanic.id,
      shot.mechanic.seed,
      gummyCaptureMechanicContext(shot, scale),
    )
    return { ...next, version: 3, shot: { ...shot, ...choice } }
  } catch {
    // Keep incomplete FEN/square edits writable. A valid edit retries the bound;
    // Apply still validates the complete recipe before replacing the live shot.
    return next
  }
}
