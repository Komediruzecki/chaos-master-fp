/** Shot studio with legal capture positions, portable recipes and repeatable camera playback. */
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { GUMMY_BOARD_SHOTS } from '@/components/GummyBoard/gummyBoardShots'
import { createGummyCaptureMechanic, gummyCaptureMechanicContext, } from '@/components/GummyBoard/gummyCaptureMechanics'
import { GummyCinemaScene } from '@/components/GummyBoard/GummyCinemaScene'
import { Check, Copy } from '@/icons'
import { GUMMY_BUILTIN_PRESETS } from '../GummyBear/gummyBuiltinPresets'
import { GummyPresetControls } from '../GummyBear/GummyPresetControls'
import { GummyRecordingControls } from '../GummyBear/GummyRecordingControls'
import { useGummyRecording } from '../GummyBear/useGummyRecording'
import { GUMMY_BOARD_PALETTES } from './gummyBoardAppearance'
import { updateGummyCinemaCaptureContext } from './gummyCinemaDraft'
import { GummyCinemaExport } from './GummyCinemaExport'
import { GummyCinemaMotionControls } from './GummyCinemaMotionControls'
import styles from './GummyCinemaPage.module.css'
import { createGummyCinemaRecipe, parseGummyCinemaRecipe, } from './gummyCinemaRecipe'
import { GummyCinemaSection } from './GummyCinemaSection'
import { readGummyMatchCinemaRecipe } from './gummyMatchSession'
import type { GummyCinemaRecipe } from './gummyCinemaRecipe'
import type { GummyBoardShot, GummyBoardShotMotion, } from '@/components/GummyBoard/gummyBoardShots'
import type { GummyCaptureMechanicId } from '@/components/GummyBoard/gummyCaptureMechanics'
import type { GummyCinemaController } from '@/components/GummyBoard/GummyCinemaScene'

