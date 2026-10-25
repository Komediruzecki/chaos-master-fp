/** Owned linear-HDR scene with hollow-glass transmission, native coloured cores and shards. */
import { common, d } from 'typegpu'
import { buildPawnShellFragments, buildPawnShellGeometry, } from '@/flame/chess/pawnBoardGeometry'
import { createPawnBoardCloud } from './pawnBoardCloud'
import { createPawnBoardGlassVariants } from './pawnBoardGlassVariants'
import { CAPACITY, fillPieceInstances, fillTiles, writeInstance, } from './pawnBoardInstances'
import { BOARD_TILE_SIZE } from './pawnBoardMath'
import { cube } from './pawnBoardMesh'
import { backgroundFragment, BoardCameraUniform, boardFragment, cameraLayout, cloudFragment, cloudVertex, displayFragment, fragmentLayout, fragmentVertex, glassExitFragment, glassFragment, instanceLayout, meshLayout, meshVertex, shardFragment, variantGlassFragmentVertex, } from './pawnBoardShaders'
import { createPawnBoardSolidVariants } from './pawnBoardSolidVariants'
import { createPawnBoardVariants } from './pawnBoardVariants'
import { createPawnGlassTargets } from './pawnGlassTargets'
import type { TgpuRenderPass, TgpuRenderPipeline, TgpuRoot } from 'typegpu'
import type { BoardFrame } from './pawnBoardTypes'
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'

export type { BoardFrame, BoardPawnInstance } from './pawnBoardTypes'

