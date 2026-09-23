/**
 * Orbit buffers never grow past one storage binding, and the error scopes
 * around GPU work stay balanced when that work throws.
 */
import { describe, expect, it } from 'vitest'
import { bindingEntries, deviceErrors, fittedCapacity, grownCapacity, } from './explorerOrbitBuffers'

const MIB = 1024 * 1024

describe('grownCapacity', () => {
  it('grows by half again, for room, below the limit', () => {
    expect(grownCapacity(1100, 1000, 10_000)).toBe(1500)
    expect(grownCapacity(2000, 1000, 10_000)).toBe(2000)
  })

  it('stops at the binding limit instead of growing past it', () => {
    const limit = bindingEntries(
      { maxStorageBufferBindingSize: 128 * MIB, maxBufferSize: 256 * MIB },
      16,
    )
    expect(limit).toBe(8 * MIB)
    // 6M entries fit; half again would be 9M, over the 8M a binding holds.
    expect(grownCapacity(6 * MIB + 1, 6 * MIB, limit)).toBe(limit)
  })
})

describe('fittedCapacity', () => {
  it('keeps the buffers while a resized grid still fits them', () => {
    expect(fittedCapacity(900, 1000, 10_000)).toBe(1000)
    expect(fittedCapacity(500, 1000, 10_000)).toBe(1000)
  })

  it('reallocates with a quarter spare to grow, and to give memory back', () => {
    expect(fittedCapacity(1001, 1000, 10_000)).toBe(1252)
    expect(fittedCapacity(400, 1000, 10_000)).toBe(500)
    expect(fittedCapacity(9000, 1000, 10_000)).toBe(10_000)
    expect(fittedCapacity(20_000, 1000, 10_000)).toBe(20_000)
  })
})

/** A device with only the error-scope stack, counting what is open. */
function scopedDevice(errors: (string | undefined)[] = []) {
  let open = 0
  const device = {
    pushErrorScope() {
      open += 1
    },
    popErrorScope() {
      open -= 1
      const message = errors.shift()
      return Promise.resolve(message === undefined ? null : { message })
    },
  }
  return { device: device as unknown as GPUDevice, open: () => open }
}

describe('deviceErrors', () => {
  it('resolves to the first complaint, with both scopes popped', async () => {
    const { device, open } = scopedDevice(['bad binding'])
    const result = deviceErrors(device, () => undefined)
    expect(open()).toBe(0)
    await expect(result).resolves.toBe('bad binding')
  })

  it('pops both scopes when the work throws, and passes the throw on', () => {
    const { device, open } = scopedDevice()
    expect(() =>
      deviceErrors(device, () => {
        throw new Error('no current texture')
      }),
    ).toThrow('no current texture')
    expect(open()).toBe(0)
  })
})
