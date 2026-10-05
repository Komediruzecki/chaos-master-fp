/** Owned fixed-step WebGPU XPBD tetrahedra with progressive, irreversible cohesive tears. */
import { d } from 'typegpu'
import { GUMMY_CONTACT_BUCKETS, gummyContactComponents, gummyContactGather, gummyContactInsert, gummyContactLayout, gummyContactReset, prepareGummyContacts, } from './gummyContacts'
import { GUMMY_JELLY_SOLVER_ITERATIONS, gummyJellyMaterial } from './gummyJelly'
import { createGummyJellyPlasticity } from './gummyJellyPlasticity'
import { gummySolverPipeline } from './gummySolverPipelines'
import { colorGummyConstraints, prepareGummySolverGeometry, } from './gummySolverPreparation'
import type { GummySolverPreparationCache } from './gummySolverPreparation'

export {
  colorGummyConstraints,
  prepareGummyTets,
} from './gummySolverPreparation'
import { gummyJellyLayout, GummyJellyTet, gummySolveJellyTets, } from './gummyJellyShaders'
import { gummyCompletePatches, GummyPatch, GummyPatchFace, gummyPatchLayout, prepareGummyPatches, } from './gummyPatches'
import { gummyBatchLayout, gummyCaptureGrip, GummyDamage, gummyFinish, gummyGripAndFloor, GummyInterface, gummyInterfaceLayout, gummyNodeLayout, GummyParameters, GummyPositions, gummyPredict, gummySolveInterfaces, gummySolveTets, GummyTet, GummyTetLambda, gummyTetLayout, gummyUpdateDamage, } from './gummySolverShaders'
import { remapGummyDynamicState } from './gummySolverState'
import type { JellyPlasticState } from './gummyJellyPlasticity'
import type { GummySolverDynamicState } from './gummySolverState'

export type { GummySolverDynamicState } from './gummySolverState'
import type { TgpuRoot } from 'typegpu'

export type GummySolverMesh = {
  /** xyzw, with w the inverse mass; zero pins a node. */
  positions: Float32Array
  tetrahedra: Uint32Array
  /** Three duplicate-node pairs per face: a0,b0,a1,b1,a2,b2,pad,pad. */
  interfaces: Uint32Array
  nodeRegions?: Uint32Array
  spacing?: number
}
export type GummyGrip = {
  center: readonly [number, number, number]
  target: readonly [number, number, number]
  radius: number
}
export type GummyPress = { height: number; halfExtent: number }
export type GummySolverOptions = {
  /** Static opt-in keeps the original spring and cohesive experiments unchanged. */
  materialModel?: 'edge-volume' | 'neo-hookean'
  /** Construction-time convergence budget for Neo-Hookean material only. */
  jellyIterations?: number
  /** Internal integration steps per logical 1/120-second tick; ignored by legacy materials. */
  jellySubsteps?: number
  /** Scene-owned, validated rest-data reuse across topology-only splits. */
  preparationCache?: GummySolverPreparationCache
  /** Maps each new node to the previous mesh node after splitting. */
  sourceNodes?: Uint32Array
}
export type GummyStep = {
  grip?: GummyGrip
  press?: GummyPress
  softness: number
  tearing: boolean
  /** Optional fine-seam calibration. One preserves the pull study's strength. */
  cohesiveStrength?: number
  /** Opt-in nodal sphere contact; ignored if the mesh has no fracture-region metadata. */
  fragmentContact?: boolean
  /** Fine mode also completes failure of predefined seam patches with >=70% broken rest area. */
  fractureMode?: 'tension-shear' | 'legacy'
}

export function normalizeGummyPress(press?: GummyPress) {
  if (
    !press ||
    !Number.isFinite(press.height) ||
    !Number.isFinite(press.halfExtent) ||
    press.height < 0.02 ||
    press.halfExtent <= 0
  )
    return undefined
  return press
}

export function gummyCohesiveStrength(value?: number) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0.05, Math.min(8, value))
    : 1
}
export const GUMMY_FIXED_DT = 1 / 120
export const GUMMY_SOLVER_ITERATIONS = 5
export const GUMMY_FINE_SOLVER_ITERATIONS = 16
const MAX_SUBSTEPS = 6

export function gummyMaterial(
  softness: number,
  mode: GummyStep['fractureMode'] = 'legacy',
) {
  const s = Number.isFinite(softness) ? Math.min(1, Math.max(0, softness)) : 0.5
  const fine = mode === 'tension-shear'
  return {
    // Crush needs compliant lateral strain with a stiff bulk response, not compressible shrinkage.
    stretchCompliance: 0.0000002 * 120 ** s * (fine ? 8 : 1),
    volumeCompliance: 0.00002 * 12 ** s * (fine ? 0.01 : 1),
    damping: 2.6,
  }
}

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

