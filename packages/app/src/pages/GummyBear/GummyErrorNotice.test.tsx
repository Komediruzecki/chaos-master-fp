/** Error details remain accessible when clipboard permissions are missing on a device. */
import { cleanup, fireEvent, render, screen, waitFor, } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GummyErrorNotice } from './GummyErrorNotice'

let clipboardDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    'clipboard',
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (clipboardDescriptor)
    Object.defineProperty(
      globalThis.navigator,
      'clipboard',
      clipboardDescriptor,
    )
  else Reflect.deleteProperty(globalThis.navigator, 'clipboard')
})

const message =
  'GPU validation error: encoder state is invalid\nWhile encoding the particle step.'

describe('GummyErrorNotice', () => {
  it('opens full details, copies the exact multiline error and closes from the keyboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(() => <GummyErrorNotice message={message} />)
    const toggle = screen.getByRole('button', { name: 'Simulation error' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(message)
    fireEvent.click(toggle)
    const log = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Simulation error log',
    })
    expect(log.value).toBe(message)
    expect(log.readOnly).toBe(true)
    expect(screen.getByRole('region', { name: 'Error details' }).id).toBe(
      toggle.getAttribute('aria-controls'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Error copied.')
    })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(message)
    fireEvent.keyDown(log, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('selects the complete log for manual copying if the clipboard is blocked', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    })
    render(() => <GummyErrorNotice message={message} />)
    fireEvent.click(screen.getByRole('button', { name: 'Simulation error' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Copy was blocked. The text is selected so you can copy it manually.',
      )
    })
    const log = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Simulation error log',
    })
    expect(document.activeElement).toBe(log)
    expect(log.selectionStart).toBe(0)
    expect(log.selectionEnd).toBe(message.length)
  })
})
