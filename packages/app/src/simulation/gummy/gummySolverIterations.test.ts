/** Convergence options control real solver dispatches without changing legacy defaults. */
import { afterEach, expect, it, vi } from 'vitest'
import { gummySolveJellyTets } from './gummyJellyShaders'
import { createGummySolver, GUMMY_FIXED_DT, GUMMY_SOLVER_ITERATIONS, } from './gummySolver'
import { gummyContactRetention, gummyFinish, GummyParameters, gummyPredict, gummySolveTets, } from './gummySolverShaders'
import type { TgpuRoot } from 'typegpu'

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
  tetrahedra: new Uint32Array([0, 1, 2, 3]),
  interfaces: new Uint32Array(),
}

function gpuFixture(readVector = { x: 0, y: 0, z: 0, w: 1 }, readCount = 4) {
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 })
  const dispatches = new Map<unknown, number>()
  const uniformWrites: Float32Array[] = []
  const clearBuffer = vi.fn()
  const device = {
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createCommandEncoder: () => ({
      clearBuffer,
      beginComputePass: () => ({ end: vi.fn() }),
      finish: () => ({}),
    }),
    queue: { submit: vi.fn() },
  }
  const root = {
    device,
    createBuffer: vi.fn((_schema: unknown, initial?: unknown) => {
      const buffer = {
        destroy: vi.fn(),
        write: vi.fn((value: ArrayBuffer) => {
          if (_schema === GummyParameters)
            uniformWrites.push(new Float32Array(value.slice(0)))
        }),
        read: () =>
          Promise.resolve(
            Array.from({ length: readCount }, () => ({ ...readVector })),
          ),
        $usage: () => buffer,
      }
      if (typeof initial === 'function') initial(buffer)
      return buffer
    }),
    createBindGroup: () => ({}),
    createComputePipeline: ({ compute }: { compute: unknown }) => {
      const pipeline = {
        with: () => pipeline,
        dispatchWorkgroups: () =>
          dispatches.set(compute, (dispatches.get(compute) ?? 0) + 1),
      }
      return pipeline
    },
    unwrap: (resource: unknown) => resource,
  }
  return {
    root: root as unknown as TgpuRoot,
    device: device as unknown as GPUDevice,
    dispatches,
    createBuffer: root.createBuffer,
    uniformWrites,
    clearBuffer,
  }
}

afterEach(() => vi.unstubAllGlobals())

it.each([undefined, 1, 36, 96])(
  'uses the selected jelly convergence budget %s for every step',
  (jellyIterations) => {
    const gpu = gpuFixture()
    const solver = createGummySolver(gpu.root, gpu.device, mesh, {
      materialModel: 'neo-hookean',
      jellyIterations,
    })
    const expected = jellyIterations ?? 24
    expect(solver.iterations).toBe(expected)
    expect(solver.jellyIterations).toBe(expected)
    expect(
      solver.step(GUMMY_FIXED_DT, { softness: 0.55, tearing: false }),
    ).toBe(1)
    expect(gpu.dispatches.get(gummySolveJellyTets)).toBe(expected)
    solver.reset()
    expect(solver.step(GUMMY_FIXED_DT, { softness: 1, tearing: true })).toBe(1)
    expect(gpu.dispatches.get(gummySolveJellyTets)).toBe(expected * 2)
    expect(solver.iterations).toBe(expected)
    expect(gpu.dispatches.has(gummySolveTets)).toBe(false)
    solver.destroy()
  },
)

it('keeps the legacy solver budget when a jelly-only option is supplied', () => {
  const gpu = gpuFixture()
  const solver = createGummySolver(gpu.root, gpu.device, mesh, {
    jellyIterations: 36,
    jellySubsteps: 2,
  })
  solver.step(GUMMY_FIXED_DT, { softness: 0.55, tearing: true })
  expect(gpu.dispatches.get(gummySolveTets)).toBe(GUMMY_SOLVER_ITERATIONS)
  expect(solver.iterations).toBe(GUMMY_SOLVER_ITERATIONS)
  expect(solver.jellyIterations).toBeUndefined()
  expect(solver.jellySubsteps).toBeUndefined()
  expect(gpu.dispatches.get(gummyPredict)).toBe(1)
  expect(gpu.uniformWrites.at(-1)![0]).toBe(Math.fround(GUMMY_FIXED_DT))
  expect(gpu.dispatches.has(gummySolveJellyTets)).toBe(false)
  solver.destroy()
})

