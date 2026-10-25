/** Appearance edits share uploaded geometry; solid mesh storage is lazy and collection-scoped. */
import { describe, expect, it, vi } from 'vitest'
import { createNativeCinemaResources } from './nativeCinemaResources'
import type { CollectionCloud } from './collectionCloudWorker'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

const recipe: NativeCinemaRecipe = {
  format: 'native-chess-cinema-shot',
  version: 1,
  fen: '7k/8/8/3r4/4P3/8/8/K7 w - - 0 1',
  from: 'e4',
  to: 'd5',
  nativeCollection: { version: 1, id: 'lattice-court', enclosure: 'glass' },
  scale: 0.9,
  quality: 'normal',
  camera: 'arc',
}
const clouds: CollectionCloud[] = [
  {
    key: 'rook:light',
    side: 'light',
    points: new Float32Array(4),
    colors: new Float32Array(4),
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  },
]
const shell = { vertices: new Float32Array(18), radius: 1 }
const solidShell = { vertices: new Float32Array(24), radius: 1.1 }
const solids: WindowRookFracture[] = [
  {
    key: 'rook:light',
    vertices: new Float32Array(19),
    fragmentCount: 1,
    chunks: [],
    diagnostics: {
      cellSize: 1,
      occupiedCells: 1,
      connectedComponents: 1,
      retainedFraction: 1,
      volume: 1,
      interfaceFaces: 0,
      exteriorFaces: 6,
    },
  },
]

function setup() {
  const renderer = {
    clearVariantClouds: vi.fn(),
    clearVariantGlass: vi.fn(),
    clearVariantSolids: vi.fn(),
    setVariantCloud: vi.fn(),
    setVariantGlass: vi.fn(),
    setVariantSolid: vi.fn(),
  }
  return { renderer, upload: createNativeCinemaResources(renderer) }
}

describe('native Cinema upload ownership', () => {
  it('keeps all geometry through camera and enclosure edits and defers solids until selected', () => {
    const { renderer, upload } = setup()
    upload(recipe, clouds, shell, solids)
    upload({ ...recipe, camera: 'hero', scale: 0.85 }, clouds, shell, solids)
    upload(
      {
        ...recipe,
        nativeCollection: { ...recipe.nativeCollection, enclosure: 'pure' },
      },
      clouds,
      shell,
      solids,
    )
    expect(renderer.setVariantCloud).toHaveBeenCalledOnce()
    expect(renderer.setVariantGlass).toHaveBeenCalledOnce()
    expect(renderer.setVariantSolid).not.toHaveBeenCalled()
    const connected = { ...recipe, fracture: 'connected' as const }
    upload(connected, clouds, shell, solids, solidShell)
    upload(recipe, clouds, shell, solids)
    upload(connected, clouds, shell, solids, solidShell)
    expect(renderer.setVariantSolid).toHaveBeenCalledExactlyOnceWith(
      solids[0]!.key,
      solids[0]!.vertices,
    )
    expect(renderer.clearVariantSolids).toHaveBeenCalledOnce()
    expect(renderer.setVariantGlass).toHaveBeenCalledTimes(2)
    expect(renderer.setVariantGlass).toHaveBeenLastCalledWith(
      'lattice-court:solid',
      solidShell.vertices,
      solidShell.radius,
    )
  })

  it('reports a missing solid instead of hiding the captured rook', () => {
    const { upload } = setup()
    expect(() => {
      upload({ ...recipe, fracture: 'connected' }, clouds, shell)
    }).toThrow('connected solid')
  })

  it('releases all prior variant uploads when collection or quality sampling changes', () => {
    const { renderer, upload } = setup()
    upload({ ...recipe, fracture: 'connected' }, clouds, shell, solids)
    upload(
      {
        ...recipe,
        nativeCollection: { ...recipe.nativeCollection, id: 'wild-canopy' },
      },
      [...clouds],
      shell,
    )
    expect(renderer.clearVariantClouds).toHaveBeenCalledTimes(2)
    expect(renderer.clearVariantGlass).toHaveBeenCalledTimes(2)
    expect(renderer.clearVariantSolids).toHaveBeenCalledTimes(2)
    upload({ ...recipe, fracture: 'connected' }, clouds, shell, solids)
    expect(renderer.setVariantSolid).toHaveBeenCalledTimes(2)
  })
})
