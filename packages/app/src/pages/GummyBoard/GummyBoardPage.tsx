/** A repeatable rook strike on a gummy pawn, with shared material presets and canvas recording. */
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { GummyBoardScene } from '@/components/GummyBoard/GummyBoardScene'
import { Pause, PlayPause, Reset } from '@/icons'
import { DEFAULT_GUMMY_PARTICLE_TUNING } from '@/simulation/gummy/gummyParticleTuning'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { GummyErrorNotice } from '../GummyBear/GummyErrorNotice'
import { GummyPresetControls } from '../GummyBear/GummyPresetControls'
import { createGummyPreset } from '../GummyBear/gummyPresets'
import { GummyRecordingControls } from '../GummyBear/GummyRecordingControls'
import { GummyTuningControls } from '../GummyBear/GummyTuningControls'
import { useGummyRecording } from '../GummyBear/useGummyRecording'
import { GUMMY_BOARD_PALETTES, loadGummyBoardAppearance, saveGummyBoardAppearance, } from './gummyBoardAppearance'
import { GummyBoardAppearanceControls } from './GummyBoardAppearanceControls'
import styles from './GummyBoardPage.module.css'
import type { GummyPresetSettings } from '../GummyBear/gummyPresets'
import type { GummyBoardAppearance } from './gummyBoardAppearance'
import type { GummyBoardPhase } from '@/components/GummyBoard/gummyBoardChoreography'

const PHASE_LABELS: Record<GummyBoardPhase, string> = {
  ready: 'Ready to crash',
  lifting: 'Lifting the rook',
  aiming: 'Lining up the strike',
  crushing: 'Crushing the pawn',
  releasing: 'Settling onto the square',
  settling: 'Letting the jelly settle',
  complete: 'Capture complete',
}

