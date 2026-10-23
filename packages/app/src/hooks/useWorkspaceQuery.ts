/** Loads editor startup documents, with an inspection return taking precedence over stale share links. */
import { createResource } from 'solid-js'
import { IS_DEV } from '@/defaults'
import { loadChessEditorReturn } from '@/flame/chess/chessEditorReturn'
import { loadAndImportSharedVariations, remapFlameCustomVariations, } from '@/flame/variations/custom'
import { decodeSharePayload, decodeVariationShare, } from '@/utils/jsonQueryParam'
import { recordKeys } from '@/utils/record'

export function useWorkspaceQuery(
  returningFromChess: boolean,
  setQueryError: (message: string) => void,
) {
  const [flameFromQuery] = createResource(async () => {
    if (returningFromChess) {
      try {
        return loadChessEditorReturn(window.location.search)
      } catch (error) {
        setQueryError(
          error instanceof Error
            ? error.message
            : 'The editor document could not be reopened. Its saved data has been kept.',
        )
        return undefined
      }
    }
    const urlParams = new URLSearchParams(window.location.search)
    const shortId = urlParams.get('s')
    let flameDef = urlParams.get('flame')

    if (shortId) {
      try {
        const res = await fetch(`/api/shorten/${shortId}`)
        if (res.ok) {
          const json = await res.json()
          if (json.payload) {
            flameDef = json.payload
          }
        } else {
          setQueryError('The shared link could not be found or has expired.')
          console.error('Failed to fetch short URL payload', await res.text())
        }
      } catch (err) {
        setQueryError('Failed to fetch the shared link. Network error.')
        console.error('Error fetching short URL:', err)
      }
    }

    if (flameDef !== null) {
      try {
        const result = await decodeSharePayload(flameDef)
        if (IS_DEV) {
          console.info('[share:resource] decode succeeded:', {
            hasFlame: !!result?.flame,
            transformCount: result?.flame
              ? recordKeys(result.flame.transforms ?? {}).length
              : 0,
            hasAnimation: !!result?.animation,
            animTrackCount: result?.animation?.tracks?.length ?? 0,
            customVariationCount: result?.customVariations?.length ?? 0,
          })
        }
        // Re-validate and register any custom variations embedded in the link.
        // Untrusted input: importSharedVariations recompiles each through the
        // allowlist compiler and registers them transiently (not saved) — the
        // recipient is asked to save them via the consent prompt downstream.
        if (result.customVariations && result.customVariations.length > 0) {
          // Loads the saved library first so collision detection sees it.
          const imported = loadAndImportSharedVariations(
            result.customVariations,
          )
          const flame = remapFlameCustomVariations(result.flame, imported.remap)
          if (imported.rejected.length > 0) {
            const n = imported.rejected.length
            setQueryError(
              `${n} custom variation${n === 1 ? '' : 's'} in this link could not be loaded and ${n === 1 ? 'was' : 'were'} skipped.`,
            )
            console.warn(
              'Rejected shared custom variations:',
              imported.rejected,
            )
          }
          return {
            ...result,
            flame,
            importedCustomVariations: imported.imported,
            alreadyOwnedCustomVariations: imported.alreadyOwned,
          }
        }
        return result
      } catch (err) {
        setQueryError(
          'Failed to decode the shared fractal. The link may be malformed or corrupted.',
        )
        console.error('Failed to decode share payload:', err)
      }
    }
    return undefined
  })

  // A single custom variation shared via `?cv=`. Decoded, re-validated through
  // the allowlist compiler, and transiently registered so MainWorkspace can
  // preview it and offer to save. Untrusted: importSharedVariations never trusts
  // the payload's claims.
  const [sharedVariationFromQuery] = createResource(async () => {
    if (returningFromChess) return undefined
    const cv = new URLSearchParams(window.location.search).get('cv')
    if (cv === null) return undefined
    try {
      const def = await decodeVariationShare(cv)
      const result = loadAndImportSharedVariations([def])
      if (result.alreadyOwned.length > 0) {
        return { def: result.alreadyOwned[0]!, alreadyOwned: true }
      }
      if (result.imported.length > 0) {
        return { def: result.imported[0]!, alreadyOwned: false }
      }
      setQueryError('The shared variation could not be loaded.')
      console.warn('Rejected shared variation:', result.rejected)
      return undefined
    } catch (err) {
      setQueryError('Failed to decode the shared variation.')
      console.error('Failed to decode shared variation:', err)
      return undefined
    }
  })

  return { flameFromQuery, sharedVariationFromQuery }
}
