/** Packed dynamic snapshots must preserve every float and safely reuse one owned staging buffer. */
import { afterEach, expect, it, vi } from 'vitest'
import { createGummyDynamicReadback } from './gummySolver'

function gpuFixture() {
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 })
  vi.stubGlobal('GPUMapMode', { READ: 1 })
  const data = new Map<GPUBuffer, ArrayBuffer>()
  const inputs = Array.from({ length: 4 }, (_, section) =>
    Float32Array.from({ length: 8 }, (_, i) => section * 20 - 3 + i * 0.125),
  )
  const sources = inputs.map((input) => {
    const buffer = {} as GPUBuffer
    data.set(buffer, input.buffer)
    return buffer
  }) as [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer]
  let mapped = false
  let mapGate: Promise<void> | undefined
  const staging = {
    mapAsync: vi.fn(() =>
      (mapGate ?? Promise.resolve()).then(() => {
        mapped = true
        mapGate = undefined
      }),
    ),
    getMappedRange: vi.fn(() => {
      if (!mapped) throw new Error('Read before mapping')
      return data.get(staging as unknown as GPUBuffer)!
    }),
    unmap: vi.fn(() => {
      mapped = false
    }),
    destroy: vi.fn(),
  }
  const copy = vi.fn()
  const commandLists = new Map<GPUCommandBuffer, (() => void)[]>()
  const device = {
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      data.set(
        staging as unknown as GPUBuffer,
        new ArrayBuffer(descriptor.size),
      )
      return staging
    }),
    createCommandEncoder: vi.fn(() => {
      const commands: (() => void)[] = []
      return {
        copyBufferToBuffer(
          source: GPUBuffer,
          sourceOffset: number,
          target: GPUBuffer,
          targetOffset: number,
          size: number,
        ) {
          copy(source, sourceOffset, target, targetOffset, size)
          commands.push(() => {
            if (mapped) throw new Error('Copied into a mapped staging buffer')
            new Uint8Array(data.get(target)!).set(
              new Uint8Array(data.get(source)!, sourceOffset, size),
              targetOffset,
            )
          })
        },
        finish() {
          const command = {} as GPUCommandBuffer
          commandLists.set(command, commands)
          return command
        },
      }
    }),
    queue: {
      submit: vi.fn((commands: GPUCommandBuffer[]) => {
        for (const command of commands)
          for (const execute of commandLists.get(command)!) execute()
      }),
    },
  }
  return {
    device: device as unknown as GPUDevice,
    createBuffer: device.createBuffer,
    inputs,
    sources,
    staging,
    copy,
    deferMap(gate: Promise<void>) {
      mapGate = gate
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

it('maps once per four-array snapshot and returns independent packed floats without decoding vectors', async () => {
  const gpu = gpuFixture()
  const reader = createGummyDynamicReadback(gpu.device, gpu.sources, 2)
  const first = await reader.read()
  expect(first.positions).toEqual(gpu.inputs[0])
  expect(first.previous).toEqual(gpu.inputs[1])
  expect(first.velocities).toEqual(gpu.inputs[2])
  expect(first.grip).toEqual(gpu.inputs[3])
  expect(gpu.staging.mapAsync).toHaveBeenCalledOnce()
  expect(gpu.staging.unmap).toHaveBeenCalledOnce()
  expect(gpu.copy).toHaveBeenCalledTimes(4)
  first.positions[0] = 100
  const second = await reader.read()
  expect(second.positions).toEqual(gpu.inputs[0])
  expect(gpu.createBuffer).toHaveBeenCalledOnce()
  expect(gpu.createBuffer).toHaveBeenCalledWith({
    label: 'Gummy dynamic snapshot',
    size: 128,
    usage: 9,
  })
  reader.destroy()
  reader.destroy()
  expect(gpu.staging.destroy).toHaveBeenCalledOnce()
})

it('serializes concurrent requests so a new copy cannot overlap the previous map', async () => {
  const gpu = gpuFixture()
  const reader = createGummyDynamicReadback(gpu.device, gpu.sources, 2)
  let complete!: () => void
  gpu.deferMap(
    new Promise<void>((resolve) => {
      complete = resolve
    }),
  )
  const first = reader.read(),
    second = reader.read()
  await Promise.resolve()
  expect(gpu.copy).toHaveBeenCalledTimes(4)
  expect(gpu.staging.mapAsync).toHaveBeenCalledOnce()
  complete()
  await first
  expect((await second).grip).toEqual(gpu.inputs[3])
  expect(gpu.copy).toHaveBeenCalledTimes(8)
  expect(gpu.staging.unmap).toHaveBeenCalledTimes(2)
  reader.destroy()
})

it('allows a later read after a rejected map and destroys the owned staging buffer once', async () => {
  const gpu = gpuFixture()
  const reader = createGummyDynamicReadback(gpu.device, gpu.sources, 2)
  gpu.staging.mapAsync.mockRejectedValueOnce(new Error('Device map failed'))
  await expect(reader.read()).rejects.toThrow('Device map failed')
  expect(gpu.staging.unmap).not.toHaveBeenCalled()
  expect((await reader.read()).velocities).toEqual(gpu.inputs[2])
  reader.destroy()
  expect(gpu.staging.destroy).toHaveBeenCalledOnce()
  await expect(reader.read()).rejects.toThrow('destroyed')
  expect(gpu.copy).toHaveBeenCalledTimes(8)
})

it('rejects in-flight and queued snapshots after disposal without copying into a destroyed buffer', async () => {
  const gpu = gpuFixture()
  const reader = createGummyDynamicReadback(gpu.device, gpu.sources, 2)
  let complete!: () => void
  gpu.deferMap(
    new Promise<void>((resolve) => {
      complete = resolve
    }),
  )
  const first = reader.read(),
    second = reader.read()
  const rejected = Promise.all([
    expect(first).rejects.toThrow('destroyed'),
    expect(second).rejects.toThrow('destroyed'),
  ])
  await Promise.resolve()
  reader.destroy()
  complete()
  await rejected
  expect(gpu.copy).toHaveBeenCalledTimes(4)
  expect(gpu.staging.unmap).toHaveBeenCalledOnce()
  expect(gpu.staging.destroy).toHaveBeenCalledOnce()
})
