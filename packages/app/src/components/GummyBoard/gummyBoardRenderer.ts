/** One or two deforming candy pieces share the board HDR optics with cached waiting instances. */
import { createMarchingGummyTargets } from '../GummyBear/marchingGummyTargets'
import { packParticleGummyCamera } from '../GummyBear/particleGummyRenderer'
import { createGummyBoardInstanceUpdates } from './gummyBoardInstanceUpdates'
import { createGummyBoardRenderPipelines } from './gummyBoardRenderPipelines'
import { createGummyBoardRenderResources } from './gummyBoardRenderResources'
import { gummyBoardExitLayout } from './gummyBoardShaders'
import { gummyBoardGlassLightFragment, gummyBoardGlassLightVertex, gummyBoardReceiverLayout, } from './gummyBoardStageShaders'
import { GUMMY_BOARD_GLASS_LIGHT_GRID } from './gummyBoardThemes'
import type { TgpuBindGroup, TgpuRoot } from 'typegpu'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyFrame } from '../GummyBear/gummyRenderer'
import type { GummyBoardMeshQuality } from './gummyBoardMeshPreparation'
import type { GummyBoardParticleState, GummyBoardRenderOptions, } from './gummyBoardRenderContracts'

export type { GummyBoardPiece } from './gummyBoardInstances'

export type {
  GummyBoardParticleState,
  GummyBoardRenderOptions,
  GummyBoardSecondaryPiece,
} from './gummyBoardRenderContracts'

