/** A real tensile split must roll back topology and damage history when GPU replacement allocation fails. */
import { expect, it, vi } from 'vitest'
import { createGummyFractureRuntime } from './gummyFractureRuntime'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'

it('retries the same real fracture after allocation failure and resets its committed replacement', async () => {
  const mesh: GummyMesh = {
    positions: new Float32Array([
      0,
      0,
      0,
      0.5,
      1,
      0,
      0,
      1 / 3,
      0,
      1,
      0,
      0.25,
      0,
      0,
      1,
      0.2,
      0,
      0,
      -1,
      1 / 6,
    ]),
    tetrahedra: new Uint32Array([0, 1, 2, 3, 0, 2, 1, 4]),
    interfaces: new Uint32Array(),
    surface: new Uint32Array(),
    restNormals: new Float32Array(20),
    nodeRegions: new Uint32Array(5),
    spacing: 0.14,
    restVolume: 1 / 3,
    bounds: { min: [0, 0, -1], max: [1, 1, 1] },
    demoGrip: { center: [0, 0, 1], radius: 0.3, pull: [0, 0, 1] },
  }
  const stretched = mesh.positions.slice()
  for (let z = 2; z < stretched.length; z += 4) stretched[z]! *= 3
  const pair = () => ({
    solver: {
      snapshotDynamic: () => Promise.resolve({ positions: stretched }),
      reset: vi.fn(),
      destroy: vi.fn(),
    },
    renderer: { destroy: vi.fn() },
  })
  const original = pair(),
    replacement = pair(),
    resetPair = pair()
  const allocate = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('Replacement GPU allocation failed')
    })
    .mockReturnValueOnce(replacement)
    .mockReturnValueOnce(resetPair)
  const commit = vi.fn()
  const runtime = createGummyFractureRuntime<
    { positions: Float32Array },
    typeof original
  >(mesh, original, allocate, commit)
  const initial = runtime.topology(),
    options = { tearing: true, softness: 0.55 }
  await expect(runtime.check(1, options)).rejects.toThrow('GPU allocation')
  expect(runtime.topology()).toEqual(initial)
  expect(runtime.diagnostics).toMatchObject({
    topologyVersion: 0,
    brokenFaceCount: 0,
    vertexCount: 5,
  })
  expect(runtime.diagnostics.components).toHaveLength(1)
  expect(original.solver.destroy).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()

  await runtime.check(1, options)
  expect(runtime.diagnostics).toMatchObject({
    topologyVersion: 1,
    brokenFaceCount: 1,
    vertexCount: 8,
  })
  expect(runtime.diagnostics.components).toHaveLength(2)
  expect(runtime.topology().failedFaces).toHaveLength(1)
  expect(original.solver.destroy).toHaveBeenCalledOnce()
  expect(commit).toHaveBeenCalledOnce()

  runtime.reset()
  expect(runtime.topology()).toEqual(initial)
  expect(replacement.solver.destroy).toHaveBeenCalledOnce()
  expect(runtime.diagnostics.components).toHaveLength(1)
  runtime.destroy()
  expect(resetPair.solver.destroy).toHaveBeenCalledOnce()
})
