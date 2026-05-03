import { createSignal, For, Show } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { DEFAULT_QUALITY } from '@/defaults'
import { examples } from '@/flame/examples'
import { Flam3 } from '@/flame/Flam3'
import { Cross } from '@/icons'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Camera2D } from '@/lib/Camera2D'
import { Root } from '@/lib/Root'
import { extractFlameFromPng } from '@/utils/flameInPng'
import { deleteRecentFlame, loadRecentFlames } from '@/utils/recentFlames'
import { recordEntries } from '@/utils/record'
import { Button } from '../Button/Button'
import { DelayedShow } from '../DelayedShow/DelayedShow'
import { useRequestModal } from '../Modal/ModalContext'
import { ModalTitleBar } from '../Modal/ModalTitleBar'
import ui from './LoadFlameModal.module.css'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { ChangeHistory } from '@/utils/createStoreHistory'

const CANCEL = 'cancel'

function Preview(props: { flameDescriptor: FlameDescriptor }) {
  return (
    <Root
      adapterOptions={{
        powerPreference: 'high-performance',
      }}
    >
      <AutoCanvas pixelRatio={1}>
        <Camera2D
          position={vec2f(
            ...props.flameDescriptor.renderSettings.camera.position,
          )}
          zoom={props.flameDescriptor.renderSettings.camera.zoom}
        >
          <Flam3
            quality={DEFAULT_QUALITY}
            pointCountPerBatch={2e4}
            adaptiveFilterEnabled={true}
            flameDescriptor={props.flameDescriptor}
            renderInterval={1}
            onExportImage={undefined}
            edgeFadeColor={vec4f(0)}
          />
        </Camera2D>
      </AutoCanvas>
    </Root>
  )
}

type LoadFlameModalProps = {
  respond: (flameDescriptor: FlameDescriptor | typeof CANCEL) => void
}

async function pickPngFile(): Promise<File | null> {
  try {
    if ('showOpenFilePicker' in window) {
      const fileHandles = await window
        .showOpenFilePicker({
          id: 'load-flame-from-file',
          types: [{ accept: { 'image/png': ['.png'] } }],
        })
        .catch(() => undefined)
      if (!fileHandles) {
        return null
      }
      const [fileHandle] = fileHandles
      return await fileHandle.getFile()
    }
  } catch (_) {
    // fall through to input-based picker any failure
  }

  // fallback: hidden input element (works on Firefox and Safari/iOS)
  return await new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,.png'
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.width = '1px'
    input.style.height = '1px'
    input.addEventListener('change', () => {
      const file = input.files && input.files[0] ? input.files[0] : null
      resolve(file ?? null)
      input.remove()
    })
    input.addEventListener('cancel', () => {
      resolve(null)
      input.remove()
    })
    document.body.appendChild(input)
    input.click()
  })
}

function LoadFlameModal(props: LoadFlameModalProps) {
  const [recentFlames, setRecentFlames] = createSignal(loadRecentFlames())

  async function loadFromFile() {
    const file = await pickPngFile()
    if (!file) return
    const arrBuf = new Uint8Array(await file.arrayBuffer())
    try {
      const flameDescriptor = await extractFlameFromPng(arrBuf)
      props.respond(flameDescriptor)
    } catch (err) {
      console.warn(err)
      alert(`No valid flame found in '${file.name}'.`)
    }
  }

  function handleDeleteRecent(e: MouseEvent, id: string) {
    e.stopPropagation()
    deleteRecentFlame(id)
    setRecentFlames(loadRecentFlames())
  }

  function formatDate(timestamp: number) {
    const d = new Date(timestamp)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <>
      <ModalTitleBar
        onClose={() => {
          props.respond(CANCEL)
        }}
      >
        Load Flame
        <span class={ui.undoMessage}>You can undo this operation.</span>
      </ModalTitleBar>
      <section>
        From disk <Button onClick={loadFromFile}>Choose File</Button>
      </section>
      <Show when={recentFlames().length > 0}>
        <h2>Recent Flames</h2>
        <section class={ui.gallery}>
          <For each={recentFlames()}>
            {(recent, i) => (
              <button
                class={ui.item}
                onClick={() => {
                  props.respond(structuredClone(recent.flame))
                }}
              >
                <DelayedShow delayMs={i() * 30}>
                  <Preview flameDescriptor={recent.flame} />
                </DelayedShow>
                <div class={ui.itemTitle}>
                  <span>{recent.name}</span>
                  <span style={{ 'font-size': '0.7rem', opacity: '0.7' }}>
                    {formatDate(recent.savedAt)}
                  </span>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  style={{
                    position: 'absolute',
                    top: '0.25rem',
                    right: '0.25rem',
                    padding: 'var(--space-1)',
                    'background-color':
                      'rgb(from var(--neutral-950) r g b / 60%)',
                    border: 'none',
                    'border-radius': 'var(--space-1)',
                    cursor: 'pointer',
                    opacity: '0',
                    color: 'white',
                    'line-height': '0',
                    width: '1.5rem',
                    height: '1.5rem',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                  }}
                  onClick={(e) => {
                    handleDeleteRecent(e, recent.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleDeleteRecent(e as unknown as MouseEvent, recent.id)
                    }
                  }}
                  title="Delete"
                >
                  <Cross />
                </span>
              </button>
            )}
          </For>
        </section>
      </Show>
      <h2>Example Gallery</h2>
      <section class={ui.gallery}>
        <For each={recordEntries(examples)}>
          {([exampleId, example], i) => (
            <button
              class={ui.item}
              onClick={() => {
                props.respond(example)
              }}
            >
              <DelayedShow delayMs={i() * 50}>
                <Preview flameDescriptor={example} />
              </DelayedShow>
              <div class={ui.itemTitle}>{exampleId}</div>
            </button>
          )}
        </For>
      </section>
    </>
  )
}

export function createLoadFlame(history: ChangeHistory<FlameDescriptor>) {
  const requestModal = useRequestModal()
  const [loadModalIsOpen, setLoadModalIsOpen] = createSignal(false)

  async function showLoadFlameModal(): Promise<FlameDescriptor | undefined> {
    setLoadModalIsOpen(true)
    const result = await requestModal<FlameDescriptor | typeof CANCEL>({
      content: ({ respond }) => <LoadFlameModal respond={respond} />,
    })
    setLoadModalIsOpen(false)
    if (result === CANCEL) {
      return undefined
    }
    // structuredClone required in order to not modify the original, as store in solidjs does
    history.replace(structuredClone(result))
    return result
  }

  return {
    showLoadFlameModal,
    loadModalIsOpen,
  }
}
