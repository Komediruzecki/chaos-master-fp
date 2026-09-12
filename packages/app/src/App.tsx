import { batch, createEffect, createResource, createSignal, ErrorBoundary, lazy, onCleanup, onMount, Show, Suspense, } from 'solid-js'
import { ArcadeHub } from './components/Arcade/ArcadeHub'
import { AppCrashed, WebgpuNotSupported, } from './components/ErrorHandling/ErrorHandling'
import { HomeTab } from './components/Home/HomeTab'
import { Modal } from './components/Modal/Modal'
import { NativeSaveToasts } from './components/NativeSaveToasts/NativeSaveToasts'
import { HomeShellBar } from './components/Shell/HomeShellBar'
import { ToastHost } from './components/Toast/Toast'
import { WelcomeScreen } from './components/WelcomeScreen/WelcomeScreen'
import { WorkspaceSkeleton } from './components/WorkspaceSkeleton'
import { CompactModeProvider } from './contexts/CompactModeContext'
import { KeyframeTargetProvider } from './contexts/KeyframeTargetContext'
import { createSpotlightTourState, SpotlightTourContext, } from './contexts/SpotlightTourContext'
import { ThemeContextProvider } from './contexts/ThemeContext'
import { ToastProvider, useToast } from './contexts/ToastContext'
import { IS_DEV } from './defaults'
import { initAncestry } from './flame/ancestry'
import { importSharedVariations, loadCustomVariations, remapFlameCustomVariations, } from './flame/variations/custom'
import { activeTab, arcadeMode, setActiveTab, tabFromHash, } from './lib/activeTab'
import { createBackLayer } from './lib/backStack'
import { takeDraftForLaunch } from './lib/draft'
import { IS_NATIVE } from './lib/platform'
import { Root } from './lib/Root'
import { createWorkspaceHandoff } from './lib/workspaceHandoff'

const MainWorkspace = lazy(() =>
  import('./MainWorkspace').then((m) => ({ default: m.MainWorkspace })),
)
import { getTour } from './tours/registry'
import { isBenchmarkAuto, isBenchmarkRequested } from './utils/benchmarkRequest'
import { decodeSharePayload, decodeVariationShare, } from './utils/jsonQueryParam'
import { persistentSignal } from './utils/persistentSignal'
import { recordKeys } from './utils/record'
import { dismissWelcome, hasWelcomeBeenDismissed, } from './utils/welcomeDismissed'
import type { HardwareTier } from './utils/hardwareTier'

export type { ExportImageInfo, ExportImageType } from './flame/exportImageType'

/** Shows a message once it is set. Lives inside the ToastProvider, which is
 *  why it is a component rather than a call in Wrappers' body. */
function MessageToast(props: { message: string | null }) {
  const { showToast } = useToast()
  createEffect(() => {
    if (props.message) {
      showToast(props.message)
    }
  })
  return null
}

/**
 * What the launch says about the flame it just put back.
 *
 * The plain notice is only true once the work is also in Recents. When it is
 * not, the flame is in this session and in the draft slot and nowhere else,
 * so the notice says so and points at the one action that fixes it - the
 * user's own save, which is also the only thing allowed to decide that an
 * older flame may be replaced.
 */
const NOTICE = {
  secured: 'Restored your last flame',
  full: 'Restored your last flame. Recents is full, so save it for later to keep it.',
  refused:
    'Restored your last flame. It could not be added to Recents, so save it for later to keep it.',
} as const

