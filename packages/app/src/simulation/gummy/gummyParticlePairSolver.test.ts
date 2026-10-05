/** The pair shares transfer kernels while keeping body state, material fields and resource ownership independent. */
import { d } from 'typegpu'
import { describe, expect, it, vi } from 'vitest'
import { GUMMY_PARTICLE_OUTER_DT } from './gummyParticleMath'
import { gummyParticlePairContact, gummyParticlePairProximity, } from './gummyParticlePairShaders'
import { createGummyParticlePairSolver } from './gummyParticlePairSolver'
import { gummyParticleG2P, gummyParticleGridUpdate, gummyParticleP2G, GummyParticleParameters, } from './gummyParticleShaders'
import type { TgpuRoot } from 'typegpu'

function setup(failAt = Infinity) {
  const buffers: {
    schema: unknown
    data: ArrayBuffer
    write: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }[] = []
  const dispatches: unknown[] = []
  const device = {
    createCommandEncoder: () => ({
      clearBuffer: vi.fn(),
      beginComputePass: () => ({ end: vi.fn() }),
      finish: () => ({}),
    }),
    queue: { submit: vi.fn() },
  }
  const root = {
    device,
    createBuffer(schema: Parameters<typeof d.sizeOf>[0], initial?: unknown) {
      if (buffers.length === failAt)
        throw new Error('Fixture allocation failed')
      const data = new ArrayBuffer(d.sizeOf(schema))
      const buffer = {
        schema,
        data,
        destroy: vi.fn(),
        write: vi.fn((source: ArrayBuffer) => {
          new Uint8Array(data).set(new Uint8Array(source))
        }),
        $usage: () => buffer,
      }
      buffers.push(buffer)
      if (typeof initial === 'function') initial(buffer)
      return buffer
    },
    createBindGroup: (_layout: unknown, bindings: unknown) => bindings,
    createComputePipeline: ({ compute }: { compute: unknown }) => {
      const pipeline = {
        with: () => pipeline,
        dispatchWorkgroups: () => {
          dispatches.push(compute)
        },
      }
      return pipeline
    },
    unwrap: (resource: unknown) => resource,
  }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    submit: device.queue.submit,
    buffers,
    dispatches,
  }
}

describe('particle pair ownership', () => {
  it('keeps mould-local dye, separate positions and a containing common grid', () => {
    const gpu = setup(),
      pair = createGummyParticlePairSolver(gpu.root, gpu.device)
    expect(pair.pawn.positions).not.toBe(pair.rook.positions)
    expect(pair.pawn.kernels.gridVelocities).not.toBe(
      pair.rook.kernels.gridVelocities,
    )
    expect(pair.pawn.gridBounds).toEqual(pair.rook.gridBounds)
    expect(
      pair.rook.initialPositions[0]! - pair.rook.restPositions[0]!,
    ).toBeCloseTo(-3.2)
    for (const body of [pair.pawn, pair.rook])
      for (let i = 0; i < body.initialPositions.length; i += 4)
        for (let axis = 0; axis < 3; axis++) {
          expect(body.initialPositions[i + axis]!).toBeGreaterThan(
            body.gridBounds.min[axis]! + body.gridSpacing * 0.51,
          )
          expect(body.initialPositions[i + axis]!).toBeLessThan(
            body.gridBounds.max[axis]! - body.gridSpacing * 1.51,
          )
        }
    pair.destroy()
  })

  it('couples grids before either G2P and guides only rook base material without overwriting positions', () => {
    const gpu = setup(),
      pair = createGummyParticlePairSolver(gpu.root, gpu.device, {
        spacing: 0.12,
      })
    const positions = gpu.buffers.find(
      (buffer) => buffer === (pair.rook.positions as unknown),
    )!
    const positionWrites = positions.write.mock.calls.length
    expect(
      pair.step(GUMMY_PARTICLE_OUTER_DT, {
        softness: 0.55,
        tearing: true,
        particleMaterial: 'warm',
        rookGuide: { position: [-3.2, 0.5, 0], velocity: [0, 1, 0] },
      }),
    ).toBe(1)
    const transfers = gpu.dispatches.filter((compute) => compute !== undefined)
    const firstP2G = transfers.indexOf(gummyParticleP2G)
    expect(transfers.slice(firstP2G, firstP2G + 8)).toEqual([
      gummyParticleP2G,
      gummyParticleP2G,
      gummyParticlePairProximity,
      gummyParticleGridUpdate,
      gummyParticleGridUpdate,
      gummyParticlePairContact,
      gummyParticleG2P,
      gummyParticleG2P,
    ])
    const uniforms = gpu.buffers.filter(
      (buffer) => buffer.schema === GummyParticleParameters,
    )
    const pawn = new Float32Array(uniforms[0]!.data),
      rook = new Float32Array(uniforms[1]!.data)
    expect([...pawn.slice(0, 11)]).toEqual([...rook.slice(0, 11)])
    expect([...pawn.slice(52)]).toEqual([0, 0, 0, 0])
    expect(rook[53]).toBe(1)
    expect(rook[55]).toBeCloseTo(0.36)
    expect(positions.write.mock.calls.length).toBe(positionWrites)
    pair.destroy()
    pair.destroy()
    expect(
      gpu.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true)
    expect(
      pair.step(GUMMY_PARTICLE_OUTER_DT, { softness: 0.55, tearing: true }),
    ).toBe(0)
  })

  it('releases the first body when allocating the second fails', () => {
    const gpu = setup(12)
    expect(() => createGummyParticlePairSolver(gpu.root, gpu.device)).toThrow(
      'allocation failed',
    )
    expect(
      gpu.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true)
  })

  it('rejects invalid guidance and friction before submitting work', async () => {
    const gpu = setup(),
      pair = createGummyParticlePairSolver(gpu.root, gpu.device)
    expect(() =>
      pair.step(GUMMY_PARTICLE_OUTER_DT, {
        softness: 0.55,
        tearing: true,
        friction: NaN,
      }),
    ).toThrow('friction')
    expect(() =>
      pair.step(GUMMY_PARTICLE_OUTER_DT, {
        softness: 0.55,
        tearing: true,
        rookGuide: { position: [0, 0, 0], velocity: [0, 99, 0] },
      }),
    ).toThrow('speed')
    expect(gpu.submit).not.toHaveBeenCalled()
    pair.destroy()
    await expect(pair.readState()).rejects.toThrow('destroyed')
  })
})
