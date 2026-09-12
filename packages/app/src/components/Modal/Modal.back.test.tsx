import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backDepth, popBack, pushBackHandler } from '@/lib/backStack'
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

  it('is off the stack the moment it is answered, mid transition', async () => {
    // startViewTransition defers the removal from the list into its own
    // callback, so the item's scope - and with it the back handler - used to
    // outlive the answer. A second back inside that window cancelled the same
    // dialog again and still reported success: on Android two quick presses
    // after answering left the layer beneath unanswered and the app up.
    const deferred: (() => void)[] = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => void) => {
        deferred.push(callback)
        return { ready: Promise.resolve(), finished: Promise.resolve() }
      },
    })
    const beneath = vi.fn()
    const dropBeneath = pushBackHandler(beneath, 'beneath')

    try {
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
      expect(backDepth()).toBe(2)

      // The answer: the transition's callback is captured, not run, which is
      // exactly the window the second back arrives in.
      expect(popBack()).toBe(true)
      expect(backDepth()).toBe(1)

      expect(popBack()).toBe(true)
      expect(beneath).toHaveBeenCalledTimes(1)

      deferred.forEach((callback) => {
        callback()
      })
      await expect(answer).resolves.toBeUndefined()
      expect(backDepth()).toBe(1)
    } finally {
      dropBeneath()
      Reflect.deleteProperty(document, 'startViewTransition')
    }
  })
})
