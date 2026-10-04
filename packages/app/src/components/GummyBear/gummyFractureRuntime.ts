/** Transactional ownership for a continuous jelly topology replacement and stale readback cancellation. */
import { createGummyJellyFracture } from '@/simulation/gummy/gummyJellyFracture'
import type { JellyPlasticState } from '@/simulation/gummy/gummyJellyPlasticity'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'

type DynamicSnapshot = {
  positions: Float32Array
  jellyPlasticState?: JellyPlasticState
}
type RuntimePair<Snapshot extends DynamicSnapshot> = {
  solver: {
    snapshotDynamic: () => Promise<Snapshot>
    reset: () => void
    destroy: () => void
    updatePlasticity?: (
      positions: Float32Array,
      elapsedSeconds: number,
      settings: { softness: number; fragility?: number },
    ) => {
      state: JellyPlasticState
      equivalentPlasticStrain: Float32Array
      plasticIncrement: Float32Array
    }
    restorePlasticity?: (saved?: JellyPlasticState) => void
  }
  renderer: { destroy: () => void }
}

function emptyProfile() {
  return {
    checks: 0,
    splits: 0,
    snapshotMs: 0,
    checkpointMs: 0,
    assessMs: 0,
    allocateMs: 0,
    commitMs: 0,
    totalMs: 0,
    maxCheckMs: 0,
  }
}

/** The caller blocks simulation while pending and restores the complete snapshot before returning a new pair. */
export function createGummyFractureRuntime<
  Snapshot extends DynamicSnapshot,
  Pair extends RuntimePair<Snapshot>,
>(
  initialMesh: GummyMesh,
  initialPair: Pair,
  allocate: (
    mesh: GummyMesh,
    snapshot?: Snapshot,
    sourceNodes?: Uint32Array,
  ) => Pair,
  onCommit: (pair: Pair, mesh: GummyMesh) => void,
) {
  const fracture = createGummyJellyFracture(initialMesh)
  let pair = initialPair
  let mesh = initialMesh
  let generation = 0
  let disposed = false
  let pending: Promise<void> | undefined
  let profile = emptyProfile()

  function disposePair(value: Pair) {
    value.renderer.destroy()
    value.solver.destroy()
  }

  function replace(
    nextMesh: GummyMesh,
    snapshot?: Snapshot,
    sourceNodes?: Uint32Array,
    timing?: ReturnType<typeof emptyProfile>,
  ) {
    // allocate owns rollback of partial construction. No live reference changes until it succeeds.
    const started = globalThis.performance.now()
    const next = allocate(nextMesh, snapshot, sourceNodes)
    const allocated = globalThis.performance.now()
    if (timing) timing.allocateMs += allocated - started
    const previous = pair
    pair = next
    mesh = nextMesh
    onCommit(pair, mesh)
    disposePair(previous)
    if (timing) timing.commitMs += globalThis.performance.now() - allocated
  }

  function check(
    elapsedSeconds: number,
    settings: {
      tearing: boolean
      softness: number
      fragility?: number
      tearResponse?: 'soft' | 'crumble'
    },
  ) {
    const soft = settings.tearResponse === 'soft'
    if (disposed || (!settings.tearing && !soft)) return Promise.resolve()
    if (pending) return pending
    const token = generation
    const captured = pair
    const timing = profile
    const started = globalThis.performance.now()
    timing.checks++
    const work = (async () => {
      try {
        const snapshot = await captured.solver.snapshotDynamic()
        timing.snapshotMs += globalThis.performance.now() - started
        if (disposed || token !== generation) return
        const checkpointStarted = globalThis.performance.now()
        const checkpoint = fracture.checkpoint()
        const previousPlasticState = snapshot.jellyPlasticState
        timing.checkpointMs += globalThis.performance.now() - checkpointStarted
        try {
          const assessStarted = globalThis.performance.now()
          if (
            soft &&
            (!captured.solver.updatePlasticity ||
              !captured.solver.restorePlasticity)
          )
            throw new Error('Soft tearing requires reversible plastic state')
          const plastic = soft
            ? captured.solver.updatePlasticity?.(
                snapshot.positions,
                elapsedSeconds,
                settings,
              )
            : undefined
          if (plastic) snapshot.jellyPlasticState = plastic.state
          const split = fracture.assess(snapshot.positions, elapsedSeconds, {
            ...settings,
            response: settings.tearResponse,
            plasticStrain: plastic?.equivalentPlasticStrain,
            plasticGradients: plastic?.state.gradients,
            plasticIncrement: plastic?.plasticIncrement,
          })
          timing.assessMs += globalThis.performance.now() - assessStarted
          if (split) {
            replace(split.mesh, snapshot, split.sourceNodes, timing)
            timing.splits++
          }
        } catch (error) {
          fracture.restore(checkpoint)
          if (soft) captured.solver.restorePlasticity?.(previousPlasticState)
          throw error
        }
      } catch (error) {
        if (!disposed && token === generation) throw error
      } finally {
        const elapsed = globalThis.performance.now() - started
        timing.totalMs += elapsed
        timing.maxCheckMs = Math.max(timing.maxCheckMs, elapsed)
      }
    })()
    pending = work.finally(() => {
      if (pending === tracked) pending = undefined
    })
    const tracked = pending
    return pending
  }

  return {
    check,
    reset() {
      if (disposed) return
      generation++
      if (mesh === initialMesh) pair.solver.reset()
      else replace(initialMesh)
      fracture.reset()
      profile = emptyProfile()
    },
    destroy() {
      if (disposed) return
      disposed = true
      generation++
      disposePair(pair)
    },
    get pending() {
      return pending
    },
    get generation() {
      return generation
    },
    get diagnostics() {
      return fracture.diagnostics
    },
    get profile() {
      return { ...profile }
    },
    topology() {
      return {
        restPositions: mesh.positions.slice(),
        tetrahedra: mesh.tetrahedra.slice(),
        surface: mesh.surface.slice(),
        restNormals: mesh.restNormals.slice(),
        nodeRegions: mesh.nodeRegions.slice(),
        originalNodeIds: fracture.originalNodeIds.slice(),
        nodeMasses: fracture.nodeMasses.slice(),
        restVolume: mesh.restVolume,
        initialVertexCount: initialMesh.positions.length / 4,
        failedFaces: Array.from(fracture.failedFaceIds),
        revision: fracture.diagnostics.topologyVersion,
      }
    },
  }
}