export function createGummySolver(
  root: TgpuRoot,
  device: GPUDevice,
  mesh: GummySolverMesh,
  options: GummySolverOptions = {},
) {
  if (root.device !== device)
    throw new Error('Gummy solver root and device must match')
  const jellyIterations =
    options.jellyIterations ?? GUMMY_JELLY_SOLVER_ITERATIONS
  if (
    !Number.isInteger(jellyIterations) ||
    jellyIterations < 1 ||
    jellyIterations > 96
  )
    throw new RangeError(
      'Jelly solver iterations must be an integer between 1 and 96',
    )
  const jellySubsteps = options.jellySubsteps ?? 1
  if (
    !Number.isInteger(jellySubsteps) ||
    jellySubsteps < 1 ||
    jellySubsteps > 8
  )
    throw new RangeError('Jelly substeps must be an integer between 1 and 8')
  const jelly = options.materialModel === 'neo-hookean'
  const prepared = options.preparationCache
    ? options.preparationCache.prepare(mesh, jelly, options.sourceNodes)
    : prepareGummySolverGeometry(mesh, jelly)
  const restTets = prepared.restTets
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
  const interfaceData = contactGeometry.interfaces
  const vertexCount = mesh.positions.length / 4
  const tetCount = mesh.tetrahedra.length / 4
  const interfaceCount = mesh.interfaces.length / 8
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const positions = own(
      root
        .createBuffer(GummyPositions(vertexCount), (mapped) => {
          mapped.write(restPositions.buffer)
        })
        .$usage('storage'),
    )
    const previous = own(
      root.createBuffer(GummyPositions(vertexCount)).$usage('storage'),
    )
    const velocities = own(
      root.createBuffer(GummyPositions(vertexCount)).$usage('storage'),
    )
    const grip = own(
      root.createBuffer(GummyPositions(vertexCount)).$usage('storage'),
    )
    const dynamicReadback = jelly
      ? own(
          createGummyDynamicReadback(
            device,
            [
              root.unwrap(positions),
              root.unwrap(previous),
              root.unwrap(velocities),
              root.unwrap(grip),
            ],
            vertexCount,
          ),
        )
      : undefined
    const tets = own(
      root
        .createBuffer(d.arrayOf(GummyTet, tetCount), (mapped) => {
          mapped.write(restTets.buffer)
        })
        .$usage('storage'),
    )
    const tetLambda = own(
      root.createBuffer(d.arrayOf(GummyTetLambda, tetCount)).$usage('storage'),
    )
    const interfaces = own(
      root
        .createBuffer(
          d.arrayOf(GummyInterface, Math.max(1, interfaceCount)),
          (mapped) => {
            if (interfaceCount) mapped.write(interfaceData.buffer)
          },
        )
        .$usage('storage'),
    )
    const damage = own(
      root
        .createBuffer(GummyDamage(Math.max(1, interfaceCount)))
        .$usage('storage'),
    )
    const bondLambda = own(
      root
        .createBuffer(GummyPositions(Math.max(1, interfaceCount * 3)))
        .$usage('storage'),
    )
    const params = own(root.createBuffer(GummyParameters).$usage('uniform'))
    const contactSnapshot = own(
      root.createBuffer(GummyPositions(vertexCount)).$usage('storage'),
    )
    const contactMetadata = own(
      root
        .createBuffer(GummyPositions(vertexCount), (mapped) => {
          mapped.write(contactGeometry.metadata.buffer)
        })
        .$usage('storage'),
    )
    const contactHeads = own(
      root
        .createBuffer(d.arrayOf(d.atomic(d.u32), GUMMY_CONTACT_BUCKETS))
        .$usage('storage'),
    )
    const contactLinks = own(
      root.createBuffer(d.arrayOf(d.u32, vertexCount)).$usage('storage'),
    )
    const contactLabels = own(
      root
        .createBuffer(
          d.arrayOf(d.atomic(d.u32), Math.max(1, contactGeometry.regionCount)),
        )
        .$usage('storage'),
    )
    const contactGroup = root.createBindGroup(gummyContactLayout, {
      params,
      positions,
      snapshot: contactSnapshot,
      metadata: contactMetadata,
      interfaces,
      damage,
      heads: contactHeads,
      links: contactLinks,
      labels: contactLabels,
    })
    const resetContacts = gummySolverPipeline(root, gummyContactReset).with(
      contactGroup,
    )
    const contactComponents = gummySolverPipeline(
      root,
      gummyContactComponents,
    ).with(contactGroup)
    const insertContacts = gummySolverPipeline(root, gummyContactInsert).with(
      contactGroup,
    )
    const gatherContacts = gummySolverPipeline(root, gummyContactGather).with(
      contactGroup,
    )
    const patchHeaders = own(
      root
        .createBuffer(
          d.arrayOf(GummyPatch, Math.max(1, patchGeometry.count)),
          (mapped) => {
            if (patchGeometry.count) mapped.write(patchGeometry.patches)
          },
        )
        .$usage('storage'),
    )
    const patchFaces = own(
      root
        .createBuffer(
          d.arrayOf(GummyPatchFace, Math.max(1, interfaceCount)),
          (mapped) => {
            if (patchGeometry.count) mapped.write(patchGeometry.faces)
          },
        )
        .$usage('storage'),
    )
    const patchCount = own(
      root
        .createBuffer(d.vec4u, d.vec4u(patchGeometry.count, 0, 0, 0))
        .$usage('uniform'),
    )
    const patchGroup = root.createBindGroup(gummyPatchLayout, {
      params,
      count: patchCount,
      patches: patchHeaders,
      faces: patchFaces,
      damage,
    })
    const completePatches = gummySolverPipeline(
      root,
      gummyCompletePatches,
    ).with(patchGroup)
    const nodeGroup = root.createBindGroup(gummyNodeLayout, {
      params,
      positions,
      previous,
      velocities,
      grip,
    })
    const tetGroup = root.createBindGroup(gummyTetLayout, {
      params,
      positions,
      tets,
      multipliers: tetLambda,
    })
    const interfaceGroup = root.createBindGroup(gummyInterfaceLayout, {
      params,
      positions,
      interfaces,
      damage,
      multipliers: bondLambda,
    })
    const nodePipeline = (compute: typeof gummyPredict) =>
      gummySolverPipeline(root, compute).with(nodeGroup)
    const predict = nodePipeline(gummyPredict)
    const capture = nodePipeline(gummyCaptureGrip)
    const constrainGrip = nodePipeline(gummyGripAndFloor)
    const finish = nodePipeline(gummyFinish)
    // Plasticity writes into jellyTetData; keep pristine rest gradients separate.
    const jellyRestTets = prepared.jellyTets
    const jellyTetData = jellyRestTets?.slice()
    let plasticity: ReturnType<typeof createGummyJellyPlasticity> | undefined
    const jellyTets = jelly
      ? own(
          root
            .createBuffer(d.arrayOf(GummyJellyTet, tetCount), (mapped) => {
              mapped.write(jellyTetData!.buffer)
            })
            .$usage('storage'),
        )
      : undefined
    const solveTets = jellyTets
      ? gummySolverPipeline(root, gummySolveJellyTets).with(
          root.createBindGroup(gummyJellyLayout, {
            params,
            positions,
            tets: jellyTets,
            multipliers: tetLambda,
          }),
        )
      : gummySolverPipeline(root, gummySolveTets).with(tetGroup)
    const solveInterfaces = gummySolverPipeline(
      root,
      gummySolveInterfaces,
    ).with(interfaceGroup)
    const updateDamage = gummySolverPipeline(root, gummyUpdateDamage).with(
      interfaceGroup,
    )
    const batches = (indices: Uint32Array, stride: number, active: number) => {
      const colored = colorGummyConstraints(indices, stride, active)
      const order = own(
        root
          .createBuffer(
            d.arrayOf(d.u32, Math.max(1, colored.order.length)),
            (mapped) => {
              if (colored.order.length) mapped.write(colored.order.buffer)
            },
          )
          .$usage('storage'),
      )
      return colored.ranges.map(({ offset, count }) => {
        const range = own(
          root
            .createBuffer(d.vec4u, d.vec4u(offset, count, 0, 0))
            .$usage('uniform'),
        )
        return {
          count,
          group: root.createBindGroup(gummyBatchLayout, { range, order }),
        }
      })
    }
    const tetBatches = batches(mesh.tetrahedra, 4, 4).map((batch) => ({
      count: Math.ceil(batch.count / 64),
      pipeline: solveTets.with(batch.group),
    }))
    const interfaceBatches = batches(mesh.interfaces, 8, 6).map((batch) => ({
      count: Math.ceil(batch.count / 64),
      pipeline: solveInterfaces.with(batch.group),
    }))
    for (const pipeline of [
      predict,
      capture,
      constrainGrip,
      finish,
      solveTets,
      solveInterfaces,
      updateDamage,
      resetContacts,
      contactComponents,
      insertContacts,
      gatherContacts,
      completePatches,
    ])
      root.unwrap(pipeline)
    // Buffer initialization is lazy: force it before raw clear/copy commands.
    for (const buffer of [
      positions,
      previous,
      velocities,
      grip,
      tetLambda,
      damage,
      bondLambda,
      contactSnapshot,
      contactMetadata,
      contactHeads,
      contactLinks,
      contactLabels,
    ])
      root.unwrap(buffer)
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
