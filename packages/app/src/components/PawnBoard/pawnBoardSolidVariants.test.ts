/** Solid GPU ownership, transactional replacements and instance batching without a device. */
import { describe, expect, it, vi } from 'vitest'
import { writeInstance } from './pawnBoardInstances'
import { createPawnBoardSolidVariants } from './pawnBoardSolidVariants'
import type { TgpuBindGroup, TgpuRenderPass, TgpuRoot } from 'typegpu'
import type { cameraLayout } from './pawnBoardShaders'
import type { BoardPawnInstance } from './pawnBoardTypes'

function harness() {
  const buffers: {
    write: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }[] = []
  const draws = vi.fn()
  let failAfter = Infinity
  const pipeline = { with: () => pipeline, draw: draws }
  const createPipeline = vi.fn(() => pipeline)
  const root = {
    createRenderPipeline: createPipeline,
    unwrap: vi.fn(),
    createBuffer() {
      if (failAfter-- === 0) {
        failAfter = Infinity
        throw new Error('allocation failed')
      }
      const buffer = { write: vi.fn(), destroy: vi.fn(), $usage: () => buffer }
      buffers.push(buffer)
      return buffer
    },
  } as unknown as TgpuRoot
  const manager = createPawnBoardSolidVariants(
    root,
    {} as TgpuBindGroup<typeof cameraLayout.entries>,
    writeInstance,
  )
  return {
    manager,
    buffers,
    draws,
    createPipeline,
    fail: (count: number) => {
      failAfter = count
    },
  }
}

const triangle = () =>
  new Float32Array([
    0, 0, 0, 0, 0, 1, 0.2, 0.5, 0.8, 0, 0.3, 0, 0.5, 0.8, 0.2, 1, 2, 0, 0.3,
    0.2, 0, 0, 0, 0, 1, 0.2, 0.5, 0.8, 0, 0.3, 0, 0.5, 0.8, 0.2, 1, 2, 0, 0.3,
    0, 0.2, 0, 0, 0, 1, 0.2, 0.5, 0.8, 0, 0.3, 0, 0.5, 0.8, 0.2, 1, 2, 0, 0.3,
  ])
const piece = (key = 'rook'): BoardPawnInstance => ({
  solidKey: key,
  cloudKey: 'rook:light',
  age: -1,
  position: [0, 0.09, 0],
  side: 'light',
  selected: false,
  scale: 0.9,
  colorMultiplier: [1, 1, 1],
})

describe('solid mesh variants', () => {
  it('compiles only on first selection and can retry failed pipeline creation without buffers', () => {
    const { manager, buffers, createPipeline } = harness()
    expect(createPipeline).not.toHaveBeenCalled()
    createPipeline.mockImplementationOnce(() => {
      throw new Error('pipeline failed')
    })
    expect(() => {
      manager.set('rook', triangle())
    }).toThrow('pipeline failed')
    expect(buffers).toHaveLength(0)
    manager.set('rook', triangle())
    manager.set('dark-rook', triangle())
    expect(createPipeline).toHaveBeenCalledTimes(2)
    expect(buffers).toHaveLength(4)
    manager.clear()
  })

  it('uploads only the supplied view and reuses two buffers through deterministic seeks', () => {
    const { manager, buffers, draws } = harness()
    const backing = new Float32Array(57 + 8)
    backing.set(triangle(), 4)
    manager.set('rook', backing.subarray(4, 61))
    expect(buffers).toHaveLength(2)
    expect(
      new Float32Array(buffers[0]!.write.mock.calls[0]![0] as ArrayBuffer),
    ).toEqual(triangle())
    for (const age of [-1, 0.8, 0.2, 0.8]) {
      manager.prepare([
        { ...piece(), age },
        { ...piece(), age, position: [1.6, 0.09, 0] },
      ])
      manager.write()
      manager.draw({} as TgpuRenderPass)
      const data = new Float32Array(
        buffers[1]!.write.mock.calls.at(-1)![0] as ArrayBuffer,
      )
      expect(data[8]).toBeCloseTo(age, 6)
      expect(data[3]).toBeCloseTo(0.9, 6)
      expect(draws).toHaveBeenLastCalledWith(3, 2)
    }
    expect(buffers).toHaveLength(2)
    manager.clear()
    manager.clear()
    for (const buffer of buffers)
      expect(buffer.destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps the old mesh when its replacement allocation fails', () => {
    const { manager, buffers, fail, draws } = harness()
    manager.set('rook', triangle())
    fail(1)
    expect(() => {
      manager.set('rook', triangle())
    }).toThrow('allocation failed')
    expect(buffers[0]!.destroy).not.toHaveBeenCalled()
    expect(buffers[1]!.destroy).not.toHaveBeenCalled()
    expect(buffers[2]!.destroy).toHaveBeenCalledTimes(1)
    manager.prepare([piece()])
    manager.write()
    manager.draw({} as TgpuRenderPass)
    expect(draws).toHaveBeenLastCalledWith(3, 1)
    manager.set('rook', triangle())
    expect(buffers[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(buffers[1]!.destroy).toHaveBeenCalledTimes(1)
    manager.clear()
  })

  it('bounds meshes, instances and invalid input before submission', () => {
    const { manager } = harness()
    for (const vertices of [
      new Float32Array(),
      new Float32Array(58),
      new Float32Array(120_003 * 19),
    ])
      expect(() => {
        manager.set('rook', vertices)
      }).toThrow('finite packed triangles')
    const invalid = triangle()
    invalid[0] = NaN
    expect(() => {
      manager.set('rook', invalid)
    }).toThrow('finite packed triangles')
    invalid.set(triangle())
    invalid[5] = 0
    expect(() => {
      manager.set('rook', invalid)
    }).toThrow('normals')
    invalid.set(triangle())
    invalid[6] = 1.1
    expect(() => {
      manager.set('rook', invalid)
    }).toThrow('colour')
    invalid.set(triangle())
    invalid[18] = 0
    expect(() => {
      manager.set('rook', invalid)
    }).toThrow('support radius')
    expect(() => {
      manager.set(' ', triangle())
    }).toThrow('nonempty key')
    manager.set('rook', triangle())
    manager.set('dark-rook', triangle())
    expect(() => {
      manager.set('third', triangle())
    }).toThrow('capacity')
    expect(() => {
      manager.prepare([piece('missing')])
    }).toThrow('Missing')
    expect(() => {
      manager.prepare([{ ...piece(), age: Infinity }])
    }).toThrow('finite')
    expect(() => {
      manager.prepare(Array.from({ length: 33 }, () => piece()))
    }).toThrow('capacity')
    manager.clear()
  })
})
