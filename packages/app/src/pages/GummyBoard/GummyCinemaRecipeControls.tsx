/** Copy, inspect and import the complete recipe without coupling clipboard state to playback. */
import { createSignal, onCleanup, Show } from 'solid-js'
import { Check, Copy } from '@/icons'
import styles from './GummyCinemaPage.module.css'

export function GummyCinemaRecipeControls(props: {
  recipe: object
  busy: boolean
  onApply: (value: unknown) => void
}) {
  const [json, setJson] = createSignal('')
  const [copying, setCopying] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal('')
  const [copied, setCopied] = createSignal(false)
  let recipeText: HTMLTextAreaElement | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  function showRecipe() {
    setJson(JSON.stringify(props.recipe, null, 2))
    setCopyStatus('')
    setCopied(false)
  }

  async function copyRecipe() {
    const text = json() || JSON.stringify(props.recipe, null, 2)
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

  return (
    <>
      <p class={styles.help}>
        Copy the complete position, camera and material recipe, or paste one to
        load it.
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
          <span>{copying() ? 'Copying…' : copied() ? 'Copied' : 'Copy'}</span>
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
        disabled={props.busy}
        onClick={() => {
          props.onApply(json())
        }}
      >
        Load recipe
      </button>
    </>
  )
}
