/** Reuse GPU uploads until sampling changes, and allocate the solid prototype only when selected. */
import type { createPawnBoardRenderer } from '../PawnBoard/pawnBoardRenderer'
import type { CollectionCloud } from './collectionCloudWorker'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

type Renderer = Pick<
  ReturnType<typeof createPawnBoardRenderer>,
  | 'clearVariantClouds'
  | 'clearVariantGlass'
  | 'clearVariantSolids'
  | 'setVariantCloud'
  | 'setVariantGlass'
  | 'setVariantSolid'
>

export function createNativeCinemaResources(renderer: Renderer) {
  let uploaded: CollectionCloud[] | undefined
  let uploadedSolids: WindowRookFracture[] | undefined
  let uploadedSolidShell: FractalStudyGlass | undefined
  return (
    recipe: NativeCinemaRecipe,
    clouds: CollectionCloud[],
    shell?: FractalStudyGlass,
    solids?: WindowRookFracture[],
    solidShell?: FractalStudyGlass,
  ) => {
    if (uploaded !== clouds) {
      renderer.clearVariantClouds()
      renderer.clearVariantGlass()
      renderer.clearVariantSolids()
      for (const cloud of clouds)
        renderer.setVariantCloud(
          cloud.key,
          cloud.side,
          cloud.points,
          cloud.colors,
        )
      if (shell)
        renderer.setVariantGlass(
          recipe.nativeCollection.id,
          shell.vertices,
          shell.radius,
        )
      uploaded = clouds
      uploadedSolids = undefined
      uploadedSolidShell = undefined
    }
    if (recipe.fracture === 'connected' && !solids?.length)
      throw new Error(
        'The connected solid could not be prepared for this collection.',
      )
    if (
      recipe.fracture === 'connected' &&
      solids &&
      uploadedSolids !== solids
    ) {
      for (const solid of solids)
        renderer.setVariantSolid(solid.key, solid.vertices)
      uploadedSolids = solids
    }
    if (
      recipe.fracture === 'connected' &&
      solidShell &&
      uploadedSolidShell !== solidShell
    ) {
      renderer.setVariantGlass(
        `${recipe.nativeCollection.id}:solid`,
        solidShell.vertices,
        solidShell.radius,
      )
      uploadedSolidShell = solidShell
    }
  }
}