export function Wrappers() {
  // Load persisted ancestry data from IndexedDB on startup.
  onMount(() => {
    void initAncestry()
  })

  // `?benchmark` (or `?benchmark=1`) is the "request benchmark" entry point:
  // skip the welcome screen and open the benchmark dialog straight away.
  // `?benchmark=auto` additionally starts the run on load.
  const benchmarkRequested = isBenchmarkRequested(window.location.search)
  const benchmarkAuto = isBenchmarkAuto(window.location.search)
  // Local/dev escape hatch (e.g. driving the app with Playwright): skip the
  // welcome screen — and with it the on-startup hardware-tier detection, which
  // lives inside WelcomeScreen. Off in production builds (env unset → false).
  const skipWelcome = import.meta.env.VITE_SKIP_WELCOME === 'true'
  const [showWelcome, setShowWelcome] = createSignal(
    !hasWelcomeBeenDismissed() && !benchmarkRequested && !skipWelcome,
  )
  const [dontShowAgain, setDontShowAgain] = persistentSignal(
    'dontShowWelcome',
    false,
  )
  const [hardwareTier, setHardwareTier] = persistentSignal<HardwareTier | null>(
    'hardwareTier',
    null,
  )
  const [queryError, setQueryError] = createSignal<string | null>(null)
  const [draftNotice, setDraftNotice] = createSignal<string | null>(null)

  /**
   * Everything the workspace is seeded with, in one place: the flame, the
   * tracks and the timeline it arrives with, and the capability a Home card
   * asked to open with it (lib/workspaceHandoff.ts). MainWorkspace reads
   * them in one effect and clears the lot.
   */
  const handoff = createWorkspaceHandoff({
    enterWorkspace: () => {
      setActiveTab('workspace')
    },
  })
  const seedWorkspace = handoff.seed

  /**
   * What the app was holding when the OS killed it (lib/draft.ts). The
   * welcome screen does not skip it: it shows on every launch until the user
   * ticks "Don't show again", and the workspace is mounted behind it, so the
   * flame is already there once they enter. A link that carries its own flame
   * is restored over nothing - the draft is left where it is and offered
   * again next launch.
   *
   * `takeDraftForLaunch` has already put the work in Recents by the time this
   * runs, so from here the hand-off is an ordinary one: whatever the user
   * does next - taps a starter flame, opens Library, leaves - the work is
   * safe and this screen is the only thing that has to happen at the right
   * moment.
   *
   * The entry the rescue wrote travels with the flame so the workspace
   * carries on in it rather than filing the same work twice. It is handed
   * over only when the rescue actually wrote it, and with a fingerprint of
   * what was written, because adopting a bare id let the first autosave
   * overwrite an entry the rescue had decided not to write to (lib/draft.ts).
   */
  onMount(() => {
    const draft = takeDraftForLaunch({
      native: IS_NATIVE,
      search: window.location.search,
    })
    if (!draft) return
    seedWorkspace({
      flame: draft.flame,
      ...(draft.tracks ? { tracks: draft.tracks } : {}),
      ...(draft.config ? { config: draft.config } : {}),
      ...(draft.entry ? { restoredEntry: draft.entry } : {}),
    })
    setDraftNotice(NOTICE[draft.unsecured ?? 'secured'])
  })

  const [flameFromQuery] = createResource(async () => {
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
          // Load the saved library first so collision detection sees it.
          loadCustomVariations()
          const imported = importSharedVariations(result.customVariations)
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
    const cv = new URLSearchParams(window.location.search).get('cv')
    if (cv === null) return undefined
    try {
      const def = await decodeVariationShare(cv)
      loadCustomVariations()
      const result = importSharedVariations([def])
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

  const spotlightState = createSpotlightTourState(getTour)

  // Auto-dismiss welcome screen when a query flame or shared variation is present
  createEffect(() => {
    const fq = flameFromQuery()
    if (fq?.flame || sharedVariationFromQuery()) {
      setShowWelcome(false)
    }
  })

  // Support #tour=app|sidebar|timeline and #arcade hash URLs
  createEffect(() => {
    const handleHashChange = () => {
      const fragment = window.location.hash
      // `lumenapeiron.com/arcade` redirects here. Landing a judge on the
      // generic welcome screen instead of the hub loses them: neither
      // "Browse gallery" nor picking a flame ever comes back to the Arcade.
      if (tabFromHash(fragment) === 'arcade') {
        setShowWelcome(false)
      }
      const match = /#tour=([a-zA-Z0-9_-]+)/.exec(fragment)
      if (match) {
        const tourId = match[1]!
        setShowWelcome(false)
        spotlightState.startTour(tourId)
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    onCleanup(() => {
      window.removeEventListener('hashchange', handleHashChange)
    })

    // Check initial hash on mount
    handleHashChange()
  })

  // Log what gets passed to App
  createEffect(() => {
    const fq = flameFromQuery()
    if (fq !== undefined) {
      if (IS_DEV) {
        console.info('[share:wrappers] passing to App:', {
          hasFlame: !!fq.flame,
          transformCount: fq.flame
            ? recordKeys(fq.flame.transforms ?? {}).length
            : 0,
          hasAnimation: !!fq.animation,
          animTrackCount: fq.animation?.tracks?.length ?? 0,
        })
      }
    }
  })

  // Home and the Arcade are destinations over the editor, so back returns to
  // Create before the app minimises (lib/backStack.ts). Escape keeps its own
  // path through installHomeEscapeBoundary: two keys, one result.
  createBackLayer(
    () => activeTab() === 'home' && !showWelcome(),
    () => {
      setActiveTab('workspace')
    },
    'home',
  )

  createBackLayer(
    () => activeTab() === 'arcade',
    () => {
      setActiveTab('workspace')
    },
    'arcade',
  )

  function handleStartTour(tourId: string) {
    setShowWelcome(false)
    spotlightState.startTour(tourId)
  }

  const errorHandler = (err: unknown, _: () => void) => {
    if (err instanceof Error) {
      if (err.cause === 'WebGPU') {
        return <WebgpuNotSupported />
      }
    }
    console.error(err)
    return <AppCrashed />
  }

  return (
    <CompactModeProvider>
      <SpotlightTourContext.Provider value={spotlightState}>
        <ThemeContextProvider>
          <KeyframeTargetProvider>
            <ToastProvider>
              <NativeSaveToasts />
              {/* Outside the Suspense below on purpose: an effect inside a
                  suspended boundary does not run until the boundary resolves,
                  so this notice waited on the workspace chunk and on the
                  share-link resource - while the one moment it is needed is
                  the moment the launch restores something, with the welcome
                  grid still up and a starter flame one tap away. The toast
                  column sits above the welcome screen's own layer. */}
              <MessageToast message={draftNotice()} />
              <Root
                adapterOptions={{
                  powerPreference: 'high-performance',
                }}
              >
                <Modal>
                  <ErrorBoundary fallback={errorHandler}>
                    <Suspense fallback={<WorkspaceSkeleton />}>
                      <MessageToast message={queryError()} />
                      <MainWorkspace
                        flameFromQuery={flameFromQuery()}
                        sharedVariationFromQuery={sharedVariationFromQuery()}
                        flameFromWelcome={handoff.flame}
                        welcomeTracks={handoff.tracks}
                        welcomeConfig={handoff.config}
                        capabilityFromHome={handoff.capability}
                        restoredEntryFromLaunch={handoff.restoredEntry}
                        autoOpenBenchmark={benchmarkRequested}
                        autoStartBenchmark={benchmarkAuto}
                        hardwareTier={
                          // When the welcome screen is skipped, detection never
                          // runs — fall back to a sane tier so quality is set.
                          hardwareTier() ?? (skipWelcome ? 'high' : null)
                        }
                        onHardwareTierChange={setHardwareTier}
                        resetFlameFromWelcome={() => {
                          seedWorkspace()
                        }}
                      />
                      {/* Home overlays the workspace, which stays mounted so
                          the editor keeps its state and its canvas size. It is
                          suppressed while the welcome screen is up so first-run
                          still has a single entry point. */}
                      <Show when={activeTab() === 'home' && !showWelcome()}>
                        <HomeTab
                          onOpenFlame={(flame, tracks, capability) => {
                            seedWorkspace({
                              flame,
                              ...(tracks ? { tracks } : {}),
                              ...(capability !== undefined
                                ? { capability }
                                : {}),
                              enterWorkspace: true,
                            })
                          }}
                        />
                        {/* Touch has no FloatingActions, so this is the way
                            back to the editor besides back and Escape. */}
                        <HomeShellBar />
                      </Show>
                      {/* The Arcade overlays the workspace the same way Home
                          does: the editor stays mounted underneath so a lesson
                          starts on the flame you were already looking at. */}
                      <Show when={activeTab() === 'arcade' && !showWelcome()}>
                        <ArcadeHub
                          initialMode={arcadeMode()}
                          onBackToEditor={() => {
                            setActiveTab('workspace')
                          }}
                        />
                      </Show>
                    </Suspense>
                    <Show when={showWelcome()}>
                      <WelcomeScreen
                        showDontShowAgain={dontShowAgain()}
                        onDontShowAgainChange={(checked) => {
                          setDontShowAgain(checked)
                          if (checked) {
                            dismissWelcome()
                          }
                        }}
                        onEnter={() => setShowWelcome(false)}
                        onBrowseGallery={() => {
                          // Both flips are required: Home is suppressed while
                          // the welcome screen is showing (see the Show above),
                          // so dismissing without switching lands in the editor
                          // and switching without dismissing shows nothing.
                          batch(() => {
                            setActiveTab('home')
                            setShowWelcome(false)
                          })
                        }}
                        onSelectFlame={(flame, tracks) => {
                          seedWorkspace({
                            flame,
                            ...(tracks ? { tracks } : {}),
                            enterWorkspace: true,
                          })
                        }}
                        onStartTour={handleStartTour}
                        onShowAbout={() => {
                          setShowWelcome(false)
                          // Trigger the floating version pill to open About
                          requestAnimationFrame(() => {
                            const pill =
                              document.querySelector<HTMLButtonElement>(
                                '[class*="about-pill"]',
                              )
                            pill?.click()
                          })
                        }}
                        hardwareTier={hardwareTier()}
                        onHardwareTierChange={setHardwareTier}
                      />
                    </Show>
                  </ErrorBoundary>
                </Modal>
              </Root>
              <ToastHost />
            </ToastProvider>
          </KeyframeTargetProvider>
        </ThemeContextProvider>
      </SpotlightTourContext.Provider>
    </CompactModeProvider>
  )
}
