/** GPU-only MPM meshing and filled candy optics; existing screen-space renderer remains available. */
import { common, d } from 'typegpu'
import { gummyBackgroundFragment, GummyCamera, gummyCameraLayout, gummyDisplayFragment, gummyFloorLayout, } from './gummyShaders'
import { marchingGummyLightFragment, marchingGummyLightVertex, marchingGummyShadowFragment, marchingGummyShadowVertex, } from './marchingGummyLight'
import { marchingGummyComposite, marchingGummyExitFragment, marchingGummyFrontFragment, marchingGummyMeshLayout, marchingGummyVertex, } from './marchingGummyRenderShaders'
import { createMarchingGummySurface } from './marchingGummySurface'
import { createMarchingGummyTargets } from './marchingGummyTargets'
import { packParticleGummyCamera } from './particleGummyRenderer'
import type { TgpuRoot } from 'typegpu'
import type { GummyFrame } from './gummyRenderer'
import type { ParticleGummyRenderState } from './particleGummyRenderer'

export type MarchingGummyRenderOptions = {
  raw?: boolean
  caustics?: boolean
  /** Particle-state version; camera and lighting changes can reuse the existing mesh. */
  revision?: number
}

export function createMarchingGummyRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  particles: ParticleGummyRenderState & {
    gridBounds: { min: number[]; max: number[] }
  },
) {
  if (root.device !== device)
    throw new Error('Marching gummy renderer root and device must match')
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const surface = own(createMarchingGummySurface(root, device, particles))
    const camera = own(root.createBuffer(GummyCamera).$usage('uniform'))
    const cameraData = new Float32Array(d.sizeOf(GummyCamera) / 4)
    const cameraGroup = root.createBindGroup(gummyCameraLayout, { camera })
    const meshGroup = root.createBindGroup(marchingGummyMeshLayout, {
      vertices: surface.vertices,
    })
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
    })
    const lightTexture = own(
      device.createTexture({
        label: 'Marching gummy refracted floor light',
        size: [512, 512],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    )
    const light = lightTexture.createView()
    const floorGroup = root.createBindGroup(gummyFloorLayout, {
      light,
      sampler,
    })
    const depth: GPUDepthStencilState = {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    }
    const blend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
    const front = root
      .createRenderPipeline({
        vertex: marchingGummyVertex,
        fragment: marchingGummyFrontFragment,
        targets: {
          front: { format: 'rgba16float' },
          rest: { format: 'rgba16float' },
        },
        depthStencil: depth,
      })
      .with(cameraGroup)
      .with(meshGroup)
    const exit = root
      .createRenderPipeline({
        vertex: marchingGummyVertex,
        fragment: marchingGummyExitFragment,
        targets: { format: 'rgba16float' },
        depthStencil: depth,
      })
      .with(cameraGroup)
      .with(meshGroup)
    const caustics = root
      .createRenderPipeline({
        vertex: marchingGummyLightVertex,
        fragment: marchingGummyLightFragment,
        targets: { format: 'rgba16float', blend },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)
      .with(meshGroup)
    const shadow = root
      .createRenderPipeline({
        vertex: marchingGummyShadowVertex,
        fragment: marchingGummyShadowFragment,
        targets: { format: 'rgba16float', blend },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)
      .with(meshGroup)
    const background = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyBackgroundFragment,
        targets: { colour: { format: 'rgba16float' } },
        depthStencil: { ...depth, depthCompare: 'always' },
      })
      .with(cameraGroup)
      .with(floorGroup)
    const composite = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: marchingGummyComposite,
        targets: { format: 'rgba16float' },
      })
      .with(cameraGroup)
    const display = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyDisplayFragment,
        targets: { format },
      })
      .with(cameraGroup)
    for (const pipeline of [
      front,
      exit,
      caustics,
      shadow,
      background,
      composite,
      display,
    ])
      root.unwrap(pipeline)
    let targets: ReturnType<typeof createMarchingGummyTargets> | undefined
    let lastRevision: number | undefined
    let sizeKey = '',
      disposed = false
    const colour = (view: GPUTextureView): GPURenderPassColorAttachment => ({
      view,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: [0, 0, 0, 0],
    })
    const depthAttachment = (
      view: GPUTextureView,
    ): GPURenderPassDepthStencilAttachment => ({
      view,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    })
    return {
      readSurfaceStats: () => surface.readStats(),
      render(frame: GummyFrame, options: MarchingGummyRenderOptions = {}) {
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
          const next = createMarchingGummyTargets(
            root,
            device,
            width,
            height,
            sampler,
          )
          targets?.destroy()
          targets = next
          sizeKey = key
        }
        const target = targets!
        packParticleGummyCamera(
          cameraData,
          frame,
          format,
          surface.cellSize,
          width,
          height,
        )
        camera.write(cameraData.buffer)
        const encoder = device.createCommandEncoder({
          label: 'MPM marching cubes frame',
        })
        if (
          options.revision === undefined ||
          options.revision !== lastRevision
        ) {
          surface.encode(encoder)
          lastRevision = options.revision
        }
        const lightPass = encoder.beginRenderPass({
          colorAttachments: [colour(light)],
        })
        shadow.with(lightPass).drawIndirect(surface.indirect)
        if (options.caustics !== false)
          caustics.with(lightPass).drawIndirect(surface.indirect)
        lightPass.end()
        const scenePass = encoder.beginRenderPass({
          colorAttachments: [colour(target.scene)],
          depthStencilAttachment: depthAttachment(target.sceneDepth),
        })
        background.with(scenePass).draw(3)
        scenePass.end()
        const frontPass = encoder.beginRenderPass({
          colorAttachments: [colour(target.front), colour(target.rest)],
          depthStencilAttachment: depthAttachment(target.frontDepth),
        })
        front.with(target.opaque).with(frontPass).drawIndirect(surface.indirect)
        frontPass.end()
        const exitPass = encoder.beginRenderPass({
          colorAttachments: [colour(target.exit)],
          depthStencilAttachment: depthAttachment(target.exitDepth),
        })
        exit
          .with(target.frontSource)
          .with(exitPass)
          .drawIndirect(surface.indirect)
        exitPass.end()
        const compositePass = encoder.beginRenderPass({
          colorAttachments: [colour(target.final)],
        })
        composite.with(target.composite).with(compositePass).draw(3)
        compositePass.end()
        const displayPass = encoder.beginRenderPass({
          colorAttachments: [colour(context.getCurrentTexture().createView())],
        })
        display.with(target.display).with(displayPass).draw(3)
        displayPass.end()
        device.queue.submit([encoder.finish()])
      },
      destroy() {
        if (disposed) return
        disposed = true
        targets?.destroy()
        for (const item of owned) item.destroy()
      },
    }
  } catch (error) {
    for (const item of owned) item.destroy()
    throw error
  }
}
