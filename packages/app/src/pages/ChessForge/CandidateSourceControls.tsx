/** Study selection and protected draft replacement share one independently scrolling inspector sidebar. */
import { For, Show } from 'solid-js'
import { FIGURINE_STUDIES } from '@/flame/chess/figurineStudies'
import styles from '../Pawn/PawnPage.module.css'
import ui from './ChessForgePage.module.css'
import type { useChessCandidate } from './useChessCandidate'
import type { FigurineStudyId } from '@/flame/chess/figurineStudies'

export function CandidateSourceControls(props: {
  forge: ReturnType<typeof useChessCandidate>
}) {
  let importInput: HTMLInputElement | undefined
  return (
    <>
      <Show when={props.forge.notice()}>
        <p role="status" class={ui.notice}>
          {props.forge.notice()}
        </p>
      </Show>
      <Show when={props.forge.pending()}>
        {(next) => (
          <div
            class={ui.notice}
            role="group"
            aria-label="Replace inspection draft"
          >
            <strong>Open {next().name}?</strong>
            <p>Your current draft has changes outside the saved library.</p>
            <div class={ui.confirmActions}>
              <button
                type="button"
                class={styles.primaryButton}
                onClick={() => {
                  props.forge.replace(true)
                }}
              >
                Save & open
              </button>
              <button
                type="button"
                class={styles.secondaryButton}
                onClick={() => {
                  props.forge.replace(false)
                }}
              >
                Replace draft
              </button>
              <button
                type="button"
                class={styles.quietButton}
                onClick={props.forge.cancelReplace}
              >
                Keep editing
              </button>
            </div>
          </div>
        )}
      </Show>
      <details open class={ui.section}>
        <summary>Source & library</summary>
        <label class={styles.selectField}>
          Start from a study
          <select
            aria-label="Start from a study"
            value=""
            onChange={(event) => {
              if (event.currentTarget.value)
                props.forge.study(event.currentTarget.value as FigurineStudyId)
              event.currentTarget.value = ''
            }}
          >
            <option value="">Choose a fractal study…</option>
            <For each={FIGURINE_STUDIES}>
              {(study) => <option value={study.id}>{study.name}</option>}
            </For>
          </select>
        </label>
        <Show when={props.forge.saved().length > 0}>
          <label class={styles.selectField}>
            Saved candidates
            <select
              aria-label="Saved candidates"
              value=""
              onChange={(event) => {
                const selected = props.forge
                  .saved()
                  .find((item) => item.id === event.currentTarget.value)
                if (selected) props.forge.select(structuredClone(selected))
                event.currentTarget.value = ''
              }}
            >
              <option value="">Open a saved candidate…</option>
              <For each={props.forge.saved()}>
                {(item) => (
                  <option value={item.id}>
                    {item.name} · {item.role}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <input
          ref={importInput}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="Candidate file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void props.forge.importFile(file)
            event.currentTarget.value = ''
          }}
        />
        <button
          type="button"
          class={styles.secondaryButton}
          onClick={() => importInput?.click()}
        >
          Import candidate
        </button>
      </details>
    </>
  )
}
