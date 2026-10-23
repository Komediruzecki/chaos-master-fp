/** Owned state and reset transitions for the gummy material workbench. */
import { batch, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { isGummyChessMould } from '@/simulation/gummy/gummyChessMoulds'
import { GUMMY_JELLY_DEFAULT_FRAGILITY } from '@/simulation/gummy/gummyJellyFracture'
import { DEFAULT_GUMMY_PARTICLE_TUNING } from '@/simulation/gummy/gummyParticleTuning'
import { gummyBenchHint, gummyBenchStatus } from './gummyBenchCopy'
import { useGummyRecording } from './useGummyRecording'
import type { GummyBenchModel } from './gummyBenchCopy'
import type { GummyPresetSettings } from './gummyPresets'
import type { GummyExperiment, GummyGeometry, GummyInteraction, GummyPalette, GummyStudyStatus, GummySurface, } from '@/components/GummyBear/GummyBearScene'
import type { GummyJellyProtocol } from '@/components/GummyBear/gummyStudyMath'
import type { GummyParticleFixture } from '@/simulation/gummy/gummyParticleFixtures'
import type { GummyParticleTuning } from '@/simulation/gummy/gummyParticleTuning'

function initialModel(): GummyBenchModel {
  const query = new URLSearchParams(window.location.search).get('experiment')
  return query === 'particle' ||
    query === 'mpm' ||
    query === 'pull' ||
    query === 'crush'
    ? query
    : 'jelly'
}

function initialFixture(): GummyParticleFixture {
  const query = new URLSearchParams(window.location.search).get('shape') ?? ''
  return isGummyChessMould(query) || query === 'blobs' ? query : 'bear'
}

export function useGummyBench() {
  const [experiment, setExperiment] =
    createSignal<GummyBenchModel>(initialModel())
  const [protocol, setProtocol] = createSignal<GummyJellyProtocol>('tear')
  const [palette, setPalette] = createSignal<GummyPalette>('marble')
  const [mode, setMode] = createSignal<GummyInteraction>(
    experiment() === 'crush' ? 'orbit' : 'drag',
  )
  const [softness, setSoftness] = createSignal(0.55)
  const [fragility, setFragility] = createSignal(GUMMY_JELLY_DEFAULT_FRAGILITY)
  const [tearResponse, setTearResponse] = createSignal<'soft' | 'crumble'>(
    'soft',
  )
  const [geometry, setGeometry] = createSignal<GummyGeometry>('fine')
  const [surface, setSurface] = createSignal<GummySurface>('rounded')
  const [particleMaterial, setParticleMaterial] = createSignal<
    'warm' | 'elastic'
  >('warm')
  const [particleFixture, setParticleFixture] =
    createSignal<GummyParticleFixture>(initialFixture())
  const [caustics, setCaustics] = createSignal(true)
  const [pointerGuide, setPointerGuide] = createSignal(true)
  const [tuning, setTuning] = createSignal<GummyParticleTuning>({
    ...DEFAULT_GUMMY_PARTICLE_TUNING,
  })
  const [grabRadius, setGrabRadius] = createSignal(0.22)
  const [maxPull, setMaxPull] = createSignal(1.8)
  const [pinnedFeet, setPinnedFeet] = createSignal(true)
  const [tearing, setTearing] = createSignal(true)
  const [jellyTearing, setJellyTearing] = createSignal(true)
  const [paused, setPaused] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [demoKey, setDemoKey] = createSignal(0)
  const [resetKey, setResetKey] = createSignal(0)
  const [viewKey, setViewKey] = createSignal(0)
  const [status, setStatus] = createSignal<GummyStudyStatus>('loading')
  const [error, setError] = createSignal<string>()
  const [reducedMotion, setReducedMotion] = createSignal(false)
  const [compactControls, setCompactControls] = createSignal(false)
  const recording = useGummyRecording()
  const continuous = createMemo(() => experiment() === 'jelly')
  const particle = createMemo(
    () => experiment() === 'particle' || experiment() === 'mpm',
  )
  const chessPiece = createMemo(
    () => particle() && isGummyChessMould(particleFixture()),
  )
  const presetSettings = createMemo<GummyPresetSettings>(() => ({
    palette: palette(),
    particleMaterial: particleMaterial(),
    softness: softness(),
    fragility: fragility(),
    tearing: tearing(),
    tuning: tuning(),
    grabRadius: grabRadius(),
    maxPull: maxPull(),
    pinnedFeet: pinnedFeet(),
    caustics: caustics(),
  }))
  const reconstruction = createMemo(() =>
    experiment() === 'mpm'
      ? ('marching-cubes' as const)
      : experiment() === 'particle'
        ? ('screen-space' as const)
        : undefined,
  )
  const tearProtocol = createMemo(() => continuous() && protocol() === 'tear')
  const existingExperiment = createMemo<GummyExperiment>(() => {
    const value = experiment()
    return value === 'particle' || value === 'mpm' ? 'jelly' : value
  })
  const activeTearing = createMemo(() =>
    continuous() ? tearProtocol() && jellyTearing() : tearing(),
  )
  const statusText = createMemo(() =>
    gummyBenchStatus({
      error: error(),
      ready: ready(),
      paused: paused(),
      status: status(),
      experiment: experiment(),
      protocol: protocol(),
    }),
  )
  const actionName = createMemo(() =>
    particle()
      ? 'tear'
      : continuous()
        ? protocol()
        : experiment() === 'crush'
          ? 'crush'
          : 'pull',
  )
  const hint = createMemo(() =>
    gummyBenchHint({
      mode: mode(),
      experiment: experiment(),
      fixture: particleFixture(),
      pinnedFeet: pinnedFeet(),
      protocol: protocol(),
    }),
  )

  onMount(() => {
    const originalTitle = document.title
    document.title = 'Gummy Study · Lumen Apeiron'
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const compact = window.matchMedia('(max-width: 720px)')
    const update = () => setReducedMotion(preference.matches)
    const updateCompact = () => setCompactControls(compact.matches)
    update()
    updateCompact()
    preference.addEventListener('change', update)
    compact.addEventListener('change', updateCompact)
    onCleanup(() => {
      document.title = originalTitle
      preference.removeEventListener('change', update)
      compact.removeEventListener('change', updateCompact)
    })
  })

  function replay() {
    batch(() => {
      setPaused(false)
      setDemoKey((value) => value + 1)
    })
  }

  function reset() {
    batch(() => {
      setPaused(false)
      setError(undefined)
      setResetKey((value) => value + 1)
    })
  }

  function applyPreset(settings: GummyPresetSettings) {
    batch(() => {
      setPalette(settings.palette)
      setParticleMaterial(settings.particleMaterial)
      setSoftness(settings.softness)
      setFragility(settings.fragility)
      setTearing(settings.tearing)
      setTuning({ ...settings.tuning })
      setGrabRadius(settings.grabRadius)
      setMaxPull(settings.maxPull)
      setPinnedFeet(settings.pinnedFeet)
      setCaustics(settings.caustics)
      reset()
    })
  }

  function selectTearResponse(next: 'soft' | 'crumble') {
    if (next === tearResponse()) return
    batch(() => {
      setTearResponse(next)
      reset()
    })
  }

  function selectParticleMaterial(next: 'warm' | 'elastic') {
    if (next === particleMaterial()) return
    batch(() => {
      setParticleMaterial(next)
      setGrabRadius(next === 'warm' ? 0.22 : 0.28)
      reset()
    })
  }

  function selectPinnedFeet(next: boolean) {
    if (next === pinnedFeet()) return
    batch(() => {
      setError(undefined)
      setPaused(false)
      setPinnedFeet(next)
    })
  }

  function restoreTuning() {
    batch(() => {
      setTuning({ ...DEFAULT_GUMMY_PARTICLE_TUNING })
      setGrabRadius(particleMaterial() === 'warm' ? 0.22 : 0.28)
      setMaxPull(1.8)
    })
  }

  function selectParticleFixture(next: GummyParticleFixture) {
    if ((!ready() && !error()) || next === particleFixture()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setParticleFixture(next)
    })
    const url = new URL(window.location.href)
    url.searchParams.set('shape', next)
    window.history.replaceState(window.history.state, '', url)
  }

  function selectGeometry(next: GummyGeometry) {
    if ((!ready() && !error()) || next === geometry()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setGeometry(next)
    })
  }

  function selectExperiment(next: GummyBenchModel) {
    if (next === experiment()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setMode(
        next === 'pull' ||
          next === 'particle' ||
          next === 'mpm' ||
          (next === 'jelly' && protocol() === 'tear')
          ? 'drag'
          : 'orbit',
      )
      setExperiment(next)
    })
    const url = new URL(window.location.href)
    url.searchParams.set('experiment', next)
    window.history.replaceState(window.history.state, '', url)
  }

  function selectProtocol(next: GummyJellyProtocol) {
    if (next === protocol()) return
    batch(() => {
      setReady(false)
      setStatus('loading')
      setPaused(false)
      setError(undefined)
      setDemoKey(0)
      setResetKey(0)
      setMode(next === 'stretch' || next === 'tear' ? 'drag' : 'orbit')
      setProtocol(next)
    })
  }

  return {
    experiment,
    setExperiment,
    protocol,
    palette,
    setPalette,
    mode,
    setMode,
    softness,
    setSoftness,
    fragility,
    setFragility,
    tearResponse,
    geometry,
    surface,
    setSurface,
    particleMaterial,
    particleFixture,
    caustics,
    setCaustics,
    pointerGuide,
    setPointerGuide,
    tuning,
    setTuning,
    grabRadius,
    setGrabRadius,
    maxPull,
    setMaxPull,
    pinnedFeet,
    tearing,
    setTearing,
    jellyTearing,
    setJellyTearing,
    paused,
    setPaused,
    ready,
    setReady,
    demoKey,
    resetKey,
    viewKey,
    setViewKey,
    status,
    setStatus,
    error,
    setError,
    reducedMotion,
    compactControls,
    recording,
    continuous,
    particle,
    chessPiece,
    presetSettings,
    reconstruction,
    tearProtocol,
    existingExperiment,
    activeTearing,
    statusText,
    actionName,
    hint,
    replay,
    reset,
    applyPreset,
    selectTearResponse,
    selectParticleMaterial,
    selectPinnedFeet,
    restoreTuning,
    selectParticleFixture,
    selectGeometry,
    selectExperiment,
    selectProtocol,
  }
}

export type GummyBench = ReturnType<typeof useGummyBench>
