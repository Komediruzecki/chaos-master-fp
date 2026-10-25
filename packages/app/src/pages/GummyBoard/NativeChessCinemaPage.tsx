/** Native fractal captures share the recording/export tools while retaining their own shape and breakup. */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { NATIVE_CINEMA_DURATION } from '@/components/FractalCollection/nativeCinemaCamera'
import { NativeFractalCinemaScene } from '@/components/FractalCollection/NativeFractalCinemaScene'
import { GummyRecordingControls } from '../GummyBear/GummyRecordingControls'
import { GummyCinemaExport } from './GummyCinemaExport'
import styles from './GummyCinemaPage.module.css'
import { GummyCinemaRecipeControls } from './GummyCinemaRecipeControls'
import { GummyCinemaSection } from './GummyCinemaSection'
import { parseNativeCinemaRecipe, resolveNativeCinemaReceipt, } from './nativeCinemaRecipe'
import { readNativeCinemaRecipe } from './nativeCinemaSession'
import { NativeCinemaStagingControls } from './NativeCinemaStagingControls'
import { useNativeCinemaStudio } from './useNativeCinemaStudio'

const examples = [
  { id: 'wild-canopy', role: 'n', name: 'Fern knight' },
  { id: 'tidal-relics', role: 'b', name: 'Split-current bishop' },
  { id: 'lattice-court', role: 'r', name: 'Window rook' },
] as const

function example(index: number) {
  const entry = examples[index]!
  return parseNativeCinemaRecipe({
    format: 'native-chess-cinema-shot',
    version: 1,
    fen: `7k/8/8/3${entry.role}4/4P3/8/8/K7 w - - 0 1`,
    from: 'e4',
    to: 'd5',
    nativeCollection: { version: 1, id: entry.id, enclosure: 'glass' },
    scale: 0.9,
    quality: 'normal',
    camera: 'arc',
  })
}

