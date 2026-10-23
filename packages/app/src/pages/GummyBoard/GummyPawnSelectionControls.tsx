/** Shared, non-rendering pawn selector for saved fractal shapes and the original gummy set. */
import { createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, } from 'solid-js'
import { createGummyAuthoredPawn, gummyAuthoredPawnKey, validateGummyAuthoredPawn, } from '@/simulation/gummy/gummyAuthoredPawn'
import { gummyPawnForgeUrl, loadGummyPawnLibrary, prepareGummyPawnEdit, } from '../Pawn/gummyPawnLibrary'
import styles from './GummyPawnSelectionControls.module.css'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export function GummyPawnSelectionControls(props: {
  value?: GummyAuthoredPawn
  disabled?: boolean
  onChange: (pawn?: GummyAuthoredPawn) => void
  tone?: 'dark' | 'light'
}) {
  const id = createUniqueId()
  const trial = createGummyAuthoredPawn(undefined, 'Crystal lattice', 1)
  const crown = createGummyAuthoredPawn(undefined, 'Open crown', 2)
  const [library, setLibrary] = createSignal(loadGummyPawnLibrary())
  const [error, setError] = createSignal('')
  const key = createMemo(() => gummyAuthoredPawnKey(props.value))
  const savedSelection = createMemo(() =>
    library().pawns.find((pawn) => gummyAuthoredPawnKey(pawn) === key()),
  )
  const selection = createMemo(() =>
    !props.value
      ? 'classic'
      : savedSelection()
        ? key()
        : key() === gummyAuthoredPawnKey(trial)
          ? 'trial'
          : key() === gummyAuthoredPawnKey(crown)
            ? 'crown'
            : 'current',
  )
  const refresh = () => setLibrary(loadGummyPawnLibrary())
  onMount(() => {
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    onCleanup(() => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    })
  })

  function change(value: string) {
    if (props.disabled) return
    if (value === 'classic') props.onChange(undefined)
    else {
      const pawn =
        value === 'trial'
          ? trial
          : value === 'crown'
            ? crown
            : library().pawns.find(
                (item) => gummyAuthoredPawnKey(item) === value,
              )
      if (pawn) props.onChange(validateGummyAuthoredPawn(pawn))
    }
  }
  return (
    <details class={styles.panel} data-tone={props.tone ?? 'dark'} open>
      <summary>Pawn shape</summary>
      <div class={styles.body}>
        <label for={id}>Shape for both sides</label>
        <select
          id={id}
          disabled={props.disabled}
          value={selection()}
          onChange={(event) => {
            change(event.currentTarget.value)
          }}
        >
          <option value="classic">Classic gummy</option>
          <option value="crown">Open crown</option>
          <option value="trial">Original crystal lattice</option>
          <For each={library().pawns}>
            {(pawn) => (
              <option value={gummyAuthoredPawnKey(pawn)}>{pawn.name}</option>
            )}
          </For>
          <Show when={selection() === 'current'}>
            <option value="current">
              {props.value?.name} (match snapshot)
            </option>
          </Show>
        </select>
        <p>
          Fractal structure, gummy material. Saved shapes replace the pawns;
          other pieces keep their current form.
        </p>
        <a
          href={gummyPawnForgeUrl(props.value)}
          onClick={(event) => {
            if (!props.value) return
            try {
              prepareGummyPawnEdit(props.value)
            } catch {
              event.preventDefault()
              setError(
                'The pawn could not be sent to the Forge. Local storage may be full or unavailable.',
              )
            }
          }}
        >
          {props.value
            ? 'Edit this pawn in the Forge'
            : 'Create a pawn in the Forge'}
        </a>
        <Show when={error() || library().error}>
          <p role="alert">{error() || library().error}</p>
        </Show>
      </div>
    </details>
  )
}
