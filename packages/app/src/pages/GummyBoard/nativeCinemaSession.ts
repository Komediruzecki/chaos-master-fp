/** A bounded, reloadable native shot handoff stays separate from gummy recipes and match history. */
import { parseNativeCinemaRecipe } from './nativeCinemaRecipe'
import type { NativeCinemaRecipe } from './nativeCinemaRecipe'

export const NATIVE_CINEMA_KEY = 'native-chess-cinema-v1'
type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

export function saveNativeCinemaRecipe(
  recipe: NativeCinemaRecipe,
  storage?: SessionStorage,
) {
  const validated = parseNativeCinemaRecipe(recipe)
  ;(storage ?? globalThis.sessionStorage).setItem(
    NATIVE_CINEMA_KEY,
    JSON.stringify(validated),
  )
}

export function readNativeCinemaRecipe(storage?: SessionStorage): {
  recipe?: NativeCinemaRecipe
  error?: string
} {
  try {
    const json = (storage ?? globalThis.sessionStorage).getItem(
      NATIVE_CINEMA_KEY,
    )
    if (!json) throw new Error('The match shot is missing.')
    return { recipe: parseNativeCinemaRecipe(json) }
  } catch {
    return {
      error:
        'The fractal shot could not be opened. Return to the match and choose the capture again.',
    }
  }
}
