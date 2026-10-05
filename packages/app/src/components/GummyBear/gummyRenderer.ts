/** Owned native WebGPU filled-gummy surface, studio floor and deformation-derived light. */
import { d } from 'typegpu'
import { GUMMY_MATERIALS } from './gummyMaterial'
import { getGummyPipelines } from './gummyPipelines'
import { GUMMY_PRESS_THICKNESS } from './gummyPress'
import { createGummyRenderResources } from './gummyRenderResources'
import { GummyCamera, gummyCameraLayout, gummyMeshLayout, gummyNormalsLayout, } from './gummyShaders'
import { prepareGummySurface } from './gummySurface'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'
import type { GummyPalette } from './gummyMaterial'
import type { GummyRenderResources } from './gummyRenderResources'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'

export type GummyRenderState = {
  positions: TgpuBuffer<d.WgslArray<d.Vec4f>> & StorageFlag
  damage: TgpuBuffer<d.WgslArray<d.F32>> & StorageFlag
}
export type GummyFrame = {
  width: number
  height: number
  viewProjection: Float32Array
  inverseViewProjection: Float32Array
  eye: Float32Array
  palette?: GummyPalette
  floor?: 'studio' | 'chess'
  clay?: boolean
  surface?: 'original' | 'rounded'
  diagnostic?: number
  press?: { height: number; halfExtent: number }
}

