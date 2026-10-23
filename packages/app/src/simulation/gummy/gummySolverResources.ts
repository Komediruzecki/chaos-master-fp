/** Owned XPBD buffers, contact passes and colored constraint batches, built once per topology. */
import { d } from 'typegpu'
import { GUMMY_CONTACT_BUCKETS, gummyContactComponents, gummyContactGather, gummyContactInsert, gummyContactLayout, gummyContactReset, } from './gummyContacts'
import { createGummyDynamicReadback } from './gummyDynamicReadback'
import { gummyJellyLayout, GummyJellyTet, gummySolveJellyTets, } from './gummyJellyShaders'
import { gummyCompletePatches, GummyPatch, GummyPatchFace, gummyPatchLayout, } from './gummyPatches'
import { gummySolverPipeline } from './gummySolverPipelines'
import { colorGummyConstraints } from './gummySolverPreparation'
import { gummyBatchLayout, gummyCaptureGrip, GummyDamage, gummyFinish, gummyGripAndFloor, GummyInterface, gummyInterfaceLayout, gummyNodeLayout, GummyParameters, GummyPositions, gummyPredict, gummySolveInterfaces, gummySolveTets, GummyTet, GummyTetLambda, gummyTetLayout, gummyUpdateDamage, } from './gummySolverShaders'
import type { TgpuRoot } from 'typegpu'
import type { prepareGummyContacts } from './gummyContacts'
import type { prepareGummyPatches } from './gummyPatches'
import type { GummySolverMesh } from './gummySolverContracts'
import type { prepareGummySolverGeometry } from './gummySolverPreparation'

export function createGummySolverResources(
  root: TgpuRoot,
  device: GPUDevice,
  mesh: GummySolverMesh,
  restPositions: Float32Array<ArrayBuffer>,
  prepared: ReturnType<typeof prepareGummySolverGeometry>,
  jelly: boolean,
  contactGeometry: ReturnType<typeof prepareGummyContacts>,
  patchGeometry: ReturnType<typeof prepareGummyPatches>,
  own: <T extends { destroy(): void }>(resource: T) => T,
) {
  const vertexCount = mesh.positions.length / 4
  const tetCount = mesh.tetrahedra.length / 4
  const interfaceCount = mesh.interfaces.length / 8
  const restTets = prepared.restTets
  const interfaceData = contactGeometry.interfaces
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
  const completePatches = gummySolverPipeline(root, gummyCompletePatches).with(
    patchGroup,
  )
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
  const solveInterfaces = gummySolverPipeline(root, gummySolveInterfaces).with(
    interfaceGroup,
  )
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

  return {
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
  }
}