export function NativeChessCinemaPage() {
  const params = new URLSearchParams(window.location.search)
  const studio = useNativeCinemaStudio(
    params.get('from') === 'match'
      ? readNativeCinemaRecipe()
      : { recipe: example(0) },
  )
  const [portrait, setPortrait] = createSignal(false)
  const [clean, setClean] = createSignal(params.get('clean') === '1')
  const [sections, setSections] = createSignal({
    examples: true,
    look: true,
    video: true,
    recipe: false,
  })
  const section = (key: keyof ReturnType<typeof sections>) => ({
    get open() {
      return sections()[key]
    },
    onToggle(open: boolean) {
      setSections((value) => ({ ...value, [key]: open }))
    },
  })
  const receipt = createMemo(() => {
    const recipe = studio.recipe()
    return recipe ? resolveNativeCinemaReceipt(recipe) : undefined
  })
  const title = createMemo(() => {
    const move = receipt()
    if (!move) return 'Choose a capture'
    const attacker = move.before.pieces.find(
      (piece) => piece.id === move.pieceId,
    )!
    return `${attacker.role[0]!.toUpperCase()}${attacker.role.slice(1)} takes ${move.captured!.role}`
  })
  const unavailable = createMemo(() => !studio.ready())
  let canvasSlot: HTMLDivElement | undefined
  return (
    <main class={styles.page} classList={{ [styles.clean!]: clean() }}>
      <div
        class={styles.stage}
        classList={{ [styles.portrait!]: portrait() }}
        ref={canvasSlot}
      >
        <Show when={studio.recipe()}>
          {(recipe) => (
            <NativeFractalCinemaScene
              recipe={recipe()}
              onController={studio.receiveController}
              onReady={studio.receiveReady}
              onError={studio.receiveError}
              onProgress={studio.onProgress}
            />
          )}
        </Show>
        <Show when={!clean()}>
          <div class={styles.caption}>
            <span>FRACTAL CINEMA</span>
            <strong>{title()}</strong>
            <Show when={receipt()}>
              {(move) => (
                <span>
                  {move().from} → {move().to}
                </span>
              )}
            </Show>
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
      <aside
        class={styles.sidebar}
        hidden={clean()}
        aria-label="Fractal cinema controls"
      >
        <a class={styles.back} href="/gummy?view=match">
          Back to chess
        </a>
        <h1>Fractal cinema</h1>
        <p class={styles.intro}>
          Replay a capture through coloured branches, lattice and glass.
        </p>
        <GummyCinemaSection title="Capture studies" {...section('examples')}>
          <div class={styles.shots}>
            <For each={examples}>
              {(entry, index) => (
                <button
                  type="button"
                  class={styles.button}
                  disabled={studio.busy()}
                  onClick={() => {
                    studio.guarded(() => {
                      studio.apply(example(index()))
                    })
                  }}
                >
                  {entry.name}
                </button>
              )}
            </For>
          </div>
        </GummyCinemaSection>
        <div class={styles.playback}>
          <button
            type="button"
            class={styles.button}
            disabled={unavailable() || studio.exportBusy() || studio.starting()}
            onClick={() =>
              studio.playing()
                ? studio.controller()?.pause()
                : studio.controller()?.play()
            }
          >
            {studio.playing()
              ? 'Pause shot'
              : studio.time() >= NATIVE_CINEMA_DURATION
                ? 'Replay shot'
                : 'Play shot'}
          </button>
          <button
            type="button"
            class={styles.button}
            disabled={unavailable() || studio.exportBusy() || studio.starting()}
            onClick={() => {
              studio.guarded(studio.reset)
            }}
          >
            Reset
          </button>
        </div>
        <label class={styles.label} for="native-time">
          Shot time{' '}
          <output>
            {studio.time().toFixed(1)} / {NATIVE_CINEMA_DURATION.toFixed(1)} s
          </output>
        </label>
        <input
          id="native-time"
          type="range"
          min="0"
          max={NATIVE_CINEMA_DURATION}
          step="0.1"
          value={studio.time()}
          disabled={unavailable() || studio.busy()}
          onChange={(e) => {
            studio.guarded(() =>
              studio
                .controller()
                ?.seekFrame(Math.round(Number(e.currentTarget.value) * 60), 60),
            )
          }}
        />
        <GummyCinemaSection title="Collection and camera" {...section('look')}>
          <Show when={studio.draft()}>
            {(draft) => (
              <NativeCinemaStagingControls
                draft={draft()}
                busy={studio.busy()}
                onDraft={studio.setDraft}
                onApply={() => {
                  studio.guarded(() => {
                    studio.apply(studio.draft())
                  })
                }}
              />
            )}
          </Show>
        </GummyCinemaSection>
        <div class={styles.playback}>
          <button
            type="button"
            class={styles.button}
            disabled={studio.busy()}
            aria-pressed={portrait()}
            onClick={() => setPortrait((value) => !value)}
          >
            {portrait() ? 'Landscape framing' : 'Portrait framing'}
          </button>
          <button
            type="button"
            class={styles.button}
            onClick={() => setClean(true)}
          >
            Hide controls
          </button>
        </div>
        <GummyCinemaSection title="Video export" {...section('video')}>
          <GummyRecordingControls
            recordingMessage="Recording the capture. The clip stops when the shot ends."
            recording={studio.recording}
            ready={studio.ready() && !studio.exportBusy() && !studio.starting()}
            onStart={() => {
              studio.startRecording(canvasSlot?.querySelector('canvas'))
            }}
          />
          <GummyCinemaExport
            controller={studio.controller}
            ready={studio.ready()}
            disabled={studio.recording.busy() || studio.starting()}
            portrait={portrait()}
            onBusy={studio.setExportBusy}
            filenamePrefix="fractal-chess"
          />
        </GummyCinemaSection>
        <GummyCinemaSection title="Share this shot" {...section('recipe')}>
          <Show when={studio.recipe()}>
            {(recipe) => (
              <GummyCinemaRecipeControls
                recipe={recipe()}
                busy={studio.busy()}
                onApply={(value) => {
                  studio.guarded(() => {
                    studio.apply(value)
                  })
                }}
              />
            )}
          </Show>
        </GummyCinemaSection>
        <p class={styles.help}>
          The capture disperses the piece’s coloured points and breaks its glass
          shell. Choose the connected rook study to compare finite solid chunks.
        </p>
        <Show when={!studio.ready() && studio.recipe() && !studio.error()}>
          <p class={styles.status} role="status">
            Preparing this shot…
          </p>
        </Show>
        <Show when={studio.error()}>
          <p class={styles.error} role="alert">
            {studio.error()}
          </p>
        </Show>
      </aside>
    </main>
  )
}