export function createPawnBoardRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
) {
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const camera = own(root.createBuffer(BoardCameraUniform).$usage('uniform'))
    const cameraGroup = root.createBindGroup(cameraLayout, { camera })
    const cameraData = new Float32Array(d.sizeOf(BoardCameraUniform) / 4)
    const instanceBuffer = () =>
      own(
        root
          .createBuffer(instanceLayout.schemaForCount(CAPACITY))
          .$usage('vertex'),
      )
    const shells = instanceBuffer(),
      frost = instanceBuffer(),
      ember = instanceBuffer(),
      shards = instanceBuffer()
    const shellData = new Float32Array(CAPACITY * 12)
    const frostData = new Float32Array(CAPACITY * 12)
    const emberData = new Float32Array(CAPACITY * 12)
    const shardData = new Float32Array(CAPACITY * 12)
    const tiles = own(
      root.createBuffer(instanceLayout.schemaForCount(64)).$usage('vertex'),
    )
    const tileData = new Float32Array(64 * 12)
    const boardBase = own(
      root.createBuffer(instanceLayout.schemaForCount(1)).$usage('vertex'),
    )
    const baseData = new Float32Array([
      0, -0.265, 0, 1, 0.018, 0.031, 0.044, 1, -1, 0, -1, 0,
    ])
    boardBase.write(baseData.buffer)
    const tileGeometry = cube(
      BOARD_TILE_SIZE - 0.014,
      0.14,
      BOARD_TILE_SIZE - 0.014,
    )
    const baseGeometry = cube(13.26, 0.38, 13.26)
    const tileMesh = own(
      root
        .createBuffer(
          meshLayout.schemaForCount(tileGeometry.length / 6),
          (buffer) => {
            buffer.write(tileGeometry.buffer)
          },
        )
        .$usage('vertex'),
    )
    const baseMesh = own(
      root
        .createBuffer(
          meshLayout.schemaForCount(baseGeometry.length / 6),
          (buffer) => {
            buffer.write(baseGeometry.buffer)
          },
        )
        .$usage('vertex'),
    )
    const shellGeometry = buildPawnShellGeometry({
      radialSegments: 64,
      smoothNormals: true,
    })
    const shellMesh = own(
      root
        .createBuffer(
          meshLayout.schemaForCount(shellGeometry.vertices.length / 6),
          (buffer) => {
            buffer.write(new Float32Array(shellGeometry.vertices).buffer)
          },
        )
        .$usage('vertex'),
    )
    const fragments = buildPawnShellFragments({
      radialSegments: 64,
      smoothNormals: true,
    })
    const fragmentCount = fragments.reduce(
      (sum, piece) => sum + piece.vertices.length / 6,
      0,
    )
    const fragmentData = new Float32Array(fragmentCount * 15)
    let vertexIndex = 0
    for (const piece of fragments)
      for (let n = 0; n < piece.vertices.length; n += 6) {
        const offset = vertexIndex++ * 15
        fragmentData.set(piece.vertices.subarray(n, n + 6), offset)
        fragmentData.set(piece.centroid, offset + 6)
        fragmentData.set(piece.velocity, offset + 9)
        fragmentData.set(piece.angularVelocity, offset + 12)
      }
    const fragmentMesh = own(
      root
        .createBuffer(
          fragmentLayout.schemaForCount(fragmentCount),
          (buffer) => {
            buffer.write(fragmentData.buffer)
          },
        )
        .$usage('vertex'),
    )
    const blend: GPUBlendState = {
      color: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
      alpha: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
    }
    const depth = {
      format: 'depth24plus' as const,
      depthCompare: 'less-equal' as const,
    }
    const boardPipeline = root
      .createRenderPipeline({
        attribs: { ...meshLayout.attrib, ...instanceLayout.attrib },
        vertex: meshVertex,
        fragment: boardFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'back' },
        depthStencil: { ...depth, depthWriteEnabled: true },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
    const frontGlass = root
      .createRenderPipeline({
        attribs: { ...meshLayout.attrib, ...instanceLayout.attrib },
        vertex: meshVertex,
        fragment: glassFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'back' },
        depthStencil: { ...depth, depthWriteEnabled: true },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
    const exitsPipeline = root
      .createRenderPipeline({
        attribs: { ...meshLayout.attrib, ...instanceLayout.attrib },
        vertex: meshVertex,
        fragment: glassExitFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'front' },
        depthStencil: { ...depth, depthWriteEnabled: true },
      })
      .with(cameraGroup)
    const createShardPipeline = (vertex: typeof fragmentVertex) =>
      root
        .createRenderPipeline({
          attribs: { ...fragmentLayout.attrib, ...instanceLayout.attrib },
          vertex,
          fragment: shardFragment,
          targets: { format: 'rgba16float', blend },
          primitive: { cullMode: 'none' },
          depthStencil: { ...depth, depthWriteEnabled: false },
          multisample: { count: 4 },
        })
        .with(cameraGroup)
    const variantShardPipeline = createShardPipeline(variantGlassFragmentVertex)
    const shardPipeline = createShardPipeline(fragmentVertex)
      .with(fragmentLayout, fragmentMesh)
      .with(instanceLayout, shards)
    const createPointPipeline = (pointBlend: GPUBlendState) =>
      root
        .createRenderPipeline({
          attribs: instanceLayout.attrib,
          vertex: cloudVertex,
          fragment: cloudFragment,
          targets: { format: 'rgba16float', blend: pointBlend },
          primitive: { cullMode: 'none' },
          depthStencil: { ...depth, depthWriteEnabled: false },
          multisample: { count: 4 },
        })
        .with(cameraGroup)
    const pointPipeline = createPointPipeline({
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
    })
    const variantPointPipeline = createPointPipeline(blend)
    const backgroundPipeline = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: backgroundFragment,
        targets: { format: 'rgba16float' },
        depthStencil: {
          ...depth,
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
    const displayPipeline = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: displayFragment,
        targets: { format },
      })
      .with(cameraGroup)
    for (const pipeline of [
      boardPipeline,
      exitsPipeline,
      frontGlass,
      shardPipeline,
      variantShardPipeline,
      pointPipeline,
      variantPointPipeline,
      backgroundPipeline,
      displayPipeline,
    ])
      root.unwrap(pipeline)
    const clouds = new Map<PawnSide, ReturnType<typeof uploadCloud>>()
    const variants = createPawnBoardVariants(
      root,
      variantPointPipeline,
      writeInstance,
    )
    const glassVariants = createPawnBoardGlassVariants(root, writeInstance)
    const solidVariants = createPawnBoardSolidVariants(
      root,
      cameraGroup,
      writeInstance,
    )
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    let sizeKey = ''
    let targets: ReturnType<typeof createPawnGlassTargets> | undefined
    let disposed = false
    const displayTarget = (output?: GPUTextureView) => output ?? context

    function uploadCloud(
      side: PawnSide,
      points: Float32Array,
      colors?: Float32Array,
    ) {
      const cloud = createPawnBoardCloud(root, side, points, colors)
      return {
        count: cloud.count,
        pipeline: pointPipeline
          .with(cloud.group)
          .with(instanceLayout, side === 'light' ? frost : ember),
        destroy: cloud.destroy,
      }
    }

    function drawGlassShells(
      pass: TgpuRenderPass,
      pipeline: TgpuRenderPipeline,
      count: number,
    ) {
      if (count)
        pipeline
          .with(meshLayout, shellMesh)
          .with(instanceLayout, shells)
          .with(pass)
          .draw(shellGeometry.vertices.length / 6, count)
      glassVariants.draw(pass, pipeline)
    }

    return {
      setCloud(side: PawnSide, points: Float32Array, colors?: Float32Array) {
        if (disposed) return
        const next = uploadCloud(side, points, colors)
        clouds.get(side)?.destroy()
        clouds.set(side, next)
      },
      /** Up to six roles for each side. Replacement commits only after upload. */
      setVariantCloud(
        key: string,
        side: PawnSide,
        points: Float32Array,
        colors?: Float32Array,
      ) {
        if (disposed) return
        variants.set(key, side, points, colors)
      },
      clearVariantClouds: () => {
        variants.clear()
      },
      /** At most three shared study envelopes; replacement is transactional. */
      setVariantGlass(key: string, vertices: Float32Array, radius: number) {
        if (!disposed) glassVariants.set(key, vertices, radius)
      },
      clearVariantGlass: () => {
        glassVariants.clear()
      },
      setVariantSolid(...args: Parameters<typeof solidVariants.set>) {
        if (!disposed) solidVariants.set(...args)
      },
      setSolidMotion(key: string, motion: RookContactMotion) {
        if (!disposed) solidVariants.setMotion(key, motion)
      },
      clearSolidMotions: solidVariants.clearMotions,
      clearVariantSolids: () => {
        solidVariants.clear()
      },
      render(frame: BoardFrame, output?: GPUTextureView) {
        if (disposed || frame.width < 1 || frame.height < 1) return
        variants.prepare(frame.pieces)
        solidVariants.prepare(frame.pieces)
        const key = `${frame.width}:${frame.height}`
        if (key !== sizeKey) {
          const next = createPawnGlassTargets(
            root,
            device,
            frame.width,
            frame.height,
            sampler,
          )
          targets?.destroy()
          targets = next
          sizeKey = key
        }
        cameraData.set(frame.viewProjection, 0)
        cameraData.set(frame.eye, 16)
        cameraData[20] = frame.width
        cameraData[21] = frame.height
        cameraData[22] = frame.inspection ? 1 : 0
        cameraData[23] = format.endsWith('-srgb') ? 0 : 1
        cameraData.fill(0, 24)
        const { shellCount, frostCount, emberCount } = fillPieceInstances(
          frame.pieces,
          shellData,
          frostData,
          emberData,
          cameraData,
        )
        const studyShellCount = glassVariants.prepare(
          frame.pieces,
          cameraData,
          shellCount,
        )
        cameraData[25] = frame.mutedBoard ? 1 : 0
        camera.write(cameraData.buffer)
        shells.write(shellData.buffer)
        frost.write(frostData.buffer)
        ember.write(emberData.buffer)
        variants.write()
        glassVariants.write()
        solidVariants.write()
        if (frame.shards) {
          writeInstance(shardData, 0, frame.shards)
          shards.write(shardData.buffer)
        }
        fillTiles(tileData, frame.selected, frame.legal)
        tiles.write(tileData.buffer)
        baseData[1] = frame.inspection ? -0.13 : -0.265
        boardBase.write(baseData.buffer)
        const encoder = root['~unstable'].createCommandEncoder({
          label: 'Pawn board frame',
        })
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets!.multisample,
              resolveTarget: targets!.scene,
              clearValue: [0.007, 0.01, 0.017, 1],
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
        backgroundPipeline.with(pass).draw(3)
        boardPipeline
          .with(pass)
          .with(meshLayout, baseMesh)
          .with(instanceLayout, boardBase)
          .draw(36, 1)
        if (!frame.inspection)
          boardPipeline
            .with(pass)
            .with(meshLayout, tileMesh)
            .with(instanceLayout, tiles)
            .draw(36, 64)
        solidVariants.draw(pass)
        const lightCloud = clouds.get('light'),
          darkCloud = clouds.get('dark')
        if (lightCloud && frostCount)
          lightCloud.pipeline.with(pass).draw(lightCloud.count * 6, frostCount)
        if (darkCloud && emberCount)
          darkCloud.pipeline.with(pass).draw(darkCloud.count * 6, emberCount)
        variants.draw(pass)
        if (frame.shards) shardPipeline.with(pass).draw(fragmentCount, 1)
        glassVariants.drawFragments(
          pass,
          variantShardPipeline,
          frame.showGlass !== false,
        )
        pass.end()
        const showGlass =
          frame.showGlass !== false && shellCount + studyShellCount > 0
        if (showGlass) {
          const exits = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: targets!.exits,
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
          drawGlassShells(exits, exitsPipeline, shellCount)
          exits.end()
        }
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
        if (showGlass) {
          const glass = frontGlass.with(targets!.glass)
          drawGlassShells(optical, glass, shellCount)
        }
        optical.end()
        const display = encoder.beginRenderPass({
          colorAttachments: [
            { view: displayTarget(output), loadOp: 'clear', storeOp: 'store' },
          ],
        })
        displayPipeline.with(targets!.display).with(display).draw(3)
        display.end()
        encoder.submit()
      },
      destroy() {
        if (disposed) return
        disposed = true
        for (const cloud of clouds.values()) cloud.destroy()
        clouds.clear()
        variants.clear()
        glassVariants.clear()
        solidVariants.clear()
        targets?.destroy()
        for (const resource of owned) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned) resource.destroy()
    throw error
  }
}
