/** Accept a bounded collection-preview handoff without replacing a saved legal game. */
import { validateNativeChessCollectionSelection } from './gummyMatchAppearance'

export function nativeMatchSelectionFromSearch(search: string) {
  const params = new URLSearchParams(search)
  if (!params.has('collection')) return undefined
  try {
    return validateNativeChessCollectionSelection({
      version: 1,
      id: params.get('collection'),
      enclosure: params.get('enclosure') ?? 'pure',
    })
  } catch {
    return undefined
  }
}

/** Consume only the handoff; later reloads retain the player's new comparison choice. */
export function consumeNativeMatchSelection() {
  const selection = nativeMatchSelectionFromSearch(window.location.search)
  if (!selection) return undefined
  const url = new URL(window.location.href)
  url.searchParams.delete('collection')
  url.searchParams.delete('enclosure')
  try {
    window.history.replaceState(window.history.state, '', url)
  } catch {
    // Restricted embedding can block URL changes while allowing the match to play.
  }
  return selection
}