export function GummyBoardPage() {
  const initial = GUMMY_BUILTIN_PRESETS.find((item) => item.id === 'rockgummy')!
  const [settings, setSettings] = createSignal(
    createGummyPreset(initial.preset.name, initial.preset.settings).settings,
  )
  const savedAppearance = loadGummyBoardAppearance()
  const [appearance, setAppearance] = createSignal(savedAppearance.appearance)
  const [appearanceError, setAppearanceError] = createSignal(
    savedAppearance.error,
  )
  const [selectedPieceId, setSelectedPieceId] = createSignal<number>()
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [paused, setPaused] = createSignal(false)
  const [phase, setPhase] = createSignal<GummyBoardPhase>('ready')
  const [resetKey, setResetKey] = createSignal(0)
  const [crashKey, setCrashKey] = createSignal(0)
  const [resetViewKey, setResetViewKey] = createSignal(0)
  const [view, setView] = createSignal<'board' | 'close'>('board')
  const [mode, setMode] = createSignal<'drag' | 'orbit' | 'pan'>('orbit')
  const [collisionMode, setCollisionMode] = createSignal<'soft' | 'driven'>(
    'driven',
  )
  const [impact, setImpact] = createSignal(1)
  const recording = useGummyRecording()
  let canvasSlot: HTMLDivElement | undefined
  const unavailable = createMemo(() => !ready() || !!error())
  const warm = createMemo(() => settings().particleMaterial === 'warm')
  const softContact = createMemo(() => collisionMode() === 'soft')
  const status = createMemo(() => {
    if (error()) return 'The simulation stopped'
    if (!ready()) return 'Preparing the board…'
    if (paused()) return 'Paused'
    return PHASE_LABELS[phase()]
  })

  onMount(() => {
    const previous = document.title
    document.title = 'Gummy chess | Lumen Apeiron'
    onCleanup(() => {
      document.title = previous
    })
  })

  function updateSettings(patch: Partial<GummyPresetSettings>) {
    setSettings((current) => ({ ...current, ...patch }))
  }

  function resetBoard() {
    batch(() => {
      setResetKey((key) => key + 1)
      setPaused(false)
      setMode('orbit')
      setPhase('ready')
      setError(undefined)
    })
  }

  function playCrash() {
    if (unavailable()) return
    batch(() => {
      setCrashKey((key) => key + 1)
      setPaused(false)
      setPhase('lifting')
    })
  }

  function applyPreset(next: GummyPresetSettings) {
    recording.stop('Recording finished because the material changed.')
    batch(() => {
      setSettings(createGummyPreset('Board material', next).settings)
      resetBoard()
    })
  }

  function setPinnedFeet(value: boolean) {
    batch(() => {
      updateSettings({ pinnedFeet: value })
      resetBoard()
    })
  }

  function setMaterial(value: 'warm' | 'elastic') {
    if (settings().particleMaterial === value) return
    batch(() => {
      updateSettings({ particleMaterial: value })
      resetBoard()
    })
  }

  function changeCollisionMode(value: 'soft' | 'driven') {
    if (collisionMode() === value) return
    recording.stop('Recording finished because the collision model changed.')
    batch(() => {
      setCollisionMode(value)
      resetBoard()
    })
  }

  function updateAppearance(patch: Partial<GummyBoardAppearance>) {
    const next = { ...appearance(), ...patch }
    const qualityChanged = next.quality !== appearance().quality
    if (qualityChanged)
      recording.stop('Recording finished because render quality changed.')
    batch(() => {
      setAppearance(next)
      if (qualityChanged) resetBoard()
    })
    try {
      saveGummyBoardAppearance(next)
      setAppearanceError(undefined)
    } catch {
      setAppearanceError(
        'Changes apply here, but this browser could not save board appearance.',
      )
    }
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <nav aria-label="Other studies">
          <a href="/gummy?experiment=mpm">Gummy workbench</a>
          <a href="/chess">Glass chess</a>
        </nav>
      </header>
      <div class={styles.layout}>
        <section
          class={styles.studio}
          aria-label="Gummy chess studio"
          data-ready={ready()}
        >
          <div class={styles.studioHeader}>
            <span>Gummy chess</span>
            <span>32 pieces · 6 shapes</span>
          </div>
          <div class={styles.canvasSlot} ref={canvasSlot}>
            <GummyBoardScene
              settings={settings()}
              paused={paused()}
              resetKey={resetKey()}
              crashKey={crashKey()}
              resetViewKey={resetViewKey()}
              view={view()}
              mode={mode()}
              collisionMode={collisionMode()}
              impact={impact()}
              recording={recording.busy()}
              selectedPieceId={selectedPieceId()}
              onSelectPiece={setSelectedPieceId}
              paletteOverrides={appearance().paletteOverrides}
              pieceScale={appearance().pieceScale}
              quality={appearance().quality}
              onReady={(value) => {
                if (!value)
                  recording.stop(
                    'Recording finished because the scene changed.',
                  )
                setReady(value)
              }}
              onError={(value) => {
                if (value) recording.stop()
                setError(value)
              }}
              onPhase={setPhase}
              onPauseChange={setPaused}
              onReplay={playCrash}
              onReset={resetBoard}
            />
            <Show when={error()} keyed>
              {(message) => <GummyErrorNotice message={message} />}
            </Show>
          </div>
          <div class={styles.studioFooter}>
            <div class={styles.actions} data-testid="gummy-board-actions">
              <button
                type="button"
                class={styles.primary}
                disabled={unavailable()}
                onClick={playCrash}
              >
                <PlayPause aria-hidden="true" />
                {crashKey() > 0 ? 'Replay crash' : 'Play crash'}
              </button>
              <button
                type="button"
                class={styles.button}
                disabled={unavailable()}
                aria-pressed={paused()}
                onClick={() => setPaused((value) => !value)}
              >
                {paused() ? (
                  <PlayPause aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
                {paused() ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                class={styles.button}
                disabled={!ready() && !error()}
                onClick={resetBoard}
              >
                <Reset aria-hidden="true" />
                Reset board
              </button>
            </div>
            <div class={styles.caption}>
              <p role="status" aria-label="Board status" aria-live="polite">
                {status()}
              </p>
              <button
                class={styles.textButton}
                type="button"
                disabled={unavailable()}
                onClick={() => setResetViewKey((key) => key + 1)}
              >
                Reset view
              </button>
            </div>
          </div>
        </section>

        <aside class={styles.controls} aria-label="Gummy board controls">
          <p class={styles.eyebrow}>Collision study</p>
          <h1>Rook meets pawn.</h1>
          <p class={styles.intro}>
            {softContact()
              ? 'Both pieces deform. The rook follows the strike and keeps the captured square.'
              : 'The rook follows a fixed strike. The pawn deforms with your material settings.'}
          </p>
          <GummyRecordingControls
            recording={recording}
            ready={!unavailable()}
            onStart={() => {
              recording.start(canvasSlot?.querySelector('canvas'))
            }}
          />
          <GummyPresetControls
            current={settings()}
            onApply={applyPreset}
            disabled={unavailable()}
          />

          <GummyBoardAppearanceControls
            appearance={appearance()}
            selectedPieceId={selectedPieceId()}
            basePalette={settings().palette}
            disabled={unavailable()}
            storageError={appearanceError()}
            onSelectPiece={setSelectedPieceId}
            onChange={updateAppearance}
          />
          <p class={styles.setupHelp}>
            Play stages the rook and pawn in the centre. Reset board restores
            the opening arrangement.
          </p>

          <fieldset class={styles.fieldset} disabled={unavailable()}>
            <legend>Camera &amp; touch</legend>
            <div class={styles.segments} role="group" aria-label="Camera view">
              <button
                type="button"
                aria-pressed={view() === 'board'}
                onClick={() => setView('board')}
              >
                Board view
              </button>
              <button
                type="button"
                aria-pressed={view() === 'close'}
                onClick={() => setView('close')}
              >
                Close view
              </button>
            </div>
            <div
              class={`${styles.segments} ${styles.three}`}
              role="group"
              aria-label="Pointer action"
            >
              <For
                each={[
                  { id: 'orbit' as const, label: 'Orbit' },
                  { id: 'pan' as const, label: 'Pan' },
                  { id: 'drag' as const, label: 'Grab pawn' },
                ]}
              >
                {(choice) => (
                  <button
                    type="button"
                    aria-pressed={mode() === choice.id}
                    onClick={() => setMode(choice.id)}
                  >
                    {choice.label}
                  </button>
                )}
              </For>
            </div>
            <p class={styles.help}>
              Drag to orbit or pan. Use two fingers to pan and pinch to zoom.
              Grab stages the rook and pawn in the centre for a manual test.
            </p>
          </fieldset>

          <fieldset class={styles.fieldset} disabled={unavailable()}>
            <legend>Strike</legend>
            <div
              class={styles.segments}
              role="group"
              aria-label="Collision model"
            >
              <button
                type="button"
                aria-pressed={softContact()}
                onClick={() => {
                  changeCollisionMode('soft')
                }}
              >
                Soft contact
              </button>
              <button
                type="button"
                aria-pressed={!softContact()}
                onClick={() => {
                  changeCollisionMode('driven')
                }}
              >
                Driven rook
              </button>
            </div>
            <p class={styles.collisionHelp}>
              Soft contact lets both pieces yield. Hot presets can tear the rook
              during the lift. Changing modes resets this take.
            </p>
            <label class={styles.sliderLabel} for="gummy-board-impact">
              Impact<output>{impact().toFixed(2)}×</output>
            </label>
            <input
              id="gummy-board-impact"
              class={styles.slider}
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={impact()}
              onInput={(event) => setImpact(Number(event.currentTarget.value))}
            />
            <p class={styles.help}>
              Changes the next rook strike. Replay to compare it with the same
              material.
            </p>
          </fieldset>

          <fieldset class={styles.fieldset} disabled={unavailable()}>
            <legend>
              {softContact() ? 'Piece material' : 'Pawn material'}
            </legend>
            <div
              class={styles.segments}
              role="group"
              aria-label="Particle material"
            >
              <button
                type="button"
                aria-pressed={warm()}
                onClick={() => {
                  setMaterial('warm')
                }}
              >
                Warm gummy
              </button>
              <button
                type="button"
                aria-pressed={!warm()}
                onClick={() => {
                  setMaterial('elastic')
                }}
              >
                Elastic jelly
              </button>
            </div>
            <label class={styles.sliderLabel} for="gummy-board-softness">
              Softness<output>{Math.round(settings().softness * 100)}%</output>
            </label>
            <input
              id="gummy-board-softness"
              class={styles.slider}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings().softness}
              onInput={(event) => {
                updateSettings({ softness: Number(event.currentTarget.value) })
              }}
            />
            <label class={styles.sliderLabel} for="gummy-board-fragility">
              Fragility
              <output>{Math.round(settings().fragility * 100)}%</output>
            </label>
            <input
              id="gummy-board-fragility"
              class={styles.slider}
              type="range"
              min="0"
              max="100"
              step="1"
              value={settings().fragility * 100}
              onInput={(event) => {
                updateSettings({
                  fragility: Number(event.currentTarget.value) / 100,
                })
              }}
            />
            <label class={styles.check}>
              <input
                type="checkbox"
                checked={settings().tearing}
                onChange={(event) => {
                  updateSettings({ tearing: event.currentTarget.checked })
                }}
              />
              Allow tearing
            </label>
            <label class={styles.check}>
              <input
                type="checkbox"
                checked={settings().caustics}
                onChange={(event) => {
                  updateSettings({ caustics: event.currentTarget.checked })
                }}
              />
              Floor caustics
            </label>
            <label class={styles.selectLabel} for="gummy-board-palette">
              Base palette
            </label>
            <select
              id="gummy-board-palette"
              class={styles.select}
              value={settings().palette}
              onChange={(event) => {
                updateSettings({
                  palette: event.currentTarget
                    .value as GummyPresetSettings['palette'],
                })
              }}
            >
              <For each={GUMMY_BOARD_PALETTES}>
                {([value, name]) => <option value={value}>{name}</option>}
              </For>
            </select>
          </fieldset>

          <GummyTuningControls
            tuning={settings().tuning}
            onTuningChange={(patch) =>
              setSettings((current) => ({
                ...current,
                tuning: { ...current.tuning, ...patch },
              }))
            }
            grabRadius={settings().grabRadius}
            onGrabRadius={(value) => {
              updateSettings({ grabRadius: value })
            }}
            maxPull={settings().maxPull}
            onMaxPull={(value) => {
              updateSettings({ maxPull: value })
            }}
            pinnedFeet={settings().pinnedFeet}
            onPinnedFeet={setPinnedFeet}
            warm={warm()}
            bear
            chessPiece
            disabled={unavailable()}
            onReset={() => {
              updateSettings({
                tuning: { ...DEFAULT_GUMMY_PARTICLE_TUNING },
                grabRadius: warm() ? 0.22 : 0.28,
                maxPull: 1.8,
              })
            }}
          />
          <p class={styles.help}>
            Pin base holds the pawn to its square. The rook is guided through
            the strike.
          </p>
          <p class={styles.note}>
            All six chess shapes, ready for material studies and recorded
            captures. Chess turns and rules come later.
          </p>
        </aside>
      </div>
    </main>
  )
}
