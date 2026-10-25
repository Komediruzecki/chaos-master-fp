/** Durable tone-mapped frames survive the browser recycling its presentation canvas. */
export function createNativeCinemaCapture(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
) {
  if (format !== 'bgra8unorm' && format !== 'rgba8unorm')
    throw new Error(`Unsupported cinema capture format: ${format}`)
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  if (
    ![width, height].every(
      (value) =>
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= device.limits.maxTextureDimension2D,
    ) ||
    !Number.isSafeInteger(bytesPerRow * height) ||
    bytesPerRow * height > device.limits.maxBufferSize
  )
    throw new RangeError('This GPU cannot capture the requested video size.')

  const texture = device.createTexture({
    label: 'native-cinema-capture',
    size: [width, height],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  let buffer: GPUBuffer
  let view: GPUTextureView
  try {
    view = texture.createView()
    buffer = device.createBuffer({
      label: 'native-cinema-readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  } catch (error) {
    texture.destroy()
    throw error
  }
  let disposed = false,
    reading = false

  function assertLive() {
    if (disposed) throw new Error('This capture has been released.')
  }
  return {
    width,
    height,
    view,
    async read(): Promise<ImageBitmap> {
      assertLive()
      if (reading) throw new Error('A capture read is already in progress.')
      reading = true
      try {
        const encoder = device.createCommandEncoder()
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
          width,
          height,
        ])
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        let pixels: Uint8ClampedArray<ArrayBuffer>
        try {
          assertLive()
          const mapped = new Uint8Array(buffer.getMappedRange())
          pixels = new Uint8ClampedArray(width * height * 4)
          for (let row = 0; row < height; row++)
            pixels.set(
              mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
              row * width * 4,
            )
          if (format === 'bgra8unorm') {
            for (let i = 0; i < pixels.length; i += 4) {
              const blue = pixels[i]!
              pixels[i] = pixels[i + 2]!
              pixels[i + 2] = blue
            }
          }
        } finally {
          buffer.unmap()
        }
        const bitmap = await globalThis.createImageBitmap(
          new ImageData(pixels, width, height),
        )
        if (disposed) {
          bitmap.close()
          assertLive()
        }
        return bitmap
      } finally {
        reading = false
      }
    },
    destroy() {
      if (disposed) return
      disposed = true
      buffer.destroy()
      texture.destroy()
    },
  }
}
