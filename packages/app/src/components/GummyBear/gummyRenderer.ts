/** Owned native WebGPU filled-gummy surface, studio floor and deformation-derived light. */
import { common, d } from 'typegpu'
import { GUMMY_MATERIALS } from './gummyMaterial'
import { GUMMY_PRESS_THICKNESS } from './gummyPress'
import { gummyBackgroundFragment, GummyCamera, gummyCameraLayout, gummyCausticFragment, gummyCausticVertex, gummyDisplayFragment, gummyExitFragment, gummyFloorLayout, gummyFragment, gummyFrontTagFragment, gummyMeshLayout, gummyNormalsCompute, gummyNormalsLayout, gummyRuntimeExitFragment, gummyShadowFragment, gummyShadowVertex, gummyVertex, } from './gummyShaders'
import { prepareGummySurface } from './gummySurface'
import { createGummyTargets } from './gummyTargets'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'
import type { GummyPalette } from './gummyMaterial'
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
  clay?: boolean
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
) {
  if (root.device !== device)
    throw new Error('Gummy renderer root and device must match')
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
      root.createBuffer(d.arrayOf(d.vec4f, vertexCount * 2)).$usage('storage'),
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
    const compute = root
      .createComputePipeline({ compute: gummyNormalsCompute })
      .with(normalGroup)
    const depth: GPUDepthStencilState = {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    }
    const front = root
      .createRenderPipeline({
        vertex: gummyVertex,
        fragment: gummyFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'back' },
        depthStencil: depth,
        multisample: { count: 4 },
      })
      .with(cameraGroup)
      .with(meshGroup)
      .withIndexBuffer(indices)
    const exits = root
      .createRenderPipeline({
        vertex: gummyVertex,
        fragment: mesh.runtimeFracture
          ? gummyRuntimeExitFragment
          : gummyExitFragment,
        targets: {
          world: { format: 'rgba16float' },
          rest: { format: 'rgba16float' },
        },
        primitive: { cullMode: 'front' },
        depthStencil: depth,
      })
      .with(cameraGroup)
      .with(meshGroup)
      .withIndexBuffer(indices)
    const frontTags = root
      .createRenderPipeline({
        vertex: gummyVertex,
        fragment: gummyFrontTagFragment,
        targets: { format: 'rg16float' },
        primitive: { cullMode: 'back' },
        depthStencil: depth,
      })
      .with(cameraGroup)
      .with(meshGroup)
      .withIndexBuffer(indices)
    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
    const shadow = root
      .createRenderPipeline({
        vertex: gummyShadowVertex,
        fragment: gummyShadowFragment,
        targets: { format: 'rgba16float', blend: additive },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)
      .with(meshGroup)
      .withIndexBuffer(indices)
    const caustic = root
      .createRenderPipeline({
        vertex: gummyCausticVertex,
        fragment: gummyCausticFragment,
        targets: { format: 'rgba16float', blend: additive },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)
      .with(meshGroup)
      .withIndexBuffer(indices)
    const background = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyBackgroundFragment,
        targets: { colour: { format: 'rgba16float' } },
        depthStencil: { ...depth, depthCompare: 'always' },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
    const display = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyDisplayFragment,
        targets: { format },
      })
      .with(cameraGroup)
    root.unwrap(compute)
    root.unwrap(background)
    root.unwrap(exits)
    if (mesh.runtimeFracture) root.unwrap(frontTags)
    for (const pipeline of [front, shadow, caustic, display])
      root.unwrap(pipeline)
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const lightTexture = own(
      device.createTexture({
        label: 'Gummy projected light',
        size: [512, 512],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    )
    const lightView = lightTexture.createView()
    const floorGroup = root.createBindGroup(gummyFloorLayout, {
      light: lightView,
      sampler,
    })
    let targets: ReturnType<typeof createGummyTargets> | undefined
    let sizeKey = ''
    let disposed = false
    return {
      render(frame: GummyFrame) {
        if (
          disposed ||
          !Number.isFinite(frame.width) ||
          !Number.isFinite(frame.height) ||
          frame.width < 1 ||
          frame.height < 1
        )
          return
        const width = Math.floor(frame.width),
          height = Math.floor(frame.height)
        const key = `${width}:${height}`
        if (key !== sizeKey) {
          const next = createGummyTargets(
            root,
            device,
            width,
            height,
            sampler,
            mesh.runtimeFracture,
          )
          targets?.destroy()
          targets = next
          sizeKey = key
        }
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
        camera.write(cameraData.buffer)
        const encoder = root['~unstable'].createCommandEncoder({
          label: 'Gummy filled body frame',
        })
        const normalPass = encoder.beginComputePass()
        compute.with(normalPass).dispatchWorkgroups(Math.ceil(vertexCount / 64))
        normalPass.end()
        const light = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: lightView,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        shadow.with(light).drawIndexed(surface.indices.length)
        if (!frame.clay) caustic.with(light).drawIndexed(surface.indices.length)
        light.end()
        const scene = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets!.multisample,
              resolveTarget: targets!.scene,
              clearValue: [0.72, 0.65, 0.55, 1],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: targets!.depth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        })
        background.with(floorGroup).with(scene).draw(3)
        scene.end()
        if (targets!.fronts) {
          const provenancePass = encoder.beginRenderPass({
            label: 'Gummy visible component',
            colorAttachments: [
              {
                view: targets!.fronts,
                clearValue: [0, 0, 0, 0],
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
            depthStencilAttachment: {
              view: targets!.exitDepth,
              depthClearValue: 1,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
            },
          })
          frontTags.with(provenancePass).drawIndexed(surface.indices.length)
          provenancePass.end()
        }
        const exitPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets!.exits,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: targets!.restExits,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: targets!.exitDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        })
        const filteredExits = targets!.exitFilter
          ? exits.with(targets!.exitFilter)
          : exits
        filteredExits.with(exitPass).drawIndexed(surface.indices.length)
        exitPass.end()
        const optical = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets!.multisample,
              resolveTarget: targets!.final,
              loadOp: 'load',
              storeOp: 'discard',
            },
          ],
          depthStencilAttachment: {
            view: targets!.depth,
            depthLoadOp: 'load',
            depthStoreOp: 'discard',
          },
        })
        front
          .with(targets!.optical)
          .with(optical)
          .drawIndexed(surface.indices.length)
        optical.end()
        const final = encoder.beginRenderPass({
          colorAttachments: [
            { view: context, loadOp: 'clear', storeOp: 'store' },
          ],
        })
        display.with(targets!.display).with(final).draw(3)
        final.end()
        encoder.submit()
      },
      destroy() {
        if (disposed) return
        disposed = true
        targets?.destroy()
        for (const resource of owned) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned) resource.destroy()
    throw error
  }
}
