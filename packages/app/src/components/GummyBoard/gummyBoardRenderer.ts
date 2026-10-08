/** One or two deforming candy pieces share the board HDR optics with cached waiting instances. */
import { common, d } from 'typegpu'
import { GummyCamera, gummyCameraLayout, gummyDisplayFragment, gummyFloorLayout, } from '../GummyBear/gummyShaders'
import { marchingGummyArtSlot, marchingGummyComposite, marchingGummyFillSlot, marchingGummyMaterialSlot, marchingGummyMeshLayout, } from '../GummyBear/marchingGummyRenderShaders'
import { createMarchingGummySurface } from '../GummyBear/marchingGummySurface'
import { createMarchingGummyTargets } from '../GummyBear/marchingGummyTargets'
import { packParticleGummyCamera } from '../GummyBear/particleGummyRenderer'
import { GUMMY_BOARD_INSTANCE_FLOATS, GUMMY_BOARD_MAX_PIECES, GUMMY_BOARD_MOULDS, packGummyBoardInstance, packGummyBoardInstances, } from './gummyBoardInstances'
import { createGummyBoardRestMeshes } from './gummyBoardRestMeshes'
import { gummyBoardBackgroundFragment, gummyBoardExitFragment, gummyBoardExitLayout, gummyBoardFill, gummyBoardFrontFragment, GummyBoardInstance, gummyBoardInstanceLayout, gummyBoardLightFragment, gummyBoardLightVertex, gummyBoardMaterialLayout, gummyBoardOptics, gummyBoardShadowFragment, gummyBoardShadowVertex, gummyBoardVertex, } from './gummyBoardShaders'
import { gummyBoardGlassLightFragment, gummyBoardGlassLightVertex, gummyBoardReceiverLayout, GummyBoardStage, gummyBoardStageLayout, } from './gummyBoardStageShaders'
import { GUMMY_BOARD_GLASS_LIGHT_GRID, gummyBoardThemeCode, } from './gummyBoardThemes'
import type { TgpuBindGroup, TgpuRoot } from 'typegpu'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyFrame } from '../GummyBear/gummyRenderer'
import type { MarchingGummyInput } from '../GummyBear/marchingGummySurface'
import type { GummyBoardPiece } from './gummyBoardInstances'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { GummyBoardTheme } from './gummyBoardThemes'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'
import type { GummyChessArtStyle } from '@/simulation/gummy/gummyChessMoulds'

export type { GummyBoardPiece } from './gummyBoardInstances'

/** Reconstruction bounds/cell size can differ from the solver's working grid. */
export type GummyBoardParticleState = MarchingGummyInput
export type GummyBoardSecondaryPiece = {
  id: number
  position: readonly [number, number, number]
  side: 0 | 1
  revision?: number
  scale?: number
  palette?: GummyPalette
  rotationY?: number
}

export type GummyBoardRenderOptions = {
  secondary?: GummyBoardSecondaryPiece
  pieces: readonly GummyBoardPiece[]
  victimPosition: readonly [number, number, number]
  victimId: number
  victimSide?: 0 | 1
  victimScale?: number
  victimPalette?: GummyPalette
  selectedPieceId?: number
  /** Optional world anchor for a live body whose particle coordinates already contain motion. */
  selectionPosition?: readonly [number, number, number]
  /** A cached mould whose transform moves; its floor lighting remains separate from waiting pieces. */
  movingPieceId?: number
  /** Extra absorption for supporting pieces in a directed shot; one preserves normal optics. */
  supportingDensity?: number
  boardTheme?: GummyBoardTheme
  /** Deterministic presentation time; only molten material changes with time. */
  boardTime?: number
  caustics?: boolean
  /** Particle-state version; camera and lighting changes can reuse the existing mesh. */
  revision?: number
}

