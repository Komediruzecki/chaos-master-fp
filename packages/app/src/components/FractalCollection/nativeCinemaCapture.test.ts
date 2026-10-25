/** GPU exports remove aligned row padding, preserve channels, and release bounded resources. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativeCinemaCapture } from './nativeCinemaCapture'

function fixture(format: GPUTextureFormat = 'bgra8unorm') {
  const mapped = new Uint8Array(512).fill(199)
  mapped.set([7, 13, 29, 255, 31, 47, 67, 255], 0)
  mapped.set([71, 83, 97, 255, 101, 113, 127, 255], 256)
  const view = {} as GPUTextureView
  const texture = { createView: vi.fn(() => view), destroy: vi.fn() }
  const buffer = {
    mapAsync: vi.fn<() => Promise<void>>().mockResolvedValue(),
    getMappedRange: vi.fn(() => mapped.buffer),
    unmap: vi.fn(),
    destroy: vi.fn(),
  }
  const encoder = {
    copyTextureToBuffer: vi.fn(),
    finish: vi.fn(() => 'commands'),
  }
  const device = {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 4096 },
    createTexture: vi.fn(() => texture),
    createBuffer: vi.fn(() => buffer),
    createCommandEncoder: vi.fn(() => encoder),
    queue: { submit: vi.fn() },
  }
  const create = () =>
    createNativeCinemaCapture(device as unknown as GPUDevice, format, 2, 2)
  return { device, texture, buffer, encoder, view, create }
}

let image: ImageData | undefined
const close = vi.fn()
beforeEach(() => {
  image = undefined
  vi.clearAllMocks()
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, COPY_SRC: 1 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 })
  vi.stubGlobal('GPUMapMode', { READ: 1 })
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn((input: ImageData) => {
      image = input
      return Promise.resolve({
        width: input.width,
        height: input.height,
        close,
      })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('durable native cinema capture', () => {
  it.each(['bgra8unorm', 'rgba8unorm'] as const)(
    'reads %s pixels without row padding and reuses its allocation',
    async (format) => {
      const f = fixture(format),
        capture = f.create()
      expect(capture.view).toBe(f.view)
      await capture.read()
      expect(f.encoder.copyTextureToBuffer).toHaveBeenCalledWith(
        { texture: f.texture },
        { buffer: f.buffer, bytesPerRow: 256 },
        [2, 2],
      )
      expect(f.device.createBuffer).toHaveBeenCalledWith({
        label: 'native-cinema-readback',
        size: 512,
        usage: 9,
      })
      const rgba = [
        29, 13, 7, 255, 67, 47, 31, 255, 97, 83, 71, 255, 127, 113, 101, 255,
      ]
      const native = [
        7, 13, 29, 255, 31, 47, 67, 255, 71, 83, 97, 255, 101, 113, 127, 255,
      ]
      expect(Array.from(image!.data)).toEqual(
        format === 'bgra8unorm' ? rgba : native,
      )
      expect(f.buffer.unmap).toHaveBeenCalledOnce()
      await capture.read()
      expect(f.device.createTexture).toHaveBeenCalledOnce()
      expect(f.device.createBuffer).toHaveBeenCalledOnce()
      capture.destroy()
      capture.destroy()
      expect(f.buffer.destroy).toHaveBeenCalledOnce()
      expect(f.texture.destroy).toHaveBeenCalledOnce()
      await expect(capture.read()).rejects.toThrow('released')
    },
  )

  it('rejects unsupported formats and excessive dimensions before allocation', () => {
    const f = fixture('rgba16float')
    expect(f.create).toThrow('Unsupported cinema capture format')
    expect(f.device.createTexture).not.toHaveBeenCalled()
    expect(() =>
      createNativeCinemaCapture(
        f.device as unknown as GPUDevice,
        'rgba8unorm',
        0,
        2,
      ),
    ).toThrow('video size')
    expect(() =>
      createNativeCinemaCapture(
        f.device as unknown as GPUDevice,
        'rgba8unorm',
        2,
        17,
      ),
    ).toThrow('video size')
    expect(f.device.createTexture).not.toHaveBeenCalled()
  })

  it('releases the texture if readback allocation fails', () => {
    const f = fixture()
    f.device.createBuffer.mockImplementationOnce(() => {
      throw new Error('Allocation failed')
    })
    expect(f.create).toThrow('Allocation failed')
    expect(f.texture.destroy).toHaveBeenCalledOnce()
  })

  it('serializes readback and permits another read after map failure', async () => {
    const f = fixture(),
      capture = f.create()
    let reject!: (cause: Error) => void
    f.buffer.mapAsync.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    const first = capture.read()
    await expect(capture.read()).rejects.toThrow('already in progress')
    reject(new Error('Device lost'))
    await expect(first).rejects.toThrow('Device lost')
    await capture.read()
    expect(f.buffer.getMappedRange).toHaveBeenCalledOnce()
    capture.destroy()
  })

  it('closes a bitmap that completes after disposal', async () => {
    const f = fixture(),
      capture = f.create()
    let finish!: (bitmap: ImageBitmap) => void
    vi.stubGlobal(
      'createImageBitmap',
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve
        }),
    )
    const result = capture.read()
    await Promise.resolve()
    capture.destroy()
    finish({ close } as unknown as ImageBitmap)
    await expect(result).rejects.toThrow('released')
    expect(close).toHaveBeenCalledOnce()
    expect(f.buffer.unmap).toHaveBeenCalledOnce()
  })
})
