/** Encoder failures must reject and release snapshots instead of downloading truncated takes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encode: vi.fn(),
  flush: vi.fn(),
  close: vi.fn(),
  frameClose: vi.fn(),
}))
vi.mock('mp4-muxer', () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(8)
  },
  Muxer: class {
    addVideoChunkRaw() {}
    finalize() {}
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal(
    'VideoEncoder',
    class {
      static isConfigSupported() {
        return Promise.resolve({ supported: true })
      }
      encodeQueueSize = 0
      configure() {}
      encode = mocks.encode
      flush = mocks.flush
      close = mocks.close
    },
  )
  vi.stubGlobal(
    'VideoFrame',
    class {
      close = mocks.frameClose
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WebCodecs failure cleanup', () => {
  it('rejects an encode failure immediately and closes both frame and source bitmap', async () => {
    mocks.encode.mockImplementation(() => {
      throw new Error('Hardware encoder stopped')
    })
    const { createVideoEncoder } = await import('./videoEncoder')
    const encoder = await createVideoEncoder({
      codec: 'avc',
      width: 1920,
      height: 1080,
      fps: 60,
    })
    const close = vi.fn()
    const bitmap = { close } as unknown as ImageBitmap
    await expect(encoder.encodeFrame(bitmap, 0)).rejects.toThrow(
      'Hardware encoder stopped',
    )
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.frameClose).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
    await expect(encoder.finalize()).rejects.toThrow('Hardware encoder stopped')
  })

  it('closes a snapshot if VideoFrame construction fails', async () => {
    vi.stubGlobal(
      'VideoFrame',
      vi.fn(function () {
        throw new Error('Unsupported source')
      }),
    )
    const { createVideoEncoder } = await import('./videoEncoder')
    const encoder = await createVideoEncoder({
      codec: 'avc',
      width: 1920,
      height: 1080,
      fps: 60,
    })
    const close = vi.fn()
    const bitmap = { close } as unknown as ImageBitmap
    await expect(encoder.encodeFrame(bitmap, 0)).rejects.toThrow(
      'Unsupported source',
    )
    expect(close).toHaveBeenCalledOnce()
    encoder.cancel()
  })

  it('rejects missing encoded frames after flushing instead of finishing an incomplete file', async () => {
    const { createVideoEncoder } = await import('./videoEncoder')
    const encoder = await createVideoEncoder({
      codec: 'avc',
      width: 1920,
      height: 1080,
      fps: 60,
    })
    await encoder.encodeFrame({ close: vi.fn() } as unknown as ImageBitmap, 0)
    await expect(encoder.finalize()).rejects.toThrow('every requested frame')
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