export function GummyCinemaPage() {
  const params = new URLSearchParams(window.location.search)
  const handoff =
    params.get('from') === 'match' ? readGummyMatchCinemaRecipe() : undefined
  const initial =
    handoff?.recipe ??
    createGummyCinemaRecipe(
      GUMMY_BOARD_SHOTS.find((s) => s.id === params.get('shot')),
    )
  const [recipe, setRecipe] = createSignal(initial)
  const [draft, setDraft] = createSignal(initial)
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [time, setTime] = createSignal(0)
  const [error, setError] = createSignal<string | undefined>(handoff?.error)
  const [json, setJson] = createSignal('')
  const [copying, setCopying] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal('')
  const [copied, setCopied] = createSignal(false)
  const [exportBusy, setExportBusy] = createSignal(false)
  const [recordingStarting, setRecordingStarting] = createSignal(false)
  const [sections, setSections] = createSignal({
    examples: true,
    appearance: true,
    camera: false,
    motion: true,
    shear: false,
    position: false,
    recipe: false,
    videoExport: true,
  })
  const sectionProps = (key: keyof ReturnType<typeof sections>) => ({
    get open() {
      return sections()[key]
    },
    onToggle(open: boolean) {
      setSections((current) => ({ ...current, [key]: open }))
    },
  })
  let recipeText: HTMLTextAreaElement | undefined
  let disposed = false
  const [clean, setClean] = createSignal(params.get('clean') === '1')
  const [portrait, setPortrait] = createSignal(false)
  const recording = useGummyRecording()
  const busy = createMemo(
    () => recording.busy() || recordingStarting() || exportBusy(),
  )
  let controller: GummyCinemaController | undefined
  let canvasSlot: HTMLDivElement | undefined
  let api:
    | (GummyCinemaController & {
        configure(value: unknown): Promise<void>
        recipe(): GummyCinemaRecipe
      })
    | undefined
  let pendingReady:
    | {
        resolve: () => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  const unavailable = createMemo(() => !ready())

  function apply(value: unknown, configuring = false) {
    const next = parseGummyCinemaRecipe(value)
    if (pendingReady && !configuring) {
      clearTimeout(pendingReady.timer)
      pendingReady.reject(new Error('A newer shot replaced this request.'))
      pendingReady = undefined
    }
    recording.stop('Shot changed.')
    controller?.pause()
    setReady(false)
    setPlaying(false)
    setError(undefined)
    setTime(0)
    setDraft(next)
    setRecipe(next)
  }

  function guarded(action: () => void | Promise<void>) {
    try {
      void Promise.resolve(action()).catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function configure(value: unknown) {
    return new Promise<void>((resolve, reject) => {
      if (pendingReady) {
        clearTimeout(pendingReady.timer)
        pendingReady.reject(new Error('A newer shot replaced this request.'))
        pendingReady = undefined
      }
      try {
        const r = value as Partial<GummyCinemaRecipe>
        const next = parseGummyCinemaRecipe(
          r?.format ? value : createGummyCinemaRecipe(value as GummyBoardShot),
        )
        const timer = setTimeout(() => {
          pendingReady = undefined
          reject(new Error('Shot preparation timed out.'))
        }, 60000)
        pendingReady = { resolve, reject, timer }
        apply(next, true)
      } catch (e) {
        if (pendingReady) clearTimeout(pendingReady.timer)
        pendingReady = undefined
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  function receiveController(next: GummyCinemaController | undefined) {
    controller = next
    if (!next) {
      if (window.__gummyCinema === api) delete window.__gummyCinema
      return
    }
    api = { ...next, configure, recipe }
    if (import.meta.env.DEV) window.__gummyCinema = api
  }

  function receiveReady(value: boolean) {
    setReady(value)
    if (value && pendingReady) {
      clearTimeout(pendingReady.timer)
      pendingReady.resolve()
      pendingReady = undefined
    }
  }

  function receiveError(message: string) {
    setReady(false)
    setError(message)
    setPlaying(false)
    recording.stop('The GPU stopped this shot.')
    if (pendingReady) {
      clearTimeout(pendingReady.timer)
      pendingReady.reject(new Error(message))
      pendingReady = undefined
    }
  }

  function updateShot(
    key: 'fen' | 'from' | 'to' | 'boardTheme' | 'cameraStyle',
    value: string,
  ) {
    setDraft((r) =>
      key === 'fen' || key === 'from' || key === 'to'
        ? updateGummyCinemaCaptureContext(r, { [key]: value })
        : { ...r, shot: { ...r.shot, [key]: value } },
    )
  }

  function updateMotion(motion: Readonly<GummyBoardShotMotion>) {
    setDraft((r) => ({
      ...r,
      shot: { ...r.shot, mechanic: undefined, motion: { ...motion } },
    }))
  }

  function updateMechanic(id: GummyCaptureMechanicId) {
    try {
      const selection = createGummyCaptureMechanic(
        id,
        draft().shot.mechanic?.seed ?? 0,
        gummyCaptureMechanicContext(draft().shot, draft().scale),
      )
      setDraft((r) => ({ ...r, version: 3, shot: { ...r.shot, ...selection } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function showRecipe() {
    setJson(JSON.stringify(recipe(), null, 2))
    setCopyStatus('')
    setCopied(false)
  }

  async function copyRecipe() {
    const text = json() || JSON.stringify(recipe(), null, 2)
    setJson(text)
    setCopying(true)
    setCopied(false)
    setCopyStatus('')
    try {
      await globalThis.navigator.clipboard.writeText(text)
      if (!disposed) {
        setCopied(true)
        setCopyStatus('Recipe copied.')
      }
    } catch {
      if (disposed) return
      setCopyStatus(
        'Copy was blocked. The recipe is selected so you can copy it manually.',
      )
      recipeText?.focus()
      recipeText?.select()
    } finally {
      if (!disposed) setCopying(false)
    }
  }

  function reset() {
    recording.stop('Shot reset.')
    return controller?.resetPaused()
  }

  onCleanup(() => {
    disposed = true
    if (window.__gummyCinema === api) delete window.__gummyCinema
    if (pendingReady) {
      clearTimeout(pendingReady.timer)
      pendingReady.reject(new Error('Shot studio closed.'))
    }
  })

  return (
    <main class={styles.page} classList={{ [styles.clean!]: clean() }}>
      <div
        class={styles.stage}
        classList={{ [styles.portrait!]: portrait() }}
        ref={canvasSlot}
      >
        <Show when={recipe()} keyed>
          {(value) => (
            <GummyCinemaScene
              shot={value.shot}
              material={value.material}
              scale={value.scale}
              quality={value.quality}
              artStyle={value.artStyle}
              attackerPalette={value.attackerPalette}
              victimPalette={value.victimPalette}
              onController={receiveController}
              onReady={receiveReady}
              onError={receiveError}
              onProgress={(seconds, running) => {
                setTime(seconds)
                setPlaying(running)
                if (seconds >= 8) recording.stop('Shot complete.')
              }}
            />
          )}
        </Show>
        <Show when={!clean()}>
          <div class={styles.caption}>
            <span>SHOT STUDIO</span>
            <strong>{recipe().shot.title}</strong>
            <span>
              {recipe().shot.from} → {recipe().shot.to}
            </span>
          </div>
        </Show>
      </div>
      <Show when={clean()}>
        <button
          type="button"
          class={styles.restore}
          onClick={() => setClean(false)}
        >
          Show controls
        </button>
      </Show>
      <aside class={styles.sidebar} hidden={clean()}>
        <a class={styles.back} href="/gummy?view=match">
          Play gummy chess
        </a>
        <h1>Gummy cinema</h1>
        <p class={styles.intro}>
          Set the position. Pick the material. Play the capture.
        </p>
        <GummyCinemaSection title="Shot examples" {...sectionProps('examples')}>
          <div class={styles.shots}>
            <For each={GUMMY_BOARD_SHOTS}>
              {(shot) => (
                <button
                  class={styles.button}
                  type="button"
                  aria-pressed={recipe().shot.id === shot.id}
                  disabled={busy()}
                  onClick={() => {
                    guarded(() => {
                      apply(createGummyCinemaRecipe(shot))
                    })
                  }}
                >
                  {shot.title}
                </button>
              )}
            </For>
          </div>
        </GummyCinemaSection>
        <div class={styles.playback}>
          <button
            class={styles.button}
            type="button"
            disabled={unavailable() || exportBusy() || recordingStarting()}
            onClick={() =>
              playing() ? controller?.pause() : controller?.play()
            }
          >
            {playing()
              ? 'Pause shot'
              : time() >= 8
                ? 'Replay shot'
                : 'Play shot'}
          </button>
          <button
            class={styles.button}
            type="button"
            disabled={unavailable() || exportBusy() || recordingStarting()}
            onClick={() => {
              guarded(reset)
            }}
          >
            Reset
          </button>
        </div>
        <label class={styles.label} for="cinema-time">
          Shot time <output>{time().toFixed(1)} / 8.0 s</output>
        </label>
        <input
          id="cinema-time"
          class={styles.range}
          type="range"
          min="0"
          max="8"
          step="0.1"
          value={time()}
          disabled={unavailable() || busy()}
          onChange={(e) => {
            guarded(() =>
              controller?.seekFrame(
                Math.round(Number(e.currentTarget.value) * 60),
                60,
              ),
            )
          }}
        />
        <p class={styles.help}>
          Scrubbing backwards rebuilds the simulation from the start.
        </p>
        <fieldset class={styles.fields} disabled={busy()}>
          <legend>Stage the shot</legend>
          <GummyCinemaSection
            title="Pieces and board"
            {...sectionProps('appearance')}
          >
            <label for="cinema-art">Piece design</label>
            <select
              id="cinema-art"
              value={draft().artStyle}
              onChange={(e) =>
                setDraft((r) => ({
                  ...r,
                  artStyle: e.currentTarget
                    .value as GummyCinemaRecipe['artStyle'],
                }))
              }
            >
              <option value="sculpted">Sculpted candy</option>
              <option value="classic">Original moulds</option>
            </select>
            <label for="cinema-board">Board finish</label>
            <select
              id="cinema-board"
              value={draft().shot.boardTheme}
              onChange={(e) => {
                updateShot('boardTheme', e.currentTarget.value)
              }}
            >
              <option value="classic">Ivory studio</option>
              <option value="glass">Smoked sea-glass</option>
              <option value="lava">Obsidian lava</option>
            </select>
            <label for="cinema-attacker-palette">Attacking piece color</label>
            <select
              id="cinema-attacker-palette"
              value={draft().attackerPalette}
              onChange={(e) =>
                setDraft((r) => ({
                  ...r,
                  attackerPalette: e.currentTarget
                    .value as GummyCinemaRecipe['attackerPalette'],
                }))
              }
            >
              <For each={GUMMY_BOARD_PALETTES}>
                {(p) => <option value={p[0]}>{p[1]}</option>}
              </For>
            </select>
            <label for="cinema-victim-palette">Captured piece color</label>
            <select
              id="cinema-victim-palette"
              value={draft().victimPalette}
              onChange={(e) =>
                setDraft((r) => ({
                  ...r,
                  victimPalette: e.currentTarget
                    .value as GummyCinemaRecipe['victimPalette'],
                }))
              }
            >
              <For each={GUMMY_BOARD_PALETTES}>
                {(p) => <option value={p[0]}>{p[1]}</option>}
              </For>
            </select>
            <label for="cinema-material">Material</label>
            <select
              id="cinema-material"
              value={draft().shot.presetId}
              onChange={(e) => {
                const preset = GUMMY_BUILTIN_PRESETS.find(
                  (p) => p.id === e.currentTarget.value,
                )!
                setDraft((r) => ({
                  ...r,
                  shot: { ...r.shot, presetId: preset.id },
                  material: structuredClone(preset.preset.settings),
                }))
              }}
            >
              <option value="custom" disabled>
                Custom material
              </option>
              <For each={GUMMY_BUILTIN_PRESETS}>
                {(p) => <option value={p.id}>{p.label}</option>}
              </For>
            </select>
            <label for="cinema-size">
              Piece size: {Math.round(draft().scale * 100)}%
            </label>
            <input
              id="cinema-size"
              type="range"
              min="0.85"
              max="1"
              step="0.01"
              value={draft().scale}
              onInput={(e) =>
                setDraft((r) =>
                  updateGummyCinemaCaptureContext(r, {
                    scale: Number(e.currentTarget.value),
                  }),
                )
              }
            />
          </GummyCinemaSection>
          <GummyCinemaSection
            title="Camera and quality"
            {...sectionProps('camera')}
          >
            <label for="cinema-camera">Camera movement</label>
            <select
              id="cinema-camera"
              value={draft().shot.cameraStyle}
              onChange={(e) => {
                updateShot('cameraStyle', e.currentTarget.value)
              }}
            >
              <option value="arc">Orbit and push in</option>
              <option value="diagonal">Diagonal tracking</option>
              <option value="hero">Low hero arc</option>
            </select>
            <label for="cinema-quality">Render quality</label>
            <select
              id="cinema-quality"
              value={draft().quality}
              onChange={(e) =>
                setDraft((r) => ({
                  ...r,
                  quality: e.currentTarget
                    .value as GummyCinemaRecipe['quality'],
                }))
              }
            >
              <option value="auto">Auto</option>
              <option value="tablet">Tablet</option>
              <option value="high">High</option>
            </select>
          </GummyCinemaSection>
          <GummyCinemaSection
            title="Capture motion"
            {...sectionProps('motion')}
          >
            <GummyCinemaMotionControls
              motion={draft().shot.motion}
              mechanic={draft().shot.mechanic}
              onMotion={updateMotion}
              onMechanic={updateMechanic}
              advancedOpen={sections().shear}
              onAdvancedToggle={(open) => {
                sectionProps('shear').onToggle(open)
              }}
            />
          </GummyCinemaSection>
          <GummyCinemaSection
            title="Position and move"
            {...sectionProps('position')}
          >
            <p class={styles.help}>
              Independent composed positions. Use a FEN with both kings, then
              choose a legal capture onto an occupied square. Castling, en
              passant and promotion are outside this shot tool.
            </p>
            <label for="cinema-fen">Position (FEN)</label>
            <textarea
              id="cinema-fen"
              rows="4"
              value={draft().shot.fen}
              onInput={(e) => {
                updateShot('fen', e.currentTarget.value)
              }}
            />
            <div class={styles.squares}>
              <label>
                From
                <input
                  aria-label="Capture from square"
                  maxLength="2"
                  value={draft().shot.from}
                  onInput={(e) => {
                    updateShot('from', e.currentTarget.value.toLowerCase())
                  }}
                />
              </label>
              <label>
                To
                <input
                  aria-label="Capture target square"
                  maxLength="2"
                  value={draft().shot.to}
                  onInput={(e) => {
                    updateShot('to', e.currentTarget.value.toLowerCase())
                  }}
                />
              </label>
            </div>
          </GummyCinemaSection>
          <p class={styles.help}>Edits take effect when you apply the shot.</p>
          <button
            type="button"
            class={`${styles.button} ${styles.apply}`}
            onClick={() => {
              guarded(() => {
                apply(draft())
              })
            }}
          >
            Apply shot settings
          </button>
        </fieldset>
        <GummyPresetControls
          current={recipe().material}
          disabled={busy()}
          onApply={(material) => {
            guarded(() => {
              apply({
                ...draft(),
                material,
                shot: { ...draft().shot, presetId: 'custom' },
              })
            })
          }}
        />
        <div class={styles.playback}>
          <button
            class={styles.button}
            type="button"
            disabled={busy()}
            aria-pressed={portrait()}
            onClick={() => setPortrait((p) => !p)}
          >
            {portrait() ? 'Landscape framing' : 'Portrait framing'}
          </button>
          <button
            class={styles.button}
            type="button"
            onClick={() => setClean(true)}
          >
            Hide controls
          </button>
        </div>
        <GummyCinemaSection
          title="Video export"
          {...sectionProps('videoExport')}
        >
          <GummyRecordingControls
            recording={recording}
            ready={!unavailable() && !exportBusy() && !recordingStarting()}
            onStart={() => {
              if (busy() || unavailable() || !controller) return
              const source = controller
              setRecordingStarting(true)
              guarded(async () => {
                try {
                  await source.resetPaused()
                  if (
                    disposed ||
                    controller !== source ||
                    exportBusy() ||
                    unavailable()
                  )
                    return
                  recording.start(canvasSlot?.querySelector('canvas'))
                  if (recording.state() === 'recording') source.play()
                } finally {
                  if (!disposed) setRecordingStarting(false)
                }
              })
            }}
          />
          <GummyCinemaExport
            controller={() => controller}
            ready={!unavailable()}
            disabled={recording.busy() || recordingStarting()}
            portrait={portrait()}
            onBusy={setExportBusy}
          />
        </GummyCinemaSection>
        <GummyCinemaSection title="Share this shot" {...sectionProps('recipe')}>
          <p class={styles.help}>
            Copy the complete position, camera and material recipe, or paste one
            to load it.
          </p>
          <button class={styles.button} type="button" onClick={showRecipe}>
            Show recipe JSON
          </button>
          <div class={styles.recipeHeader}>
            <label for="cinema-recipe-json">Recipe JSON</label>
            <button
              type="button"
              class={`${styles.button} ${styles.copyButton}`}
              aria-label="Copy recipe JSON"
              title="Copy recipe JSON"
              disabled={copying()}
              onClick={() => void copyRecipe()}
            >
              <Show when={copied()} fallback={<Copy aria-hidden="true" />}>
                <Check aria-hidden="true" />
              </Show>
              <span>
                {copying() ? 'Copying…' : copied() ? 'Copied' : 'Copy'}
              </span>
            </button>
          </div>
          <textarea
            ref={recipeText}
            id="cinema-recipe-json"
            class={styles.recipeText}
            aria-label="Shot recipe JSON"
            spellcheck={false}
            rows="8"
            value={json()}
            onInput={(e) => {
              setJson(e.currentTarget.value)
              setCopyStatus('')
              setCopied(false)
            }}
          />
          <Show when={copyStatus()}>
            <p class={styles.copyStatus} role="status" aria-live="polite">
              {copyStatus()}
            </p>
          </Show>
          <button
            class={styles.button}
            type="button"
            disabled={busy()}
            onClick={() => {
              guarded(() => {
                apply(json())
              })
            }}
          >
            Load recipe
          </button>
        </GummyCinemaSection>
        <Show when={!ready() && !error()}>
          <p class={styles.status} role="status">
            Preparing the candy and board…
          </p>
        </Show>
        <Show when={error()}>
          <p class={styles.error} role="alert">
            {error()}
          </p>
        </Show>
      </aside>
    </main>
  )
}

declare global {
  interface Window {
    __gummyCinema?: GummyCinemaController & {
      configure(value: unknown): Promise<void>
      recipe(): GummyCinemaRecipe
    }
  }
}
