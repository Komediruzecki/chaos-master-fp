/** Live picks must read positions without waiting for material or fracture diagnostics. */
import { d } from 'typegpu'
import { afterEach, expect, it, vi } from 'vitest'
import { createGummyParticleSolver } from './gummyParticleSolver'
import { createGummySolver } from './gummySolver'
import type { TgpuRoot } from 'typegpu'

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
  tetrahedra: new Uint32Array([0, 1, 2, 3]),
  interfaces: new Uint32Array(),
}

function gpuFixture() {
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 })
  vi.stubGlobal('GPUMapMode', { READ: 1 })
  let readGate = Promise.resolve()
  const buffers: ReturnType<typeof buffer>[] = []
  const copy = vi.fn()

  function buffer(size: number) {
    const data = new ArrayBuffer(size)
    const result = {
      data,
      destroy: vi.fn(),
      write(value: ArrayBuffer) {
        new Uint8Array(data).set(new Uint8Array(value))
      },
      read: vi.fn(async () => {
        if (result !== buffers[0])
          throw new Error('A live pick must not read diagnostics')
        await readGate
        const packed = new Float32Array(data)
        return Array.from({ length: packed.length / 4 }, (_, i) =>
          d.vec4f(
            packed[i * 4]!,
            packed[i * 4 + 1]!,
            packed[i * 4 + 2]!,
            packed[i * 4 + 3]!,
          ),
        )
      }),
      mapAsync: vi.fn(() => readGate),
      getMappedRange: (offset = 0, count = size) =>
        data.slice(offset, offset + count),
      unmap: vi.fn(),
      $usage: () => result,
    }
    return result
  }

  const device = {
    createBuffer: ({ size }: GPUBufferDescriptor) => buffer(size),
    createCommandEncoder: () => ({
      copyBufferToBuffer(
        source: ReturnType<typeof buffer>,
        sourceOffset: number,
        target: ReturnType<typeof buffer>,
        targetOffset: number,
        size: number,
      ) {
        copy(source, sourceOffset, target, targetOffset, size)
        new Uint8Array(target.data).set(
          new Uint8Array(source.data, sourceOffset, size),
          targetOffset,
        )
      },
      finish: () => ({}),
    }),
    queue: { submit: vi.fn() },
  }
  const root = {
    device,
    createBuffer(schema: Parameters<typeof d.sizeOf>[0], initial?: unknown) {
      const result = buffer(d.sizeOf(schema))
      buffers.push(result)
      if (typeof initial === 'function') initial(result)
      return result
    },
    createBindGroup: () => ({}),
    createComputePipeline: () => {
      const pipeline = { with: () => pipeline }
      return pipeline
    },
    unwrap: (resource: unknown) => resource,
  }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    buffers,
    copy,
    deferRead() {
      let resolve!: () => void
      readGate = new Promise<void>((done) => {
        resolve = done
      })
      return resolve
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

function setup(model: 'legacy' | 'jelly' | 'particle') {
  const gpu = gpuFixture()
  const solver =
    model === 'particle'
      ? createGummyParticleSolver(gpu.root, gpu.device, { spacing: 0.12 })
      : createGummySolver(gpu.root, gpu.device, mesh, {
          materialModel: model === 'jelly' ? 'neo-hookean' : 'edge-volume',
        })
  return { gpu, solver }
}

it.each(['legacy', 'jelly', 'particle'] as const)(
  '%s picks copy current positions without reading any diagnostic buffers',
  async (model) => {
    const { gpu, solver } = setup(model)
    const current = new Float32Array(gpu.buffers[0]!.data)
    current.set([0.125, 1.75, -0.25, 1])
    const expected = current.slice()
    const result = await solver.readPositions()
    expect(result).toEqual(expected)
    expect(
      gpu.buffers
        .slice(1)
        .every((buffer) => buffer.read.mock.calls.length === 0),
    ).toBe(true)
    if (model === 'jelly') {
      expect(gpu.buffers[0]!.read).not.toHaveBeenCalled()
      expect(gpu.copy).toHaveBeenCalledOnce()
      expect(gpu.copy.mock.calls[0]![0]).toBe(gpu.buffers[0])
      expect(gpu.copy.mock.calls[0]![4]).toBe(current.byteLength)
    } else {
      expect(gpu.buffers[0]!.read).toHaveBeenCalledOnce()
      expect(gpu.copy).not.toHaveBeenCalled()
    }
    result[0] = 99
    expect(current[0]).toBe(0.125)
    solver.destroy()
    await expect(solver.readPositions()).rejects.toThrow('destroyed')
  },
)

it.each(['legacy', 'jelly', 'particle'] as const)(
  '%s rejects a position read that completes after disposal',
  async (model) => {
    const { gpu, solver } = setup(model)
    const complete = gpu.deferRead()
    const pending = solver.readPositions()
    await Promise.resolve()
    solver.destroy()
    const rejected = expect(pending).rejects.toThrow('destroyed')
    complete()
    await rejected
  },
)
