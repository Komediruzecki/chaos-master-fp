// Pins the share dialog's audio wiring switch: offered only when the
// workspace has wiring the user made (not the untouched default), on by
// default, and the link and Copy JSON carry the rows only while it is on.
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/contexts/ToastContext'
import { examples } from '@/flame/examples'
import { parseAudioWiring } from '@/utils/audioWiringParse'
import { defaultAudioMapping } from '@/utils/audioWiringPresets'
import { deepClone } from '@/utils/clone'
import { decodeSharePayload } from '@/utils/jsonQueryParam'
import { Modal } from '../Modal/Modal'
import { createShareLinkModal } from './ShareLinkModal'
import type { MockInstance } from 'vitest'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type * as ShareLink from '@/utils/shareLink'
import type { TimelineConfig } from '@/utils/timeline'

// No shortener in a unit test: the dialog shows the full `?flame=` link.
vi.mock('@/utils/shareLink', async (importOriginal) => ({
  ...(await importOriginal<typeof ShareLink>()),
  shortenShareUrl: () => Promise.resolve(''),
}))

const config: TimelineConfig = {
  fps: 30,
  timeScale: 1,
  startFrame: 0,
  endFrame: 90,
  loop: true,
}

const wiring: AudioMapping = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.5, 1.5],
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 1,
      range: [0, 0.12],
    },
  ],
}

function Host(props: {
  wiring: AudioMapping
  onReady: (show: () => void) => void
}) {
  const { showShareLinkModal } = createShareLinkModal(
    examples.example1,
    () => [],
    () => config,
    undefined,
    () => props.wiring,
  )
  props.onReady(() => void showShareLinkModal())
  return null
}

function openShare(current: AudioMapping) {
  let show: (() => void) | undefined
  render(() => (
    <ToastProvider>
      <Modal>
        <Host
          wiring={current}
          onReady={(fn) => {
            show = fn
          }}
        />
      </Modal>
    </ToastProvider>
  ))
  show?.()
}

async function linkedWiring() {
  const link = await screen.findByDisplayValue<HTMLTextAreaElement>(/\?flame=/)
  const param = new URL(link.value).searchParams.get('flame') ?? ''
  return (await decodeSharePayload(param)).audio
}

describe('the share dialog and the audio wiring', () => {
  let writes: MockInstance<Clipboard['writeText']>
  beforeEach(() => {
    writes = vi
      .spyOn(globalThis.navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('sends the wiring along until it is switched off', async () => {
    openShare(wiring)
    await waitFor(async () => {
      expect(await linkedWiring()).toEqual(wiring)
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Include audio wiring (2 rows)' }),
    )
    await waitFor(async () => {
      expect(await linkedWiring()).toBeUndefined()
    })
  })

  it('does not offer wiring the workspace does not have', async () => {
    openShare({ preset: 'custom', mappings: [] })
    expect(await linkedWiring()).toBeUndefined()
    expect(screen.queryByRole('checkbox', { name: /audio wiring/ })).toBeNull()
  })

  // Every workspace starts with the default wiring, so sending it would put
  // wiring into every link from users who never opened the audio panel, and
  // opening one mid-session would swap the recipient's wiring for it.
  it('sends no wiring, and offers none, while the wiring is the default', async () => {
    openShare(defaultAudioMapping())
    await screen.findByDisplayValue(/\?flame=/)
    expect(await linkedWiring()).toBeUndefined()
    expect(screen.queryByRole('checkbox', { name: /audio wiring/ })).toBeNull()
  })

  it('knows the default after the wiring schema has rebuilt it', async () => {
    // The workspace stores what `audio.setMapping` parsed, whose key order is
    // the schema's, not the preset table's.
    const parsed = parseAudioWiring(deepClone(defaultAudioMapping()))!
    openShare(parsed)
    await screen.findByDisplayValue(/\?flame=/)
    expect(await linkedWiring()).toBeUndefined()
  })

  it('copies JSON with the wiring only when the user made it', async () => {
    const copiedJson = async () => {
      writes.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
      await waitFor(() => {
        expect(writes).toHaveBeenCalled()
      })
      return JSON.parse(writes.mock.calls.at(-1)![0]) as { audio?: unknown }
    }

    openShare(wiring)
    await screen.findByDisplayValue(/\?flame=/)
    expect((await copiedJson()).audio).toEqual(wiring)
    cleanup()

    openShare(defaultAudioMapping())
    await screen.findByDisplayValue(/\?flame=/)
    expect(await copiedJson()).not.toHaveProperty('audio')
  })
})
