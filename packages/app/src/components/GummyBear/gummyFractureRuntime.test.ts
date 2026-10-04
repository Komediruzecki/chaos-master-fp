/** Delayed fracture readbacks must never rewind reset state or leak a partially replaced GPU pair. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGummyFractureRuntime } from './gummyFractureRuntime'
import type { JellyPlasticState } from '@/simulation/gummy/gummyJellyPlasticity'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'

const control = vi.hoisted(() => ({
  assess: vi.fn(),
  reset: vi.fn(),
  checkpoint: vi.fn(),
  restore: vi.fn(),
}))
vi.mock('@/simulation/gummy/gummyJellyFracture', () => ({
  createGummyJellyFracture(mesh: GummyMesh) {
    return {
      assess: control.assess,
      reset: control.reset,
      checkpoint: control.checkpoint,
      restore: control.restore,
      originalNodeIds: Uint32Array.from(
        { length: mesh.positions.length / 4 },
        (_, id) => id,
      ),
      nodeMasses: new Float64Array(mesh.positions.length / 4).fill(1),
      failedFaceIds: new Uint32Array(0),
      diagnostics: { topologyVersion: 0 },
    }
  },
}))

const mesh: GummyMesh = {
  positions: new Float32Array([0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
  tetrahedra: new Uint32Array([0, 1, 2, 3]),
  interfaces: new Uint32Array(0),
  surface: new Uint32Array([
    1, 2, 3, 0xffffffff, 0, 3, 2, 0xffffffff, 0, 1, 3, 0xffffffff, 0, 2, 1,
    0xffffffff,
  ]),
  restNormals: new Float32Array(16),
  nodeRegions: new Uint32Array(4),
  spacing: 1,
  restVolume: 1 / 6,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  demoGrip: { center: [0, 1, 0], radius: 0.2, pull: [1, 0, 0] },
}
type Snapshot = {
  positions: Float32Array
  velocities: Float32Array
  time: number
  jellyPlasticState?: JellyPlasticState
}

function pair(snapshot?: Promise<Snapshot>) {
  return {
    solver: {
      snapshotDynamic: vi.fn(
        () =>
          snapshot ??
          Promise.resolve({
            positions: mesh.positions.slice(),
            velocities: new Float32Array(16).fill(2),
            time: 4,
          }),
      ),
      reset: vi.fn(),
      destroy: vi.fn(),
    },
    renderer: { destroy: vi.fn() },
  }
}

function split() {
  const next = {
    ...mesh,
    positions: new Float32Array([...mesh.positions, 0, 0, 1, 1]),
    runtimeFracture: true,
  }
  return { mesh: next, sourceNodes: new Uint32Array([0, 1, 2, 3, 3]) }
}
beforeEach(() => {
  control.assess.mockReset()
  control.reset.mockReset()
  control.checkpoint.mockReset()
  control.restore.mockReset()
})

describe('transactional jelly fracture runtime', () => {
  it('restores through the source map before committing, then disposes exactly the previous pair', async () => {
    const original = pair()
    const next = pair()
    const event = split()
    control.assess.mockReturnValue(event)
    const allocate = vi.fn(() => next)
    const commit = vi.fn(() => {
      expect(original.solver.destroy).not.toHaveBeenCalled()
    })
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      allocate,
      commit,
    )
    const checking = runtime.check(0.05, { tearing: true, softness: 0.55 })
    expect(runtime.pending).toBeDefined()
    await checking
    expect(allocate).toHaveBeenCalledWith(
      event.mesh,
      expect.objectContaining({
        time: 4,
        velocities: expect.any(Float32Array),
      }),
      event.sourceNodes,
    )
    expect(commit).toHaveBeenCalledWith(next, event.mesh)
    expect(original.renderer.destroy).toHaveBeenCalledOnce()
    expect(original.solver.destroy).toHaveBeenCalledOnce()
    expect(next.solver.destroy).not.toHaveBeenCalled()
    expect(runtime.pending).toBeUndefined()
    runtime.destroy()
    runtime.destroy()
    expect(next.solver.destroy).toHaveBeenCalledOnce()
  })
  it('keeps live resources usable if replacement allocation fails', async () => {
    const original = pair()
    control.assess.mockReturnValue(split())
    const commit = vi.fn()
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      () => {
        throw new Error('No room for the replacement')
      },
      commit,
    )
    await expect(
      runtime.check(0.05, { tearing: true, softness: 0.55 }),
    ).rejects.toThrow('No room')
    expect(commit).not.toHaveBeenCalled()
    expect(original.solver.destroy).not.toHaveBeenCalled()
    runtime.destroy()
    expect(original.solver.destroy).toHaveBeenCalledOnce()
  })
  it('rejects a snapshot taken before reset rather than committing old deformation', async () => {
    let resolve!: (value: Snapshot) => void
    const snapshot = new Promise<Snapshot>((complete) => {
      resolve = complete
    })
    const original = pair(snapshot)
    const allocate = vi.fn(() => pair())
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      allocate,
      vi.fn(),
    )
    const checking = runtime.check(0.05, { tearing: true, softness: 0.55 })
    runtime.reset()
    resolve({
      positions: mesh.positions.slice(),
      velocities: new Float32Array(16),
      time: 4,
    })
    await checking
    expect(original.solver.reset).toHaveBeenCalledOnce()
    expect(control.reset).toHaveBeenCalledOnce()
    expect(control.assess).not.toHaveBeenCalled()
    expect(allocate).not.toHaveBeenCalled()
    expect(runtime.profile).toMatchObject({ checks: 0, totalMs: 0 })
    runtime.destroy()
  })
  it('discards a failed old readback after disposal without rebuilding or emitting an error', async () => {
    let reject!: (reason: Error) => void
    const original = pair(
      new Promise<Snapshot>((_resolve, fail) => {
        reject = fail
      }),
    )
    const allocate = vi.fn(() => pair())
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      allocate,
      vi.fn(),
    )
    const checking = runtime.check(0.05, { tearing: true, softness: 0.55 })
    runtime.destroy()
    reject(new Error('Buffer was destroyed'))
    await expect(checking).resolves.toBeUndefined()
    expect(allocate).not.toHaveBeenCalled()
    expect(original.solver.destroy).toHaveBeenCalledOnce()
  })
  it('does not read or accumulate fracture while disabled and exposes only copied topology arrays', async () => {
    const original = pair()
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      () => pair(),
      vi.fn(),
    )
    await runtime.check(0.05, { tearing: false, softness: 0.55 })
    expect(original.solver.snapshotDynamic).not.toHaveBeenCalled()
    expect(control.assess).not.toHaveBeenCalled()
    expect(runtime.profile.checks).toBe(0)
    const topology = runtime.topology()
    topology.restPositions[0] = 100
    topology.tetrahedra[0] = 100
    expect(mesh.positions[0]).toBe(0)
    expect(mesh.tetrahedra[0]).toBe(0)
    runtime.destroy()
  })
  it('reports copied phase timings for an enabled check and clears them on reset', async () => {
    const original = pair()
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      () => pair(),
      vi.fn(),
    )
    await runtime.check(0.05, { tearing: true, softness: 0.55 })
    const profile = runtime.profile
    expect(profile.checks).toBe(1)
    expect(profile.splits).toBe(0)
    expect(profile.totalMs).toBeGreaterThanOrEqual(profile.snapshotMs)
    expect(profile.totalMs).toBeGreaterThanOrEqual(profile.assessMs)
    expect(profile.maxCheckMs).toBe(profile.totalMs)
    expect(profile.allocateMs).toBe(0)
    profile.checks = 100
    expect(runtime.profile.checks).toBe(1)
    runtime.reset()
    expect(runtime.profile).toMatchObject({ checks: 0, totalMs: 0 })
    runtime.destroy()
  })
  it('forwards independent fragility settings to assessment without modifying the material snapshot', async () => {
    const original = pair()
    const runtime = createGummyFractureRuntime<Snapshot, typeof original>(
      mesh,
      original,
      () => pair(),
      vi.fn(),
    )
    const options = { tearing: true, softness: 0.55, fragility: 0.88 }
    await runtime.check(0.05, options)
    expect(control.assess).toHaveBeenCalledWith(mesh.positions, 0.05, options)
    expect(original.solver.destroy).not.toHaveBeenCalled()
    runtime.destroy()
  })

  it('updates soft material with tearing disabled and carries its yield state into assessment', async () => {
    const original = pair()
    const state = {
      gradients: new Float32Array(9),
      equivalentPlasticStrain: new Float32Array([0.12]),
    }
    const softPair = {
      ...original,
      solver: {
        ...original.solver,
        updatePlasticity: vi.fn(() => ({
          state,
          equivalentPlasticStrain: state.equivalentPlasticStrain,
          plasticIncrement: new Float32Array([0.02]),
        })),
        restorePlasticity: vi.fn(),
      },
    }
    const runtime = createGummyFractureRuntime<Snapshot, typeof softPair>(
      mesh,
      softPair,
      () => softPair,
      vi.fn(),
    )
    const options = {
      tearing: false,
      softness: 0.55,
      fragility: 0.88,
      tearResponse: 'soft' as const,
    }
    await runtime.check(0.05, options)
    expect(softPair.solver.updatePlasticity).toHaveBeenCalledWith(
      mesh.positions,
      0.05,
      options,
    )
    expect(control.assess).toHaveBeenCalledWith(
      mesh.positions,
      0.05,
      expect.objectContaining({
        tearing: false,
        response: 'soft',
        plasticStrain: state.equivalentPlasticStrain,
        plasticGradients: state.gradients,
        plasticIncrement: new Float32Array([0.02]),
      }),
    )
    expect(softPair.solver.restorePlasticity).not.toHaveBeenCalled()
    runtime.destroy()
  })

  it('transfers updated plastic memory across a split and rolls it back when allocation fails', async () => {
    const previous = {
      gradients: new Float32Array(9).fill(1),
      equivalentPlasticStrain: new Float32Array([0.01]),
    }
    const updated = {
      gradients: new Float32Array(9).fill(2),
      equivalentPlasticStrain: new Float32Array([0.12]),
    }
    const original = pair(
      Promise.resolve({
        positions: mesh.positions.slice(),
        velocities: new Float32Array(16),
        time: 4,
        jellyPlasticState: previous,
      }),
    )
    const softPair = {
      ...original,
      solver: {
        ...original.solver,
        updatePlasticity: vi.fn(() => ({
          state: updated,
          equivalentPlasticStrain: updated.equivalentPlasticStrain,
          plasticIncrement: new Float32Array([0.02]),
        })),
        restorePlasticity: vi.fn(),
      },
    }
    const event = split()
    control.assess.mockReturnValue(event)
    const checkpoint = { saved: true }
    control.checkpoint.mockReturnValue(checkpoint)
    const allocate = vi.fn((): typeof softPair => {
      throw new Error('Allocation failed')
    })
    const runtime = createGummyFractureRuntime<Snapshot, typeof softPair>(
      mesh,
      softPair,
      allocate,
      vi.fn(),
    )
    await expect(
      runtime.check(0.05, {
        tearing: true,
        softness: 0.55,
        tearResponse: 'soft',
      }),
    ).rejects.toThrow('Allocation failed')
    expect(allocate).toHaveBeenCalledWith(
      event.mesh,
      expect.objectContaining({ jellyPlasticState: updated }),
      event.sourceNodes,
    )
    expect(control.restore).toHaveBeenCalledWith(checkpoint)
    expect(softPair.solver.restorePlasticity).toHaveBeenCalledWith(previous)
    expect(softPair.solver.destroy).not.toHaveBeenCalled()
    runtime.destroy()
  })
})