export async function createGummyBoardRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  particles?: GummyBoardParticleState,
  secondaryParticles?: GummyBoardParticleState,
  quality: GummyBoardMeshQuality = {},
) {
  if (root.device !== device)
    throw new Error('Gummy board renderer root and device must match')
  const lightResolution = quality.lightResolution ?? 1024
  if (lightResolution !== 512 && lightResolution !== 1024)
    throw new Error('Gummy board lighting resolution must be 512 or 1024')
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const resources = await createGummyBoardRenderResources(
      root,
      device,
      quality,
      particles,
      secondaryParticles,
      lightResolution,
      own,
    )
    const {
      restMeshes,
      surface,
      secondarySurface,
      camera,
      cameraData,
      previousCamera,
      uploadChanged,
      sources,
      sampler,
      lightTexture,
      staticLightTexture,
      staticLight,
      light,
      blend,
    } = resources
    let { boardLight, receiverGroup } = resources
    const { front, exit, caustics, shadow, background, composite, display } =
      createGummyBoardRenderPipelines(root, format, quality, resources)
    let targets: ReturnType<typeof createMarchingGummyTargets> | undefined
    let exitSource:
      | TgpuBindGroup<typeof gummyBoardExitLayout.entries>
      | undefined
    let lastRevision: number | undefined
    let lastSecondaryRevision: number | undefined
    let lightReady = false
    let boardLightUpdates = 0
    let staticLightUpdates = 0,
      dynamicLightUpdates = 0,
      staticLightCacheHits = 0,
      lightCacheHits = 0
    let previousCaustics: boolean | undefined
    let previousPalette: GummyPalette | undefined
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

    const updateInstances = createGummyBoardInstanceUpdates(resources)

    function encodeSurfaces(
      encoder: GPUCommandEncoder,
      options: GummyBoardRenderOptions,
    ) {
      let changed = false
      if (
        surface &&
        (options.revision === undefined || options.revision !== lastRevision)
      ) {
        surface.encode(encoder)
        changed = true
        lastRevision = options.revision
      }
      if (
        options.secondary &&
        secondarySurface &&
        (options.secondary.revision === undefined ||
          options.secondary.revision !== lastSecondaryRevision)
      ) {
        secondarySurface.encode(encoder)
        changed = true
        lastSecondaryRevision = options.secondary.revision
      }
      return changed
    }

    function encodeLighting(
      encoder: GPUCommandEncoder,
      options: GummyBoardRenderOptions,
      paletteInput: GummyPalette | undefined,
      changes: { staticChanged: boolean; dynamicChanged: boolean },
      surfaceChanged: boolean,
    ) {
      const hasCaustics = options.caustics !== false
      const palette = paletteInput ?? 'blue'
      const lightingChanged =
        !lightReady ||
        previousCaustics !== hasCaustics ||
        previousPalette !== palette
      const drawLight = (pass: GPURenderPassEncoder, dynamic: boolean) => {
        for (const source of sources) {
          if (
            source.dynamic !== dynamic ||
            source.count === 0 ||
            (source.secondary && !options.secondary)
          )
            continue
          shadow
            .with(source.mesh)
            .with(source.instances)
            .with(pass)
            .drawIndirect(source.indirect)
          if (hasCaustics)
            caustics
              .with(source.mesh)
              .with(source.instances)
              .with(pass)
              .drawIndirect(source.indirect)
        }
      }
      if (lightingChanged || changes.staticChanged) {
        const staticPass = encoder.beginRenderPass({
          colorAttachments: [colour(staticLight)],
        })
        drawLight(staticPass, false)
        staticPass.end()
        staticLightUpdates++
      } else staticLightCacheHits++
      if (
        lightingChanged ||
        changes.staticChanged ||
        changes.dynamicChanged ||
        surfaceChanged
      ) {
        encoder.copyTextureToTexture(
          { texture: staticLightTexture },
          { texture: lightTexture },
          [lightResolution, lightResolution],
        )
        const lightPass = encoder.beginRenderPass({
          colorAttachments: [{ view: light, loadOp: 'load', storeOp: 'store' }],
        })
        drawLight(lightPass, true)
        lightPass.end()
        lightReady = true
        previousCaustics = hasCaustics
        previousPalette = palette
        dynamicLightUpdates++
      } else lightCacheHits++
    }

    function resizeTargets(width: number, height: number) {
      const key = `${width}:${height}`
      if (key !== sizeKey) {
        const next = createMarchingGummyTargets(
          root,
          device,
          width,
          height,
          sampler,
        )
        let nextExit: TgpuBindGroup<typeof gummyBoardExitLayout.entries>
        try {
          nextExit = root.createBindGroup(gummyBoardExitLayout, {
            front: next.front,
            rest: next.rest,
          })
        } catch (error) {
          // Keep the previous frame usable if replacing its attachments fails.
          next.destroy()
          throw error
        }
        targets?.destroy()
        targets = next
        exitSource = nextExit
        sizeKey = key
      }
    }

    function encodeBoardCaustics(
      encoder: GPUCommandEncoder,
      options: GummyBoardRenderOptions,
    ) {
      // Camera and material animation cannot invalidate static slab transport.
      if (
        boardLightUpdates === 0 &&
        options.boardTheme === 'glass' &&
        options.caustics !== false
      ) {
        const boardCaustics = root.createRenderPipeline({
          vertex: gummyBoardGlassLightVertex,
          fragment: gummyBoardGlassLightFragment,
          targets: { format: 'rgba16float', blend },
          primitive: { cullMode: 'none' },
        })
        root.unwrap(boardCaustics)
        const boardLightTexture = own(
          device.createTexture({
            label: 'Gummy glass board transmitted receiver light',
            size: [lightResolution, lightResolution],
            format: 'rgba16float',
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING,
          }),
        )
        boardLight = boardLightTexture.createView()
        receiverGroup = root.createBindGroup(gummyBoardReceiverLayout, {
          light: boardLight,
          sampler,
        })
        const boardLightPass = encoder.beginRenderPass({
          colorAttachments: [colour(boardLight)],
        })
        boardCaustics
          .with(boardLightPass)
          .draw(GUMMY_BOARD_GLASS_LIGHT_GRID ** 2 * 6)
        boardLightPass.end()
        boardLightUpdates++
      }
    }

    return {
      readRenderStats: () => ({
        lightResolution,
        boardLightUpdates,
        staticLightUpdates,
        dynamicLightUpdates,
        staticLightCacheHits,
        lightCacheHits,
        restVertexCounts: Object.fromEntries(
          [...restMeshes.meshes].map(([mould, mesh]) => [
            mould,
            mesh.vertexCount,
          ]),
        ),
      }),
      readSurfaceStats: () => {
        if (!surface) throw new Error('This board has no simulated piece.')
        return surface.readStats()
      },
      readSecondarySurfaceStats: () =>
        secondarySurface?.readStats() ?? Promise.resolve(undefined),
      render(frame: GummyFrame, options: GummyBoardRenderOptions) {
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
        resizeTargets(width, height)
        const target = targets!
        packParticleGummyCamera(
          cameraData,
          frame,
          format,
          surface?.cellSize ?? 0.08,
          width,
          height,
        )
        uploadChanged(camera, cameraData, previousCamera)
        const changes = updateInstances(options)
        const encoder = device.createCommandEncoder({
          label: 'Gummy board frame',
        })
        const surfaceChanged = encodeSurfaces(encoder, options)
        encodeLighting(encoder, options, frame.palette, changes, surfaceChanged)
        encodeBoardCaustics(encoder, options)
        const scenePass = encoder.beginRenderPass({
          colorAttachments: [colour(target.scene)],
          depthStencilAttachment: depthAttachment(target.sceneDepth),
        })
        background.with(receiverGroup).with(scenePass).draw(3)
        scenePass.end()
        const frontPass = encoder.beginRenderPass({
          colorAttachments: [colour(target.front), colour(target.rest)],
          depthStencilAttachment: depthAttachment(target.frontDepth),
        })
        for (const source of sources) {
          if (source.count === 0 || (source.secondary && !options.secondary))
            continue
          front
            .with(target.opaque)
            .with(source.mesh)
            .with(source.instances)
            .with(frontPass)
            .drawIndirect(source.indirect)
        }
        frontPass.end()
        const exitPass = encoder.beginRenderPass({
          colorAttachments: [colour(target.exit)],
          depthStencilAttachment: depthAttachment(target.exitDepth),
        })
        for (const source of sources) {
          if (source.count === 0 || (source.secondary && !options.secondary))
            continue
          exit
            .with(exitSource!)
            .with(source.mesh)
            .with(source.instances)
            .with(exitPass)
            .drawIndirect(source.indirect)
        }
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

export type GummyBoardRenderer = Awaited<
  ReturnType<typeof createGummyBoardRenderer>
>
