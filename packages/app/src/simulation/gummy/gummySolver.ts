/** Owned fixed-step WebGPU XPBD tetrahedra with progressive, irreversible cohesive tears. */
import { d } from 'typegpu'
import { GUMMY_CONTACT_BUCKETS, prepareGummyContacts } from './gummyContacts'
import { gummyJellyMaterial } from './gummyJelly'
import { createGummyJellyPlasticity } from './gummyJellyPlasticity'
import { prepareGummyPatches } from './gummyPatches'
import { GUMMY_FINE_SOLVER_ITERATIONS, GUMMY_FIXED_DT, GUMMY_SOLVER_ITERATIONS, gummyCohesiveStrength, gummyMaterial, normalizeGummyPress, } from './gummySolverMaterial'
import { gummySolverConvergence } from './gummySolverOptions'
import { prepareGummySolverGeometry } from './gummySolverPreparation'
import { createGummySolverResources } from './gummySolverResources'
import { GummyParameters } from './gummySolverShaders'
import { remapGummyDynamicState } from './gummySolverState'
import type { TgpuRoot } from 'typegpu'
import type { JellyPlasticState } from './gummyJellyPlasticity'
import type { GummySolverMesh, GummyStep } from './gummySolverContracts'
import type { GummySolverOptions } from './gummySolverOptions'
import type { GummySolverDynamicState } from './gummySolverState'