export async function createGummyBoardRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  particles?: GummyBoardParticleState,
  secondaryParticles?: GummyBoardParticleState,
  quality: {
    lightResolution?: 512 | 1024
    artStyle?: GummyChessArtStyle
    authoredPawn?: GummyAuthoredPawn
    signal?: AbortSignal
    /** A scene owner can share immutable moulds across static play and cinematic captures. */
    restMeshPool?: GummyBoardRestMeshPool
    /** Waiting-piece detail is independent of the live victim's particle resolution. */
    restSpacing?: number
  } = {},
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
    const restMeshes = own(
      await (quality.restMeshPool?.acquire ?? createGummyBoardRestMeshes)(
        root,
        device,
        quality.restSpacing ?? particles?.spacing ?? 0.08,
        quality.artStyle,
        quality.signal,
        quality.authoredPawn,
      ),
    )
    quality.signal?.throwIfAborted()
    // Local games keep every waiting piece static. No MPM surface or density grid is allocated.
    const surface = particles
      ? own(createMarchingGummySurface(root, device, particles))
      : undefined
    const secondarySurface = secondaryParticles
      ? own(createMarchingGummySurface(root, device, secondaryParticles))
      : undefined
    const camera = own(root.createBuffer(GummyCamera).$usage('uniform'))
    const cameraData = new Float32Array(d.sizeOf(GummyCamera) / 4)
    const cameraGroup = root.createBindGroup(gummyCameraLayout, { camera })
    const previousCamera = new Float32Array(cameraData.length).fill(NaN)
    /** Avoid queue writes when orbiting a paused board or uploading unchanged waiting pieces. */
    const uploadChanged = (
      buffer: { write(value: ArrayBuffer): void },
      data: Float32Array<ArrayBuffer>,
      previous: Float32Array,
    ) => {
      if (data.every((value, index) => value === previous[index])) return false
      buffer.write(data.buffer)
      previous.set(data)
      return true
    }
    const makeInstances = (count: number) => {
      const buffer = own(
        root
          .createBuffer(d.arrayOf(GummyBoardInstance, count))
          .$usage('storage'),
      )
      return {
        buffer,
        data: new Float32Array(count * GUMMY_BOARD_INSTANCE_FLOATS),
        previous: new Float32Array(count * GUMMY_BOARD_INSTANCE_FLOATS).fill(
          NaN,
        ),
        group: root.createBindGroup(gummyBoardInstanceLayout, {
          instances: buffer,
        }),
      }
    }
    const victim = makeInstances(1)
    const secondary = secondarySurface ? makeInstances(1) : undefined
    const batches = GUMMY_BOARD_MOULDS.map((mould) => {
      const mesh = restMeshes.meshes.get(mould)!
      const instances = makeInstances(GUMMY_BOARD_MAX_PIECES)
      const indirect = own(
        root.createBuffer(d.arrayOf(d.u32, 4)).$usage('indirect'),
      )
      return {
        mould,
        ...instances,
        drawData: new Uint32Array([mesh.vertexCount, 0, 0, 0]),
        source: {
          mesh: root.createBindGroup(marchingGummyMeshLayout, {
            vertices: mesh.vertices,
          }),
          instances: instances.group,
          indirect,
          count: 0,
          dynamic: false,
          secondary: false,
        },
      }
    })
    const moving = makeInstances(1)
    const movingDraw = own(
      root.createBuffer(d.arrayOf(d.u32, 4)).$usage('indirect'),
    )
    const movingDrawData = new Uint32Array([0, 1, 0, 0])
    const movingSource = {
      mesh: batches[0]!.source.mesh,
      instances: moving.group,
      indirect: movingDraw,
      count: 0,
      dynamic: true,
      secondary: false,
    }
    const sources = [movingSource, ...batches.map((batch) => batch.source)]
    if (surface)
      sources.push({
        mesh: root.createBindGroup(marchingGummyMeshLayout, {
          vertices: surface.vertices,
        }),
        instances: victim.group,
        indirect: surface.indirect,
        count: 1,
        dynamic: true,
        secondary: false,
      })
    if (secondarySurface && secondary)
      sources.push({
        mesh: root.createBindGroup(marchingGummyMeshLayout, {
          vertices: secondarySurface.vertices,
        }),
        instances: secondary.group,
        indirect: secondarySurface.indirect,
        count: 1,
        dynamic: true,
        secondary: true,
      })
    const instanceData = new Float32Array(
      GUMMY_BOARD_MAX_PIECES * GUMMY_BOARD_INSTANCE_FLOATS,
    )
    const materials = own(
      root.createBuffer(d.arrayOf(d.vec4f, 2048)).$usage('storage'),
    )
    const materialData = new Float32Array(2048 * 4)
    const previousMaterials = new Float32Array(materialData.length).fill(NaN)
    const materialGroup = root.createBindGroup(gummyBoardMaterialLayout, {
      materials,
    })
    const stage = own(root.createBuffer(GummyBoardStage).$usage('uniform'))
    const stageData = new Float32Array(8)
    const previousStage = new Float32Array(8).fill(NaN)
    const stageGroup = root.createBindGroup(gummyBoardStageLayout, { stage })
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
    })
    const lightTexture = own(
      device.createTexture({
        label: 'Gummy board refracted floor light',
        size: [lightResolution, lightResolution],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST,
      }),
    )
    const staticLightTexture = own(
      device.createTexture({
        label: 'Gummy board cached waiting-piece light',
        size: [lightResolution, lightResolution],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      }),
    )
    const staticLight = staticLightTexture.createView()
    const light = lightTexture.createView()
    const floorGroup = root.createBindGroup(gummyFloorLayout, {
      light,
      sampler,
    })
    const emptyBoardLightTexture = own(
      device.createTexture({
        label: 'Gummy board empty receiver light',
        size: [1, 1],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    )
    let boardLight = emptyBoardLightTexture.createView()
    let receiverGroup = root.createBindGroup(gummyBoardReceiverLayout, {
      light: boardLight,
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
        vertex: gummyBoardVertex,
        fragment: gummyBoardFrontFragment,
        targets: {
          front: { format: 'rgba16float' },
          rest: { format: 'rgba16float' },
        },
        depthStencil: depth,
      })
      .with(cameraGroup)

    const exit = root
      .createRenderPipeline({
        vertex: gummyBoardVertex,
        fragment: gummyBoardExitFragment,
        targets: { format: 'rgba16float' },
        depthStencil: depth,
      })
      .with(cameraGroup)

    const caustics = root
      .createRenderPipeline({
        vertex: gummyBoardLightVertex,
        fragment: gummyBoardLightFragment,
        targets: { format: 'rgba16float', blend },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)

    const shadow = root
      .createRenderPipeline({
        vertex: gummyBoardShadowVertex,
        fragment: gummyBoardShadowFragment,
        targets: { format: 'rgba16float', blend },
        primitive: { cullMode: 'none' },
      })
      .with(cameraGroup)

    const background = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyBoardBackgroundFragment,
        targets: { colour: { format: 'rgba16float' } },
        depthStencil: { ...depth, depthCompare: 'always' },
      })
      .with(cameraGroup)
      .with(floorGroup)
      .with(stageGroup)
    const composite = root
      .with(marchingGummyMaterialSlot, gummyBoardOptics)
      .with(marchingGummyArtSlot, quality.artStyle === 'sculpted')
      .with(marchingGummyFillSlot, gummyBoardFill)
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: marchingGummyComposite,
        targets: { format: 'rgba16float' },
      })
      .with(cameraGroup)
      .with(materialGroup)
      .with(stageGroup)
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
    let previousSecondary = false
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

    function updateSelection(options: GummyBoardRenderOptions) {
      stageData.fill(0)
      const selected = options.pieces.find(
        (piece) => piece.id === options.selectedPieceId,
      )
      const selectedPosition =
        options.selectionPosition ??
        selected?.position ??
        (options.selectedPieceId === options.victimId
          ? options.victimPosition
          : options.selectedPieceId === options.secondary?.id
            ? options.secondary?.position
            : undefined)
      const selectedScale =
        selected?.scale ??
        (options.selectedPieceId === options.victimId
          ? options.victimScale
          : options.secondary?.scale) ??
        1
      if (selectedPosition)
        stageData.set([
          selectedPosition[0],
          selectedPosition[2],
          0.86 * selectedScale,
          1,
        ])
      stageData[4] = gummyBoardThemeCode(options.boardTheme)
      const boardTime = options.boardTime ?? 0
      stageData[5] = Number.isFinite(boardTime) ? Math.max(0, boardTime) : 0
      stageData[6] = options.caustics === false ? 0 : 1
      uploadChanged(stage, stageData, previousStage)
    }

    function updateActiveInstances(options: GummyBoardRenderOptions) {
      if (!surface) return false
      packGummyBoardInstance(
        victim.data,
        0,
        options.victimId,
        options.victimPosition,
        options.victimSide ?? 0,
        options.victimScale,
        options.victimPalette,
      )
      let dynamicChanged = uploadChanged(
        victim.buffer,
        victim.data,
        victim.previous,
      )
      if (options.secondary && secondary) {
        packGummyBoardInstance(
          secondary.data,
          0,
          options.secondary.id,
          options.secondary.position,
          options.secondary.side,
          options.secondary.scale,
          options.secondary.palette,
          options.secondary.rotationY,
        )
        dynamicChanged =
          uploadChanged(secondary.buffer, secondary.data, secondary.previous) ||
          dynamicChanged
      }
      return dynamicChanged
    }

    function updateInstances(options: GummyBoardRenderOptions) {
      if (options.secondary && !secondarySurface)
        throw new Error(
          'A second gummy surface must be supplied when creating the board renderer',
        )
      let ranges = packGummyBoardInstances(
        instanceData,
        options.pieces,
        surface ? options.victimId : undefined,
        options.secondary?.id,
      )
      const movingPiece = options.pieces.find(
        (piece) => piece.id === options.movingPieceId,
      )
      if (movingPiece)
        ranges = packGummyBoardInstances(
          instanceData,
          options.pieces.filter((piece) => piece.id !== options.movingPieceId),
          surface ? options.victimId : undefined,
          options.secondary?.id,
        )
      let dynamicChanged = updateActiveInstances(options)
      const movingCount = movingPiece ? 1 : 0
      dynamicChanged ||= movingSource.count !== movingCount
      movingSource.count = movingCount
      if (movingPiece) {
        packGummyBoardInstance(
          moving.data,
          0,
          movingPiece.id,
          movingPiece.position,
          movingPiece.side,
          movingPiece.scale,
          movingPiece.palette,
          movingPiece.rotationY,
        )
        dynamicChanged =
          uploadChanged(moving.buffer, moving.data, moving.previous) ||
          dynamicChanged
        const batch = batches.find(
          (candidate) => candidate.mould === movingPiece.mould,
        )!
        if (
          movingSource.mesh !== batch.source.mesh ||
          movingDrawData[0] !== batch.drawData[0]
        ) {
          movingSource.mesh = batch.source.mesh
          movingDrawData[0] = batch.drawData[0]!
          movingDraw.write(movingDrawData.buffer)
          dynamicChanged = true
        }
      }
      let staticChanged = false
      for (const batch of batches) {
        const range = ranges.get(batch.mould)!
        batch.data.fill(0)
        batch.data.set(
          instanceData.subarray(
            range.start * GUMMY_BOARD_INSTANCE_FLOATS,
            (range.start + range.count) * GUMMY_BOARD_INSTANCE_FLOATS,
          ),
        )
        const changed = uploadChanged(batch.buffer, batch.data, batch.previous)
        if (changed || batch.source.count !== range.count) {
          batch.drawData[1] = range.count
          batch.source.indirect.write(batch.drawData.buffer)
          staticChanged = true
        }
        batch.source.count = range.count
      }
      materialData.fill(0)
      const material = (data: Float32Array, offset: number) => {
        const index = (data[offset + 3]! - 1) * 4
        materialData[index] = data[offset + 8]!
        materialData[index + 1] = data[offset + 9]!
        materialData[index + 2] = data[offset + 7]!
      }
      for (let index = 0; index < options.pieces.length - movingCount; index++)
        material(instanceData, index * GUMMY_BOARD_INSTANCE_FLOATS)
      if (surface) material(victim.data, 0)
      if (movingPiece) material(moving.data, 0)
      if (options.secondary && secondary) material(secondary.data, 0)
      if (options.supportingDensity !== undefined) {
        const density = options.supportingDensity
        if (!Number.isFinite(density) || density < 1 || density > 3)
          throw new RangeError(
            'Supporting candy density must be between one and three.',
          )
        for (const piece of options.pieces)
          if (piece.id !== options.movingPieceId)
            materialData[piece.id * 4 + 3] = density
      }
      uploadChanged(materials, materialData, previousMaterials)
      updateSelection(options)
      dynamicChanged ||= previousSecondary !== Boolean(options.secondary)
      previousSecondary = Boolean(options.secondary)
      return { staticChanged, dynamicChanged }
    }

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
