/** Owned linear-HDR scene with hollow-glass transmission, native coloured cores and shards. */
import { common, d } from 'typegpu'
import { buildPawnShellFragments, buildPawnShellGeometry, } from '@/flame/chess/pawnBoardGeometry'
import { createPawnBoardCloud } from './pawnBoardCloud'
import { BOARD_TILE_SIZE, squareWorld } from './pawnBoardMath'
import { cube } from './pawnBoardMesh'
import { backgroundFragment, BoardCameraUniform, boardFragment, cameraLayout, cloudFragment, cloudVertex, displayFragment, fragmentLayout, fragmentVertex, glassExitFragment, glassFragment, instanceLayout, meshLayout, meshVertex, shardFragment, } from './pawnBoardShaders'
import { createPawnGlassTargets } from './pawnGlassTargets'
import type { TgpuRoot } from 'typegpu'
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { Square } from '@/flame/chess/pawnGame'

export type BoardPawnInstance = {
  position: readonly [number, number, number]
  side: PawnSide
  selected: boolean
  age: number
}
export type BoardFrame = {
  width: number
  height: number
  viewProjection: Float32Array
  eye: Float32Array
  pieces: readonly BoardPawnInstance[]
  shards?: BoardPawnInstance
  selected?: Square
  legal: readonly Square[]
  showGlass?: boolean
  inspection?: boolean
}
const CAPACITY = 32
const FROST = [0.3, 0.82, 0.92] as const
const EMBER = [1, 0.34, 0.09] as const

function writeInstance(
  data: Float32Array,
  index: number,
  instance: BoardPawnInstance,
) {
  const o = index * 12
  const colour = instance.side === 'light' ? FROST : EMBER
  data[o] = instance.position[0]
  data[o + 1] = instance.position[1]
  data[o + 2] = instance.position[2]
  data[o + 3] = 1
  data[o + 4] = colour[0]
  data[o + 5] = colour[1]
  data[o + 6] = colour[2]
  data[o + 7] = 1
  data[o + 8] = instance.age
  data[o + 9] = instance.selected ? 1 : 0
  data[o + 10] = 0
  data[o + 11] = 0
}

function fillPieceInstances(
  pieces: readonly BoardPawnInstance[],
  shellData: Float32Array,
  frostData: Float32Array,
  emberData: Float32Array,
  cameraData: Float32Array,
) {
  if (pieces.length > CAPACITY)
    throw new Error('Pawn board instance capacity exceeded')
  let shellCount = 0,
    frostCount = 0,
    emberCount = 0
  for (const piece of pieces) {
    if (piece.age < 0) {
      writeInstance(shellData, shellCount, piece)
      shellData[shellCount * 12 + 10] = shellCount + 1
      const centre = 28 + shellCount * 4
      cameraData[centre] = piece.position[0]
      cameraData[centre + 1] = piece.position[1]
      cameraData[centre + 2] = piece.position[2]
      cameraData[centre + 3] = 0.67
      shellCount++
    }
    if (piece.side === 'light') writeInstance(frostData, frostCount++, piece)
    else writeInstance(emberData, emberCount++, piece)
  }
  cameraData[24] = shellCount
  return { shellCount, frostCount, emberCount }
}

function fillTiles(
  data: Float32Array,
  selected: Square | undefined,
  legal: readonly Square[],
) {
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const o = (rank * 8 + file) * 12,
        position = squareWorld({ file, rank })
      data[o] = position[0]
      data[o + 1] = -0.01
      data[o + 2] = position[2]
      data[o + 3] = 1
      const pale = (rank + file) % 2 === 0
      data[o + 4] = pale ? 0.11 : 0.029
      data[o + 5] = pale ? 0.15 : 0.046
      data[o + 6] = pale ? 0.18 : 0.064
      data[o + 7] = 1
      data[o + 8] = -1
      data[o + 9] = legal.some((s) => s.file === file && s.rank === rank)
        ? 0.55
        : 0
      if (selected?.file === file && selected.rank === rank) data[o + 9] = 1
    }
}

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
      0, -0.265, 0, 1, 0.018, 0.031, 0.044, 1, -1, 0, 0, 0,
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
      .with(meshLayout, shellMesh)
      .with(instanceLayout, shells)
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
      .with(meshLayout, shellMesh)
      .with(instanceLayout, shells)
    const shardPipeline = root
      .createRenderPipeline({
        attribs: { ...fragmentLayout.attrib, ...instanceLayout.attrib },
        vertex: fragmentVertex,
        fragment: shardFragment,
        targets: { format: 'rgba16float', blend },
        primitive: { cullMode: 'none' },
        depthStencil: { ...depth, depthWriteEnabled: false },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
      .with(fragmentLayout, fragmentMesh)
      .with(instanceLayout, shards)
    const pointPipeline = root
      .createRenderPipeline({
        attribs: instanceLayout.attrib,
        vertex: cloudVertex,
        fragment: cloudFragment,
        targets: {
          format: 'rgba16float',
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add',
            },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
        primitive: { cullMode: 'none' },
        depthStencil: { ...depth, depthWriteEnabled: false },
        multisample: { count: 4 },
      })
      .with(cameraGroup)
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
      pointPipeline,
      backgroundPipeline,
      displayPipeline,
    ])
      root.unwrap(pipeline)
    const clouds = new Map<PawnSide, ReturnType<typeof uploadCloud>>()
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    let sizeKey = ''
    let targets: ReturnType<typeof createPawnGlassTargets> | undefined
    let disposed = false

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

    return {
      setCloud(side: PawnSide, points: Float32Array, colors?: Float32Array) {
        if (disposed) return
        const next = uploadCloud(side, points, colors)
        clouds.get(side)?.destroy()
        clouds.set(side, next)
      },
      render(frame: BoardFrame) {
        if (disposed || frame.width < 1 || frame.height < 1) return
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
        camera.write(cameraData.buffer)
        shells.write(shellData.buffer)
        frost.write(frostData.buffer)
        ember.write(emberData.buffer)
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
        const lightCloud = clouds.get('light'),
          darkCloud = clouds.get('dark')
        if (lightCloud && frostCount)
          lightCloud.pipeline.with(pass).draw(lightCloud.count * 6, frostCount)
        if (darkCloud && emberCount)
          darkCloud.pipeline.with(pass).draw(darkCloud.count * 6, emberCount)
        if (frame.shards) shardPipeline.with(pass).draw(fragmentCount, 1)
        pass.end()
        const showGlass = frame.showGlass !== false && shellCount > 0
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
          exitsPipeline
            .with(exits)
            .draw(shellGeometry.vertices.length / 6, shellCount)
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
        if (showGlass)
          frontGlass
            .with(targets!.glass)
            .with(optical)
            .draw(shellGeometry.vertices.length / 6, shellCount)
        optical.end()
        const display = encoder.beginRenderPass({
          colorAttachments: [
            { view: context, loadOp: 'clear', storeOp: 'store' },
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
        targets?.destroy()
        for (const resource of owned) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned) resource.destroy()
    throw error
  }
}
