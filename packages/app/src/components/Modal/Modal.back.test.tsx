import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { backDepth, popBack } from '@/lib/backStack'
import { Modal } from './Modal'
import { useRequestModal } from './ModalContext'
import type { RequestModalFn } from './ModalContext'

function Host(props: { onReady: (request: RequestModalFn) => void }) {
  props.onReady(useRequestModal())
  return null
}

describe('Modal and back', () => {
  afterEach(cleanup)

  it('cancels the top dialog and leaves the registry empty', async () => {
    let request: RequestModalFn | undefined
    render(() => (
      <Modal>
        <Host
          onReady={(fn) => {
            request = fn
          }}
        />
      </Modal>
    ))

    const answer = request?.<string | undefined>({
      content: () => <p>Keep this flame?</p>,
    })
    expect(backDepth()).toBe(1)

    expect(popBack()).toBe(true)
    // Back does what the dialog's own cancel does: the request is answered
    // with the cancel value, not left pending.
    await expect(answer).resolves.toBeUndefined()
    expect(backDepth()).toBe(0)
  })
})
