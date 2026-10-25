/** One or two deforming candy pieces share the board HDR optics with cached waiting instances. */
import { d } from 'typegpu'
import { GummyCamera, gummyCameraLayout, gummyFloorLayout, } from '../GummyBear/gummyShaders'
import { marchingGummyMeshLayout } from '../GummyBear/marchingGummyRenderShaders'
import { createMarchingGummySurface } from '../GummyBear/marchingGummySurface'
import { GUMMY_BOARD_INSTANCE_FLOATS, GUMMY_BOARD_MAX_PIECES, } from './gummyBoardInstances'
import { prepareGummyBoardMeshes } from './gummyBoardMeshPreparation'
import { GummyBoardInstance, gummyBoardInstanceLayout, gummyBoardMaterialLayout, } from './gummyBoardShaders'
import { gummyBoardReceiverLayout, GummyBoardStage, gummyBoardStageLayout, } from './gummyBoardStageShaders'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardMeshQuality } from './gummyBoardMeshPreparation'
import type { GummyBoardParticleState } from './gummyBoardRenderContracts'

export async function createGummyBoardRenderResources(
  root: TgpuRoot,
  device: GPUDevice,
  quality: GummyBoardMeshQuality,
  particles: GummyBoardParticleState | undefined,
  secondaryParticles: GummyBoardParticleState | undefined,
  lightResolution: number,
  own: <T extends { destroy(): void }>(resource: T) => T,
) {
  const prepared = await prepareGummyBoardMeshes(
    root,
    device,
    quality,
    particles?.spacing,
  )
  const moulds = prepared.moulds
  const restMeshes = own(prepared.meshes)
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
      root.createBuffer(d.arrayOf(GummyBoardInstance, count)).$usage('storage'),
    )
    return {
      buffer,
      data: new Float32Array(count * GUMMY_BOARD_INSTANCE_FLOATS),
      previous: new Float32Array(count * GUMMY_BOARD_INSTANCE_FLOATS).fill(NaN),
      group: root.createBindGroup(gummyBoardInstanceLayout, {
        instances: buffer,
      }),
    }
  }
  const victim = makeInstances(1)
  const secondary = secondarySurface ? makeInstances(1) : undefined
  const batches = moulds.map((mould) => {
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
  const boardLight = emptyBoardLightTexture.createView()
  const receiverGroup = root.createBindGroup(gummyBoardReceiverLayout, {
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
  return {
    moulds,
    restMeshes,
    surface,
    secondarySurface,
    camera,
    cameraData,
    cameraGroup,
    previousCamera,
    uploadChanged,
    victim,
    secondary,
    batches,
    moving,
    movingDraw,
    movingDrawData,
    movingSource,
    sources,
    instanceData,
    materials,
    materialData,
    previousMaterials,
    materialGroup,
    stage,
    stageData,
    previousStage,
    stageGroup,
    sampler,
    lightTexture,
    staticLightTexture,
    staticLight,
    light,
    floorGroup,
    boardLight,
    receiverGroup,
    depth,
    blend,
  }
}
export type GummyBoardRenderResources = Awaited<
  ReturnType<typeof createGummyBoardRenderResources>
>