export type {
  GummySolverMesh,
  GummyGrip,
  GummyPress,
  GummyStep,
} from './gummySolverContracts'
export type { GummySolverDynamicState } from './gummySolverState'
export {
  GUMMY_FIXED_DT,
  GUMMY_SOLVER_ITERATIONS,
  GUMMY_FINE_SOLVER_ITERATIONS,
  gummyMaterial,
  gummyCohesiveStrength,
  normalizeGummyPress,
} from './gummySolverMaterial'
export { createGummyDynamicReadback } from './gummyDynamicReadback'
export {
  colorGummyConstraints,
  prepareGummyTets,
} from './gummySolverPreparation'
const MAX_SUBSTEPS = 6
export type { GummySolverOptions } from './gummySolverOptions'
export function createGummySolver(
  root: TgpuRoot,
  device: GPUDevice,
  mesh: GummySolverMesh,
  options: GummySolverOptions = {},
) {
  if (root.device !== device)
    throw new Error('Gummy solver root and device must match')
  const { jellyIterations, jellySubsteps } = gummySolverConvergence(options)
  const jelly = options.materialModel === 'neo-hookean'
  const prepared = options.preparationCache
    ? options.preparationCache.prepare(mesh, jelly, options.sourceNodes)
    : prepareGummySolverGeometry(mesh, jelly)
  const internalSubsteps = jelly ? jellySubsteps : 1
  const solverDt = GUMMY_FIXED_DT / internalSubsteps
  if (jelly && mesh.interfaces.length)
    throw new Error(
      'Continuous jelly requires an unsegmented mesh without cohesive interfaces',
    )
  const materialModel = jelly ? 'neo-hookean' : 'edge-volume'
  const restPositions = new Float32Array(mesh.positions)
  const contactGeometry = prepareGummyContacts(mesh)
  const patchGeometry = prepareGummyPatches(mesh)
  const vertexCount = mesh.positions.length / 4
  const tetCount = mesh.tetrahedra.length / 4
  const interfaceCount = mesh.interfaces.length / 8
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const {
      positions,
      previous,
      velocities,
      grip,
      dynamicReadback,
      tetLambda,
      bondLambda,
      damage,
      params,
      contactLabels,
      predict,
      capture,
      constrainGrip,
      finish,
      updateDamage,
      resetContacts,
      contactComponents,
      insertContacts,
      gatherContacts,
      completePatches,
      tetBatches,
      interfaceBatches,
      jellyRestTets,
      jellyTetData,
      jellyTets,
    } = createGummySolverResources(
      root,
      device,
      mesh,
      restPositions,
      prepared,
      jelly,
      contactGeometry,
      patchGeometry,
      own,
    )
    let plasticity: ReturnType<typeof createGummyJellyPlasticity> | undefined
    let accumulator = 0
    let disposed = false
    let gripping = false
    let gripKey = ''
    let simulationTime = 0
    let previousPressHeight: number | undefined
    let contactRan = false
    let solverIterations = jelly ? jellyIterations : GUMMY_SOLVER_ITERATIONS
    const uniformData = new ArrayBuffer(d.sizeOf(GummyParameters))
    const f32 = new Float32Array(uniformData)
    const u32 = new Uint32Array(uniformData)

    function writeParameters(input: GummyStep, count: number) {
      const material = jelly
        ? gummyJellyMaterial(input.softness)
        : gummyMaterial(input.softness, input.fractureMode)
      f32.set(
        [
          solverDt,
          material.stretchCompliance,
          material.volumeCompliance,
          material.damping,
        ],
        0,
      )
      f32.fill(0, 4, 12)
      if (input.grip) {
        f32.set(input.grip.center, 4)
        f32[7] = Math.max(0.001, input.grip.radius)
        f32.set(input.grip.target, 8)
        f32[11] = 1
      }
      u32.set(
        [vertexCount, tetCount, interfaceCount, contactGeometry.regionCount],
        12,
      )
      f32.set([input.tearing ? 1 : 0, 0.006, 0.11, 12], 16)
      f32.fill(0, 20, 28)
      const press = normalizeGummyPress(input.press)
      if (press) {
        const speed =
          previousPressHeight === undefined
            ? 0
            : Math.max(
                -1,
                Math.min(
                  1,
                  (press.height - previousPressHeight) /
                    (count * GUMMY_FIXED_DT),
                ),
              )
        f32.set([press.height, press.halfExtent, 1, speed], 20)
      }
      previousPressHeight = press?.height
      f32.set(
        [
          gummyCohesiveStrength(input.cohesiveStrength),
          input.fractureMode === 'tension-shear' ? 1 : 0,
          contactGeometry.separation,
          contactGeometry.separation * 0.25,
        ],
        24,
      )
      params.write(uniformData)
    }

    function projectConstraints(
      pass: GPUComputePassEncoder,
      iterations: number,
    ) {
      // Bind the pass once per color and microstep, rather than allocating
      // two TypeGPU pipeline wrappers and a binding Map on every iteration.
      const tetPasses = tetBatches.map((batch) => batch.pipeline.with(pass))
      const interfacePasses = interfaceBatches.map((batch) =>
        batch.pipeline.with(pass),
      )
      const gripPass = constrainGrip.with(pass)
      predict.with(pass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
      gripPass.dispatchWorkgroups(Math.ceil(vertexCount / 64))
      for (let iteration = 0; iteration < iterations; iteration++) {
        for (let batch = 0; batch < tetPasses.length; batch++)
          tetPasses[batch]!.dispatchWorkgroups(tetBatches[batch]!.count)
        for (let batch = 0; batch < interfacePasses.length; batch++)
          interfacePasses[batch]!.dispatchWorkgroups(
            interfaceBatches[batch]!.count,
          )
        gripPass.dispatchWorkgroups(Math.ceil(vertexCount / 64))
      }
      return gripPass
    }

    function step(dt: number, input: GummyStep) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return 0
      accumulator = Math.min(MAX_SUBSTEPS * GUMMY_FIXED_DT, accumulator + dt)
      const count = Math.floor((accumulator + 0.000000001) / GUMMY_FIXED_DT)
      if (!count) return 0
      accumulator -= count * GUMMY_FIXED_DT
      writeParameters(input, count)
      contactRan = false
      const iterations = jelly
        ? jellyIterations
        : input.fractureMode === 'tension-shear'
          ? GUMMY_FINE_SOLVER_ITERATIONS
          : GUMMY_SOLVER_ITERATIONS
      solverIterations = iterations
      const nextKey = input.grip
        ? `${input.grip.center.join(':')}:${input.grip.radius}`
        : ''
      const captureGrip = !!input.grip && (!gripping || nextKey !== gripKey)
      gripping = !!input.grip
      gripKey = nextKey
      const encoder = device.createCommandEncoder({
        label: 'Gummy XPBD fixed steps',
      })
      if (captureGrip) {
        const pass = encoder.beginComputePass()
        capture.with(pass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        pass.end()
      }
      for (let substep = 0; substep < count * internalSubsteps; substep++) {
        encoder.clearBuffer(root.unwrap(tetLambda))
        encoder.clearBuffer(root.unwrap(bondLambda))
        const pass = encoder.beginComputePass()
        const gripPass = projectConstraints(pass, iterations)
        // Measure traction after projection: multipliers were cleared at this substep's start.
        if (interfaceCount)
          updateDamage
            .with(pass)
            .dispatchWorkgroups(Math.ceil(interfaceCount / 64))
        if (input.fractureMode === 'tension-shear' && patchGeometry.count)
          completePatches
            .with(pass)
            .dispatchWorkgroups(Math.ceil(patchGeometry.count / 64))
        if (input.fragmentContact && contactGeometry.regionCount > 1) {
          resetContacts
            .with(pass)
            .dispatchWorkgroups(
              Math.ceil(
                Math.max(GUMMY_CONTACT_BUCKETS, contactGeometry.regionCount) /
                  64,
              ),
            )
          for (let sweep = 0; sweep < contactGeometry.regionCount; sweep++)
            contactComponents
              .with(pass)
              .dispatchWorkgroups(Math.ceil(interfaceCount / 64))
          insertContacts
            .with(pass)
            .dispatchWorkgroups(Math.ceil(vertexCount / 64))
          gatherContacts
            .with(pass)
            .dispatchWorkgroups(Math.ceil(vertexCount / 64))
          gripPass.dispatchWorkgroups(Math.ceil(vertexCount / 64))
          contactRan = true
        }
        finish.with(pass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        pass.end()
      }
      device.queue.submit([encoder.finish()])
      simulationTime += count * GUMMY_FIXED_DT
      return count
    }

    function reset() {
      if (disposed) return
      positions.write(restPositions.buffer)
      if (plasticity) restorePlasticity()
      const encoder = device.createCommandEncoder({ label: 'Gummy reset' })
      for (const buffer of [
        previous,
        velocities,
        grip,
        tetLambda,
        bondLambda,
        damage,
      ])
        encoder.clearBuffer(root.unwrap(buffer))
      device.queue.submit([encoder.finish()])
      accumulator = 0
      simulationTime = 0
      gripping = false
      gripKey = ''
      previousPressHeight = undefined
      contactRan = false
    }

    /** Keep live picking independent from cohesive-force and contact diagnostics. */
    async function readPositions(): Promise<Float32Array> {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (dynamicReadback) return dynamicReadback.readPositions()
      const points = await positions.read()
      if (disposed) throw new Error('Gummy solver has been destroyed')
      const packed = new Float32Array(vertexCount * 4)
      for (let id = 0; id < vertexCount; id++) {
        const point = points[id]!
        packed[id * 4] = point.x
        packed[id * 4 + 1] = point.y
        packed[id * 4 + 2] = point.z
        packed[id * 4 + 3] = point.w
      }
      return packed
    }

    async function readState() {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      const [p, damaged, impulse, components] = await Promise.all([
        positions.read(),
        damage.read(),
        bondLambda.read(),
        contactRan ? contactLabels.read() : undefined,
      ])
      const packed = new Float32Array(vertexCount * 4)
      for (let id = 0; id < vertexCount; id++) {
        const value = p[id]!
        packed.set([value.x, value.y, value.z, value.w], id * 4)
      }
      const cohesiveForces = new Float32Array(interfaceCount)
      let maxCohesiveForce = 0
      for (let id = 0; id < interfaceCount * 3; id++) {
        const value = impulse[id]!
        const force =
          Math.hypot(value.x, value.y, value.z) / (solverDt * solverDt)
        const face = Math.floor(id / 3)
        cohesiveForces[face] = Math.max(cohesiveForces[face]!, force)
        maxCohesiveForce = Math.max(maxCohesiveForce, force)
      }
      return {
        positions: packed,
        materialModel,
        iterations: solverIterations,
        jellyIterations: jelly ? jellyIterations : undefined,
        jellySubsteps: jelly ? internalSubsteps : undefined,
        damage: Float32Array.from(damaged).slice(0, interfaceCount),
        simulationTime,
        maxCohesiveForce,
        cohesiveForces,
        contactComponents: components
          ? Uint32Array.from(components)
          : undefined,
      }
    }

    async function snapshotAssessment() {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (!jelly || interfaceCount)
        throw new Error('Live topology snapshots require continuous jelly')
      // As with snapshotDynamic, callers freeze stepping until their material
      // transaction finishes. Save rollback state before any asynchronous work.
      const jellyPlasticState = plasticity?.snapshot()
      const positions = await dynamicReadback!.readPositions()
      return { positions, jellyPlasticState }
    }

    async function snapshotDynamic(): Promise<GummySolverDynamicState> {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (!jelly || interfaceCount)
        throw new Error('Live topology snapshots require continuous jelly')
      // Freeze callers' stepping during this snapshot and any matching topology transaction.
      const metadata = {
        simulationTime,
        accumulator,
        gripKey,
        gripping,
        previousPressHeight,
        jellyPlasticState: plasticity?.snapshot(),
      }
      const packed = await dynamicReadback!.read()
      return {
        ...metadata,
        ...packed,
      }
    }

    function restoreDynamic(
      snapshot: GummySolverDynamicState,
      sourceNodes?: Uint32Array,
    ) {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (!jelly || interfaceCount)
        throw new Error('Live topology restore requires continuous jelly')
      const restored = remapGummyDynamicState(
        snapshot,
        restPositions,
        sourceNodes,
      )
      restorePlasticity(snapshot.jellyPlasticState)
      positions.write(restored.positions.slice().buffer)
      previous.write(restored.previous.slice().buffer)
      velocities.write(restored.velocities.slice().buffer)
      grip.write(restored.grip.slice().buffer)
      simulationTime = restored.simulationTime
      accumulator = restored.accumulator
      gripKey = restored.gripKey
      gripping = restored.gripping
      previousPressHeight = restored.previousPressHeight
      contactRan = false
      // XPBD multipliers already reset every substep; no deformation history is discarded.
      const encoder = device.createCommandEncoder({
        label: 'Gummy topology constraint reset',
      })
      for (const buffer of [tetLambda, bondLambda, damage])
        encoder.clearBuffer(root.unwrap(buffer))
      device.queue.submit([encoder.finish()])
    }

    function destroy() {
      if (disposed) return
      disposed = true
      for (const buffer of owned) buffer.destroy()
    }

    function restorePlasticity(saved?: JellyPlasticState) {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (!jellyTets || !jellyTetData) {
        if (saved)
          throw new Error('Plastic material memory requires continuous jelly')
        return
      }
      if (!saved && !plasticity) return
      plasticity ??= createGummyJellyPlasticity(mesh, jellyRestTets)
      plasticity.restore(saved)
      plasticity.writeTets(jellyTetData)
      jellyTets.write(jellyTetData.buffer)
    }

    function updatePlasticity(
      livePositions: Float32Array,
      elapsedSeconds: number,
      material: { softness: number; fragility?: number },
    ) {
      if (disposed) throw new Error('Gummy solver has been destroyed')
      if (!jellyTets || !jellyTetData)
        throw new Error('Plastic material memory requires continuous jelly')
      plasticity ??= createGummyJellyPlasticity(mesh, jellyRestTets)
      const result = plasticity.update(livePositions, elapsedSeconds, material)
      if (result.changedTets) {
        plasticity.writeTets(jellyTetData)
        jellyTets.write(jellyTetData.buffer)
      }
      return result
    }
    return {
      positions,
      damage,
      vertexCount,
      tetCount,
      interfaceCount,
      materialModel,
      get iterations() {
        return solverIterations
      },
      jellyIterations: jelly ? jellyIterations : undefined,
      jellySubsteps: jelly ? internalSubsteps : undefined,
      step,
      reset,
      readPositions,
      readState,
      snapshotDynamic,
      snapshotAssessment,
      restoreDynamic,
      updatePlasticity,
      restorePlasticity,
      destroy,
      batches: {
        tetrahedra: tetBatches.length,
        interfaces: interfaceBatches.length,
      },
    }
  } catch (error) {
    for (const buffer of owned) buffer.destroy()
    throw error
  }
}

export type GummySolver = ReturnType<typeof createGummySolver>
