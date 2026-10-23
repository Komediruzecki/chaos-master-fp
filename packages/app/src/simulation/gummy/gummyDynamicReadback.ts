/** Serial packed snapshots reuse one staging buffer across live topology checks. */
import { d } from 'typegpu'
/** One reusable packed readback avoids decoding four vec4 arrays during a live topology check. */
export function createGummyDynamicReadback(
  device: GPUDevice,
  sources: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer],
  vertexCount: number,
) {
  const arrayBytes = vertexCount * d.sizeOf(d.vec4f)
  const staging = device.createBuffer({
    label: 'Gummy dynamic snapshot',
    size: arrayBytes * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  let disposed = false
  let queued: Promise<void> = Promise.resolve()

  function queueRead<T>(
    target: GPUBuffer,
    count: number,
    decode: (packed: Float32Array) => T,
  ) {
    const task = queued.then(async () => {
      if (disposed) throw new Error('Gummy dynamic readback has been destroyed')
      const encoder = device.createCommandEncoder({
        label: 'Gummy dynamic snapshot copy',
      })
      for (let i = 0; i < count; i++)
        encoder.copyBufferToBuffer(
          sources[i]!,
          0,
          target,
          i * arrayBytes,
          arrayBytes,
        )
      device.queue.submit([encoder.finish()])
      await target.mapAsync(GPUMapMode.READ, 0, count * arrayBytes)
      try {
        if (disposed)
          throw new Error('Gummy dynamic readback has been destroyed')
        return decode(
          new Float32Array(target.getMappedRange(0, count * arrayBytes)),
        )
      } finally {
        target.unmap()
      }
    })
    // Requests share one staging buffer; a failed map must not poison the next request.
    queued = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  return {
    read() {
      return queueRead(staging, sources.length, (packed) => {
        const floats = vertexCount * 4
        return {
          positions: packed.slice(0, floats),
          previous: packed.slice(floats, floats * 2),
          velocities: packed.slice(floats * 2, floats * 3),
          grip: packed.slice(floats * 3, floats * 4),
        }
      })
    },
    readPositions() {
      return queueRead(staging, 1, (packed) => packed.slice(0, vertexCount * 4))
    },
    destroy() {
      if (disposed) return
      disposed = true
      staging.destroy()
    },
  }
}
