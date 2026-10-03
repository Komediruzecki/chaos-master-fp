/** Owned fixed-step WebGPU XPBD tetrahedra with progressive, irreversible cohesive tears. */
import { d } from 'typegpu'
import { GUMMY_CONTACT_BUCKETS, gummyContactComponents, gummyContactGather, gummyContactInsert, gummyContactLayout, gummyContactReset, prepareGummyContacts, } from './gummyContacts'
import { GUMMY_JELLY_SOLVER_ITERATIONS, gummyJellyMaterial, prepareGummyJellyTets, } from './gummyJelly'
import { gummyJellyLayout, GummyJellyTet, gummySolveJellyTets, } from './gummyJellyShaders'
import { gummyCompletePatches, GummyPatch, GummyPatchFace, gummyPatchLayout, prepareGummyPatches, } from './gummyPatches'
import { gummyBatchLayout, gummyCaptureGrip, GummyDamage, gummyFinish, gummyGripAndFloor, GummyInterface, gummyInterfaceLayout, gummyNodeLayout, GummyParameters, GummyPositions, gummyPredict, gummySolveInterfaces, gummySolveTets, GummyTet, GummyTetLambda, gummyTetLayout, gummyUpdateDamage, } from './gummySolverShaders'
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
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
] as const

/** Greedy colors include every written node, including pinned nodes: no write/write races. */
export function colorGummyConstraints(
  indices: Uint32Array,
  stride: number,
  active: number,
) {
  if (stride < active || active < 1 || indices.length % stride)
    throw new Error('Invalid gummy constraint stride')
  const used = new Map<number, Set<number>>()
  const batches: number[][] = []
  for (let id = 0; id < indices.length / stride; id++) {
    let color = 0
    while (true) {
      let conflict = false
      for (let n = 0; n < active; n++)
        if (used.get(indices[id * stride + n]!)?.has(color)) conflict = true
      if (!conflict) break
      color++
    }
    ;(batches[color] ??= []).push(id)
    for (let n = 0; n < active; n++) {
      const node = indices[id * stride + n]!
      const colors = used.get(node) ?? new Set<number>()
      colors.add(color)
      used.set(node, colors)
    }
  }
  const order = new Uint32Array(indices.length / stride)
  let offset = 0
  const ranges = batches.map((ids) => {
    order.set(ids, offset)
    const range = { offset, count: ids.length }
    offset += ids.length
    return range
  })
  return { order, ranges }
}

/** Rest geometry is CPU preprocessing; all evolving positions and constraints live on GPU. */
export function prepareGummyTets(mesh: GummySolverMesh) {
  validateGummyMesh(mesh)
  const data = new Float32Array((mesh.tetrahedra.length / 4) * 12)
  const ids = new Uint32Array(data.buffer)
  for (let tet = 0; tet < mesh.tetrahedra.length / 4; tet++) {
    const vertices = Array.from(mesh.tetrahedra.subarray(tet * 4, tet * 4 + 4))
    ids.set(vertices, tet * 12)
    for (let edge = 0; edge < EDGES.length; edge++) {
      const pair = EDGES[edge]!
      const a = vertices[pair[0]]! * 4,
        b = vertices[pair[1]]! * 4
      data[tet * 12 + 4 + edge] = Math.hypot(
        mesh.positions[a]! - mesh.positions[b]!,
        mesh.positions[a + 1]! - mesh.positions[b + 1]!,
        mesh.positions[a + 2]! - mesh.positions[b + 2]!,
      )
    }
    const a = vertices[0]! * 4
    const e = vertices
      .slice(1)
      .map((v) => [
        mesh.positions[v * 4]! - mesh.positions[a]!,
        mesh.positions[v * 4 + 1]! - mesh.positions[a + 1]!,
        mesh.positions[v * 4 + 2]! - mesh.positions[a + 2]!,
      ])
    const [b, c, f] = e as [number[], number[], number[]]
    const volume =
      (b[0]! * (c[1]! * f[2]! - c[2]! * f[1]!) +
        b[1]! * (c[2]! * f[0]! - c[0]! * f[2]!) +
        b[2]! * (c[0]! * f[1]! - c[1]! * f[0]!)) /
      6
    if (volume <= 0.0000000000000001)
      throw new Error('Gummy tets must have positive nonzero rest volume')
    data[tet * 12 + 10] = volume
  }
  return data
}

function validateGummyMesh(mesh: GummySolverMesh) {
  if (
    !mesh.positions.length ||
    mesh.positions.length % 4 ||
    !mesh.tetrahedra.length ||
    mesh.tetrahedra.length % 4 ||
    mesh.interfaces.length % 8
  )
    throw new Error('Invalid gummy mesh buffer lengths')
  const count = mesh.positions.length / 4
  for (let i = 0; i < mesh.positions.length; i++)
    if (
      !Number.isFinite(mesh.positions[i]) ||
      (i % 4 === 3 && mesh.positions[i]! < 0)
    )
      throw new Error('Invalid gummy position or inverse mass')
  for (const id of mesh.tetrahedra)
    if (id >= count) throw new Error('Gummy tet node index out of range')
  for (let i = 0; i < mesh.interfaces.length; i++)
    if (i % 8 < 6 && mesh.interfaces[i]! >= count)
      throw new Error('Gummy interface node index out of range')
}

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

