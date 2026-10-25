// Shared authored-phrase choices keep both world instruments consistent and keyboard reachable.
import { For } from 'solid-js'

interface Props<T extends { id: string; title: string }> {
  phrases: readonly T[]
  selected: string
  label: string
  disabled: boolean
  onSelect(phrase: T): void
}

export function PracticePhrases<T extends { id: string; title: string }>(
  props: Props<T>,
) {
  return (
    <div class="observatory-phrases" role="group" aria-label={props.label}>
      <For each={props.phrases}>
        {(phrase) => (
          <button
            type="button"
            aria-pressed={props.selected === phrase.id}
            disabled={props.disabled}
            onClick={() => {
              props.onSelect(phrase)
            }}
          >
            {phrase.title}
          </button>
        )}
      </For>
    </div>
  )
}
