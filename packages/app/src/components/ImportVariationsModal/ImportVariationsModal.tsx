import { For } from 'solid-js'
import { Button } from '../Button/Button'
import { useRequestModal } from '../Modal/ModalContext'
import { ModalTitleBar } from '../Modal/ModalTitleBar'
import ui from './ImportVariations.module.css'
import type { CustomVariationDef } from '@/flame/variations/custom'

type ImportVariationsModalProps = {
  defs: CustomVariationDef[]
  /** true = save to library, false = keep for this session only. */
  respond: (save: boolean) => void
}

/**
 * Asks the recipient of a shared flame whether to save the custom variations it
 * brought into their permanent library. The variations are already usable this
 * session (registered transiently); this is purely the consent step before they
 * are persisted. Names are rendered as text (Solid escapes by default) — never
 * as HTML — so an attacker-chosen name cannot inject markup.
 */
function ImportVariationsModal(props: ImportVariationsModalProps) {
  const count = () => props.defs.length
  return (
    <>
      <ModalTitleBar
        onClose={() => {
          props.respond(false)
        }}
      >
        Custom variations included
      </ModalTitleBar>
      <div class={ui.content}>
        <p class={ui.note}>
          This shared flame includes {count()} custom variation
          {count() === 1 ? '' : 's'}. They are already active for this session.
          Save {count() === 1 ? 'it' : 'them'} to your library to keep{' '}
          {count() === 1 ? 'it' : 'them'} after a reload?
        </p>
        <ul class={ui.list}>
          <For each={props.defs}>
            {(def) => <li class={ui.item}>{def.name}</li>}
          </For>
        </ul>
      </div>
      <footer class={ui.footer}>
        <Button
          onClick={() => {
            props.respond(false)
          }}
        >
          Not now
        </Button>
        <Button
          onClick={() => {
            props.respond(true)
          }}
        >
          Save to library
        </Button>
      </footer>
    </>
  )
}

export function createImportVariationsModal() {
  const requestModal = useRequestModal()

  /** Resolves true if the user chose to save the variations. */
  async function showImportVariationsModal(
    defs: CustomVariationDef[],
  ): Promise<boolean> {
    return requestModal<boolean>({
      class: ui.container,
      content: ({ respond }) => (
        <ImportVariationsModal defs={defs} respond={respond} />
      ),
    })
  }

  return { showImportVariationsModal }
}