it('preserves legacy cohesive-force units when jelly-only temporal options are supplied', async () => {
  const cohesive = {
    ...mesh,
    positions: Float32Array.from([
      ...mesh.positions,
      ...mesh.positions.map((value, index) => (index === 14 ? -value : value)),
    ]),
    tetrahedra: new Uint32Array([0, 1, 2, 3, 4, 6, 5, 7]),
    interfaces: new Uint32Array([0, 4, 1, 5, 2, 6, 0, 0]),
  }
  // A known 0.005 multiplier norm at 1/120 s corresponds to a force of72
  // study units. Reading it must not use the ignored jelly substep option.
  const gpu = gpuFixture({ x: 0.003, y: 0.004, z: 0, w: 1 }, 8)
  const solver = createGummySolver(gpu.root, gpu.device, cohesive, {
    jellySubsteps: 2,
  })
  solver.step(GUMMY_FIXED_DT, { softness: 0.55, tearing: false })
  const state = await solver.readState()
  expect(state.maxCohesiveForce).toBeCloseTo(72, 10)
  expect([...state.cohesiveForces]).toEqual([72])
  expect(gpu.uniformWrites.at(-1)![0]).toBe(Math.fround(GUMMY_FIXED_DT))
  solver.destroy()

  const jellyGpu = gpuFixture()
  expect(() =>
    createGummySolver(jellyGpu.root, jellyGpu.device, cohesive, {
      materialModel: 'neo-hookean',
      jellySubsteps: 2,
    }),
  ).toThrow('without cohesive interfaces')
  expect(jellyGpu.createBuffer).not.toHaveBeenCalled()
})

it.each([0, -1, 1.5, 97, NaN, Infinity])(
  'rejects invalid jelly iteration budget %s before GPU allocation',
  (jellyIterations) => {
    const gpu = gpuFixture()
    expect(() =>
      createGummySolver(gpu.root, gpu.device, mesh, {
        materialModel: 'neo-hookean',
        jellyIterations,
      }),
    ).toThrow('between 1 and 96')
    expect(gpu.createBuffer).not.toHaveBeenCalled()
  },
)

it.each([undefined, 1, 2, 8])(
  'uses %s internal substeps without changing logical time or press velocity',
  async (jellySubsteps) => {
    const gpu = gpuFixture()
    const solver = createGummySolver(gpu.root, gpu.device, mesh, {
      materialModel: 'neo-hookean',
      jellyIterations: 24,
      jellySubsteps,
    })
    const microsteps = jellySubsteps ?? 1
    const input = {
      softness: 0.55,
      tearing: false,
      press: { height: 2, halfExtent: 2 },
    }
    expect(solver.step(GUMMY_FIXED_DT / 2, input)).toBe(0)
    expect(gpu.dispatches.size).toBe(0)
    expect(solver.step(GUMMY_FIXED_DT / 2, input)).toBe(1)
    expect((await solver.readState()).simulationTime).toBe(GUMMY_FIXED_DT)
    expect(
      solver.step(GUMMY_FIXED_DT * 2, {
        ...input,
        press: { height: 1.99, halfExtent: 2 },
      }),
    ).toBe(2)
    expect(gpu.dispatches.get(gummyPredict)).toBe(microsteps * 3)
    expect(gpu.dispatches.get(gummyFinish)).toBe(microsteps * 3)
    expect(gpu.dispatches.get(gummySolveJellyTets)).toBe(microsteps * 3 * 24)
    expect(gpu.clearBuffer).toHaveBeenCalledTimes(microsteps * 3 * 2)
    expect(solver.jellySubsteps).toBe(microsteps)
    const state = await solver.readState()
    expect(state.jellySubsteps).toBe(microsteps)
    expect(state.simulationTime).toBe(GUMMY_FIXED_DT * 3)
    const parameters = gpu.uniformWrites.at(-1)!
    expect(parameters[0]).toBe(Math.fround(GUMMY_FIXED_DT / microsteps))
    expect(parameters[23]).toBeCloseTo(-0.6, 6)
    solver.reset()
    expect((await solver.readState()).simulationTime).toBe(0)
    expect(solver.step(GUMMY_FIXED_DT, input)).toBe(1)
    expect(gpu.uniformWrites.at(-1)![23]).toBe(0)
    solver.destroy()
  },
)

it.each([0, -1, 1.5, 9, NaN, Infinity])(
  'rejects invalid internal jelly substeps %s before allocating GPU resources',
  (jellySubsteps) => {
    const gpu = gpuFixture()
    expect(() =>
      createGummySolver(gpu.root, gpu.device, mesh, {
        materialModel: 'neo-hookean',
        jellySubsteps,
      }),
    ).toThrow('between 1 and 8')
    expect(gpu.createBuffer).not.toHaveBeenCalled()
  },
)

it.each([0.82, 0.85])(
  'retains contact damping %s over equal elapsed time at every substep count',
  (retention) => {
    expect(gummyContactRetention(retention, GUMMY_FIXED_DT)).toBeCloseTo(
      retention,
      7,
    )
    for (const count of [2, 4, 8])
      expect(
        gummyContactRetention(retention, GUMMY_FIXED_DT / count) ** count,
      ).toBeCloseTo(retention, 6)
  },
)
