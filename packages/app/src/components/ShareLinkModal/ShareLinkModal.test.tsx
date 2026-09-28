// Pins the share dialog's audio wiring switch: offered only when the
// workspace has wiring, on by default, and the link carries the rows only
// while it is on.
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/contexts/ToastContext'
import { examples } from '@/flame/examples'
import { decodeSharePayload } from '@/utils/jsonQueryParam'
import { Modal } from '../Modal/Modal'
import { createShareLinkModal } from './ShareLinkModal'
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
  beforeEach(() => {
    vi.spyOn(globalThis.navigator.clipboard, 'writeText').mockResolvedValue(
      undefined,
    )
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
})