export function createGummyRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  mesh: GummyMesh,
  solver: GummyRenderState,
  sharedResources?: GummyRenderResources,
) {
  if (root.device !== device)
    throw new Error('Gummy renderer root and device must match')
  sharedResources?.assertCompatible(root, device, context, format)
  const surface = prepareGummySurface(mesh)
  const vertexCount = mesh.positions.length / 4
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const camera = own(root.createBuffer(GummyCamera).$usage('uniform'))
    const cameraGroup = root.createBindGroup(gummyCameraLayout, { camera })
    const cameraData = new Float32Array(d.sizeOf(GummyCamera) / 4)
    const faces = own(
      root
        .createBuffer(d.arrayOf(d.vec4u, mesh.surface.length / 4), (buffer) => {
          buffer.write(new Uint32Array(mesh.surface).buffer)
        })
        .$usage('storage'),
    )
    const normals = own(
      root.createBuffer(d.arrayOf(d.vec4f, vertexCount * 4)).$usage('storage'),
    )
    const restNormals = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, vertexCount), (buffer) => {
          buffer.write(new Float32Array(mesh.restNormals).buffer)
        })
        .$usage('storage'),
    )
    const restPositions = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, vertexCount), (buffer) => {
          buffer.write(new Float32Array(mesh.positions).buffer)
        })
        .$usage('storage'),
    )
    const corners = own(
      root
        .createBuffer(
          d.arrayOf(d.vec4f, surface.corners.length / 4),
          (buffer) => {
            buffer.write(surface.corners.buffer)
          },
        )
        .$usage('storage'),
    )
    const flatEdges = own(
      root
        .createBuffer(
          d.arrayOf(d.vec4u, surface.flatEdges.length / 4),
          (buffer) => {
            buffer.write(surface.flatEdges.buffer)
          },
        )
        .$usage('storage'),
    )
    const metadata = own(
      root
        .createBuffer(
          d.arrayOf(d.vec4u, surface.metadata.length / 4),
          (buffer) => {
            buffer.write(surface.metadata.buffer)
          },
        )
        .$usage('storage'),
    )
    const ranges = own(
      root
        .createBuffer(
          d.arrayOf(d.vec2u, surface.ranges.length / 2),
          (buffer) => {
            buffer.write(surface.ranges.buffer)
          },
        )
        .$usage('storage'),
    )
    const adjacent = own(
      root
        .createBuffer(
          d.arrayOf(d.vec2u, surface.adjacent.length / 2),
          (buffer) => {
            buffer.write(surface.adjacent.buffer)
          },
        )
        .$usage('storage'),
    )
    const indices = own(
      root
        .createBuffer(d.arrayOf(d.u32, surface.indices.length), (buffer) => {
          buffer.write(surface.indices.buffer)
        })
        .$usage('index'),
    )
    const roundedIndices =
      surface.roundedIndices.length === surface.indices.length
        ? indices
        : own(
            root
              .createBuffer(
                d.arrayOf(d.u32, surface.roundedIndices.length),
                (buffer) => {
                  buffer.write(surface.roundedIndices.buffer)
                },
              )
              .$usage('index'),
          )
    const meshGroup = root.createBindGroup(gummyMeshLayout, {
      positions: solver.positions,
      damage: solver.damage,
      faces,
      normals,
      corners,
      flatEdges,
      restPositions,
      metadata,
    })
    const normalGroup = root.createBindGroup(gummyNormalsLayout, {
      positions: solver.positions,
      faces,
      restNormals,
      restPositions,
      ranges,
      adjacent,
      normals,
      damage: solver.damage,
    })
    const pipelines = getGummyPipelines(root, format, !!mesh.runtimeFracture)
    const compute = pipelines.compute.with(normalGroup).with(cameraGroup)
    const roundCorners = pipelines.roundCorners
      .with(normalGroup)
      .with(cameraGroup)
    const front = pipelines.front.with(cameraGroup).with(meshGroup)
    const exits = pipelines.exits.with(cameraGroup).with(meshGroup)
    const frontTags = pipelines.frontTags.with(cameraGroup).with(meshGroup)
    const shadow = pipelines.shadow.with(cameraGroup).with(meshGroup)
    const caustic = pipelines.caustic.with(cameraGroup).with(meshGroup)
    const background = pipelines.background.with(cameraGroup)
    const display = pipelines.display.with(cameraGroup)
    const resources =
      sharedResources ??
      own(createGummyRenderResources(root, device, context, format))
    let disposed = false
    return {
      async readSurfacePositions() {
        if (disposed) throw new Error('Gummy renderer has been destroyed')
        const data = await normals.read()
        if (disposed) throw new Error('Gummy renderer has been destroyed')
        const positions = new Float32Array(vertexCount * 4)
        const restPositions = new Float32Array(vertexCount * 4)
        for (let id = 0; id < vertexCount; id++) {
          const point = data[vertexCount * 2 + id]!
          const rest = data[vertexCount * 3 + id]!
          positions.set([point.x, point.y, point.z, point.w], id * 4)
          restPositions.set([rest.x, rest.y, rest.z, rest.w], id * 4)
        }
        return { positions, restPositions }
      },
      render(frame: GummyFrame) {
        if (
          disposed ||
          !Number.isFinite(frame.width) ||
          !Number.isFinite(frame.height) ||
          frame.width < 1 ||
          frame.height < 1
        )
          return
        const rounded = !!mesh.runtimeFracture && frame.surface === 'rounded'
        const drawIndices = rounded ? roundedIndices : indices
        const drawCount = rounded
          ? surface.roundedIndices.length
          : surface.indices.length
        const width = Math.floor(frame.width),
          height = Math.floor(frame.height)
        const targets = resources.targets(width, height, !!mesh.runtimeFracture)
        cameraData.set(frame.viewProjection, 0)
        cameraData.set(frame.inverseViewProjection, 16)
        cameraData.set(frame.eye.subarray(0, 3), 32)
        cameraData[35] = frame.diagnostic ?? 0
        cameraData[36] = width
        cameraData[37] = height
        cameraData[38] = frame.clay ? 1 : 0
        cameraData[39] = format.endsWith('-srgb') ? 0 : 1
        const palette = frame.palette ?? 'blue'
        const solid =
          palette === 'blue' || palette === 'amber' || palette === 'berry'
            ? palette
            : 'blue'
        const material = GUMMY_MATERIALS[solid]
        cameraData.set(material.absorption, 40)
        cameraData[43] = mesh.spacing * 0.45
        cameraData.set(material.colour, 44)
        cameraData[47] =
          palette === 'candy'
            ? 1
            : palette === 'lagoon'
              ? 2
              : palette === 'marble'
                ? 3
                : 0
        cameraData[48] = frame.press?.height ?? 0
        cameraData[49] = frame.press?.halfExtent ?? 0
        cameraData[50] = frame.press ? 1 : 0
        cameraData[51] = GUMMY_PRESS_THICKNESS
        cameraData[52] = rounded ? 1 : 0
        camera.write(cameraData.buffer)
        const encoder = root['~unstable'].createCommandEncoder({
          label: 'Gummy filled body frame',
        })
        const roundPass = encoder.beginComputePass()
        roundCorners
          .with(roundPass)
          .dispatchWorkgroups(Math.ceil(vertexCount / 64))
        roundPass.end()
        const normalPass = encoder.beginComputePass()
        compute.with(normalPass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        normalPass.end()
        const light = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: resources.lightView,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        shadow.with(light).withIndexBuffer(drawIndices).drawIndexed(drawCount)
        if (!frame.clay)
          caustic
            .with(light)
            .withIndexBuffer(drawIndices)
            .drawIndexed(drawCount)
        light.end()
        const scene = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets.multisample,
              resolveTarget: targets.scene,
              clearValue: [0.72, 0.65, 0.55, 1],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: targets.depth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        })
        background.with(resources.floorGroup).with(scene).draw(3)
        scene.end()
        if (targets.fronts) {
          const provenancePass = encoder.beginRenderPass({
            label: 'Gummy visible component',
            colorAttachments: [
              {
                view: targets.fronts,
                clearValue: [0, 0, 0, 0],
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
            depthStencilAttachment: {
              view: targets.exitDepth,
              depthClearValue: 1,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
            },
          })
          frontTags
            .with(provenancePass)
            .withIndexBuffer(drawIndices)
            .drawIndexed(drawCount)
          provenancePass.end()
        }
        const exitPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets.exits,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: targets.restExits,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: targets.exitDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        })
        const filteredExits = targets.exitFilter
          ? exits.with(targets.exitFilter)
          : exits
        filteredExits
          .with(exitPass)
          .withIndexBuffer(drawIndices)
          .drawIndexed(drawCount)
        exitPass.end()
        const optical = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets.multisample,
              resolveTarget: targets.final,
              loadOp: 'load',
              storeOp: 'discard',
            },
          ],
          depthStencilAttachment: {
            view: targets.depth,
            depthLoadOp: 'load',
            depthStoreOp: 'discard',
          },
        })
        front
          .with(targets.optical)
          .with(optical)
          .withIndexBuffer(drawIndices)
          .drawIndexed(drawCount)
        optical.end()
        const final = encoder.beginRenderPass({
          colorAttachments: [
            { view: context, loadOp: 'clear', storeOp: 'store' },
          ],
        })
        display.with(targets.display).with(final).draw(3)
        final.end()
        encoder.submit()
      },
      destroy() {
        if (disposed) return
        disposed = true
        for (const resource of owned) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned) resource.destroy()
    throw error
  }
}