export function createGummySolver(
  root: TgpuRoot,
  device: GPUDevice,
  mesh: GummySolverMesh,
  options: GummySolverOptions = {},
) {
  if (root.device !== device)
    throw new Error('Gummy solver root and device must match')
  const restTets = prepareGummyTets(mesh)
  const jelly = options.materialModel === 'neo-hookean'
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
    const resetContacts = root
      .createComputePipeline({ compute: gummyContactReset })
      .with(contactGroup)
    const contactComponents = root
      .createComputePipeline({ compute: gummyContactComponents })
      .with(contactGroup)
    const insertContacts = root
      .createComputePipeline({ compute: gummyContactInsert })
      .with(contactGroup)
    const gatherContacts = root
      .createComputePipeline({ compute: gummyContactGather })
      .with(contactGroup)
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
    const completePatches = root
      .createComputePipeline({ compute: gummyCompletePatches })
      .with(patchGroup)
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
      root.createComputePipeline({ compute }).with(nodeGroup)
    const predict = nodePipeline(gummyPredict)
    const capture = nodePipeline(gummyCaptureGrip)
    const constrainGrip = nodePipeline(gummyGripAndFloor)
    const finish = nodePipeline(gummyFinish)
    const jellyTets = jelly
      ? own(
          root
            .createBuffer(d.arrayOf(GummyJellyTet, tetCount), (mapped) => {
              mapped.write(prepareGummyJellyTets(mesh).buffer)
            })
            .$usage('storage'),
        )
      : undefined
    const solveTets = jellyTets
      ? root.createComputePipeline({ compute: gummySolveJellyTets }).with(
          root.createBindGroup(gummyJellyLayout, {
            params,
            positions,
            tets: jellyTets,
            multipliers: tetLambda,
          }),
        )
      : root.createComputePipeline({ compute: gummySolveTets }).with(tetGroup)
    const solveInterfaces = root
      .createComputePipeline({ compute: gummySolveInterfaces })
      .with(interfaceGroup)
    const updateDamage = root
      .createComputePipeline({ compute: gummyUpdateDamage })
      .with(interfaceGroup)
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
    const tetBatches = batches(mesh.tetrahedra, 4, 4)
    const interfaceBatches = batches(mesh.interfaces, 8, 6)
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
    let solverIterations = jelly
      ? GUMMY_JELLY_SOLVER_ITERATIONS
      : GUMMY_SOLVER_ITERATIONS
    const uniformData = new ArrayBuffer(d.sizeOf(GummyParameters))
    const f32 = new Float32Array(uniformData)
    const u32 = new Uint32Array(uniformData)

    function writeParameters(input: GummyStep, count: number) {
      const material = jelly
        ? gummyJellyMaterial(input.softness)
        : gummyMaterial(input.softness, input.fractureMode)
      f32.set(
        [
          GUMMY_FIXED_DT,
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
        ? GUMMY_JELLY_SOLVER_ITERATIONS
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
      for (let substep = 0; substep < count; substep++) {
        encoder.clearBuffer(root.unwrap(tetLambda))
        encoder.clearBuffer(root.unwrap(bondLambda))
        const pass = encoder.beginComputePass()
        predict.with(pass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        constrainGrip.with(pass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        for (let iteration = 0; iteration < iterations; iteration++) {
          for (const batch of tetBatches)
            solveTets
              .with(pass)
              .with(batch.group)
              .dispatchWorkgroups(Math.ceil(batch.count / 64))
          for (const batch of interfaceBatches)
            solveInterfaces
              .with(pass)
              .with(batch.group)
              .dispatchWorkgroups(Math.ceil(batch.count / 64))
          constrainGrip
            .with(pass)
            .dispatchWorkgroups(Math.ceil(vertexCount / 64))
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
          constrainGrip
            .with(pass)
            .dispatchWorkgroups(Math.ceil(vertexCount / 64))
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
          Math.hypot(value.x, value.y, value.z) /
          (GUMMY_FIXED_DT * GUMMY_FIXED_DT)
        const face = Math.floor(id / 3)
        cohesiveForces[face] = Math.max(cohesiveForces[face]!, force)
        maxCohesiveForce = Math.max(maxCohesiveForce, force)
      }
      return {
        positions: packed,
        materialModel,
        iterations: solverIterations,
        jellyIterations: jelly ? GUMMY_JELLY_SOLVER_ITERATIONS : undefined,
        damage: Float32Array.from(damaged).slice(0, interfaceCount),
        simulationTime,
        maxCohesiveForce,
        cohesiveForces,
        contactComponents: components
          ? Uint32Array.from(components)
          : undefined,
      }
    }

    function destroy() {
      if (disposed) return
      disposed = true
      for (const buffer of owned) buffer.destroy()
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
      jellyIterations: jelly ? GUMMY_JELLY_SOLVER_ITERATIONS : undefined,
      step,
      reset,
      readState,
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
