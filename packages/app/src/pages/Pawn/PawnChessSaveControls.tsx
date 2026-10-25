/** Explicitly save, replace and reopen immutable local chess-pawn snapshots from the Forge. */
import { createSignal, For, Show } from 'solid-js'
import { GUMMY_AUTHORED_PAWN_THICKNESS, gummyAuthoredPawnKey, validateGummyAuthoredPawn, } from '@/simulation/gummy/gummyAuthoredPawn'
import { gummyPawnForgeUrl, loadGummyPawnLibrary, prepareGummyPawnEdit, removeGummyPawnSnapshot, saveGummyPawnSnapshot, } from './gummyPawnLibrary'
import styles from './PawnChessSaveControls.module.css'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export function PawnChessSaveControls(props: {
  pawn: GummyAuthoredPawn
  isLattice: boolean
  savedKey?: string
  editing: boolean
  onInspect: () => void
  openError?: string
  onEdit: (
    patch: Partial<Pick<GummyAuthoredPawn, 'name' | 'thickness'>>,
  ) => void
  onSaved: (pawn: GummyAuthoredPawn) => void
  onRemoved: () => void
  onRestoreDraft: () => void
}) {
  const [library, setLibrary] = createSignal(loadGummyPawnLibrary())
  const [status, setStatus] = createSignal('')
  const [error, setError] = createSignal('')

  function save(replace: boolean) {
    setStatus('')
    setError('')
    try {
      const pawn = validateGummyAuthoredPawn({
        ...props.pawn,
        name: props.pawn.name.trim(),
      })
      if (!pawn)
        throw new Error(
          'Give this pawn a name of 1–64 characters and use the available thickness range.',
        )
      setLibrary({
        pawns: saveGummyPawnSnapshot(
          pawn,
          replace ? props.savedKey : undefined,
        ),
      })
      props.onSaved(pawn)
      setStatus(`${pawn.name} saved. Choose it under Pawn shape in Chess.`)
      try {
        const url = prepareGummyPawnEdit(pawn)
        window.history.replaceState(null, '', url)
      } catch {
        setError(
          'The pawn was saved, but this edit link could not be updated. Reopen it from Saved pawns before reloading.',
        )
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The pawn could not be saved. Local storage may be unavailable.',
      )
    }
  }

  function remove() {
    if (!props.savedKey) return
    try {
      setLibrary({ pawns: removeGummyPawnSnapshot(props.savedKey) })
      props.onRemoved()
      setError('')
      setStatus(
        'Removed from saved pawns. Games already using this shape keep their copy.',
      )
    } catch {
      setError(
        'The saved pawn could not be removed. The existing library has been kept.',
      )
    }
  }
  return (
    <section class={styles.panel} aria-labelledby="pawn-chess-save-title">
      <h2 id="pawn-chess-save-title">Use in gummy chess</h2>
      <p>Save this shape for the board. Existing games keep their own copy.</p>
      <Show when={props.openError}>
        <p role="alert">{props.openError}</p>
      </Show>
      <Show when={!props.isLattice}>
        <p>Switch to Crystal lattice to save a gummy chess pawn.</p>
      </Show>
      <fieldset disabled={!props.isLattice}>
        <Show when={!props.editing}>
          <button type="button" onClick={props.onInspect}>
            Inspect playable pawn
          </button>
        </Show>
        <label for="pawn-chess-name">Saved pawn name</label>
        <input
          id="pawn-chess-name"
          type="text"
          maxlength="64"
          value={props.pawn.name}
          onInput={(event) => {
            props.onEdit({ name: event.currentTarget.value })
          }}
        />
        <label class={styles.sliderLabel} for="pawn-chess-thickness">
          Material thickness <output>{props.pawn.thickness.toFixed(2)}</output>
        </label>
        <input
          id="pawn-chess-thickness"
          type="range"
          min={GUMMY_AUTHORED_PAWN_THICKNESS.min}
          max={GUMMY_AUTHORED_PAWN_THICKNESS.max}
          step="0.01"
          value={props.pawn.thickness}
          onInput={(event) => {
            props.onEdit({ thickness: event.currentTarget.valueAsNumber })
          }}
        />
        <p>
          Thickness adds material around the fractal. Use Playable surface to
          judge which openings remain.
        </p>
        <button
          class={styles.primary}
          type="button"
          onClick={() => {
            save(false)
          }}
        >
          Save for chess
        </button>
        <Show when={props.savedKey}>
          <button
            type="button"
            onClick={() => {
              save(true)
            }}
          >
            Update saved pawn
          </button>
          <button type="button" onClick={remove}>
            Remove saved pawn
          </button>
        </Show>
      </fieldset>
      <Show when={props.editing}>
        <button type="button" onClick={props.onRestoreDraft}>
          Return to Forge draft
        </button>
      </Show>
      <Show when={status()}>
        <p role="status">{status()}</p>
      </Show>
      <Show when={error() || library().error}>
        <p role="alert">{error() || library().error}</p>
      </Show>
      <a class={styles.play} href="/#arcade=chess">
        Open Chess
      </a>
      <details>
        <summary>Saved pawns ({library().pawns.length}/8)</summary>
        <ul>
          <For each={library().pawns}>
            {(pawn) => (
              <li>
                <span>{pawn.name}</span>
                <a
                  href={gummyPawnForgeUrl(pawn)}
                  aria-label={`Edit ${pawn.name}`}
                  onClick={(event) => {
                    try {
                      prepareGummyPawnEdit(pawn)
                    } catch {
                      event.preventDefault()
                      setError(
                        'The pawn could not be opened. Local storage may be unavailable.',
                      )
                    }
                  }}
                >
                  Edit
                </a>
                <Show when={gummyAuthoredPawnKey(pawn) === props.savedKey}>
                  <small>Current edit</small>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <p>
          Saved on this device. Updates do not change snapshots already used in
          a game or recipe.
        </p>
      </details>
    </section>
  )
}
