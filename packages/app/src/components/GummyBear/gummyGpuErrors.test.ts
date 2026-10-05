/** GPU failures reach the page once while native reporting and listener ownership remain intact. */
import { describe, expect, it, vi } from 'vitest'
import { bindGummyGpuErrors } from './gummyGpuErrors'

class GPUValidationError {
  constructor(public message: string) {}
}
class GPUInternalError {
  constructor(public message: string) {}
}
class GPUOutOfMemoryError {
  constructor(public message: string) {}
}

function gpuEvent(error: { message: string }) {
  const event = new Event('uncapturederror', { cancelable: true })
  Object.defineProperty(event, 'error', { value: error })
  return event
}

describe('gummy GPU error reporting', () => {
  it.each([
    [
      new GPUValidationError('Invalid dispatch size'),
      'GPU validation error: Invalid dispatch size',
    ],
    [
      new GPUInternalError('Command failed'),
      'GPU internal error: Command failed',
    ],
    [
      new GPUOutOfMemoryError('Allocation failed'),
      'GPU out of memory: Allocation failed',
    ],
    [
      { message: 'Unknown device failure' },
      'GPU error: Unknown device failure',
    ],
  ])(
    'reports the first GPU error with its category and detail',
    (error, message) => {
      const device = new EventTarget()
      const reported = vi.fn()
      const dispose = bindGummyGpuErrors(
        device as unknown as GPUDevice,
        reported,
      )
      const event = gpuEvent(error)
      expect(device.dispatchEvent(event)).toBe(true)
      expect(event.defaultPrevented).toBe(false)
      expect(reported).toHaveBeenCalledExactlyOnceWith(message)
      device.dispatchEvent(gpuEvent(new GPUValidationError('Later failure')))
      expect(reported).toHaveBeenCalledOnce()
      dispose()
    },
  )

  it('bounds long driver messages and explains an empty message', () => {
    const device = new EventTarget()
    const reported = vi.fn()
    const dispose = bindGummyGpuErrors(device as unknown as GPUDevice, reported)
    device.dispatchEvent(gpuEvent(new GPUValidationError('x'.repeat(2000))))
    const message = reported.mock.calls[0]![0] as string
    expect(message).toBe(`GPU validation error: ${'x'.repeat(977)}…`)
    expect(message).toHaveLength(1000)
    dispose()
    const stop = bindGummyGpuErrors(device as unknown as GPUDevice, reported)
    device.dispatchEvent(gpuEvent(new GPUOutOfMemoryError('   ')))
    expect(reported).toHaveBeenLastCalledWith(
      'GPU out of memory: The GPU could not complete this operation.',
    )
    stop()
  })

  it('detaches only its listener and ignores an event already queued at disposal', () => {
    const device = new EventTarget()
    const add = vi.spyOn(device, 'addEventListener')
    const remove = vi.spyOn(device, 'removeEventListener')
    const reported = vi.fn()
    const unrelated = vi.fn()
    device.addEventListener('uncapturederror', unrelated)
    const dispose = bindGummyGpuErrors(device as unknown as GPUDevice, reported)
    const listener = add.mock.calls.at(-1)![1] as EventListener
    dispose()
    dispose()
    expect(remove).toHaveBeenCalledExactlyOnceWith('uncapturederror', listener)
    const event = gpuEvent(new GPUInternalError('Late failure'))
    device.dispatchEvent(event)
    listener(event)
    expect(reported).not.toHaveBeenCalled()
    expect(unrelated).toHaveBeenCalledExactlyOnceWith(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not re-enter its callback when reporting triggers another GPU error', () => {
    const device = new EventTarget()
    const reported = vi.fn(() => {
      device.dispatchEvent(
        gpuEvent(new GPUValidationError('Follow-up failure')),
      )
    })
    const dispose = bindGummyGpuErrors(device as unknown as GPUDevice, reported)
    device.dispatchEvent(gpuEvent(new GPUInternalError('First failure')))
    expect(reported).toHaveBeenCalledExactlyOnceWith(
      'GPU internal error: First failure',
    )
    dispose()
  })
})
