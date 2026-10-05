/** Owned particle-gel renderer; sphere support is a surface approximation, never a physical crack guarantee. */
import { common, d } from 'typegpu'
import { GUMMY_MATERIALS } from './gummyMaterial'
import { GUMMY_PRESS_THICKNESS } from './gummyPress'
import { gummyBackgroundFragment, GummyCamera, gummyCameraLayout, gummyDisplayFragment, gummyFloorLayout, } from './gummyShaders'
import { PARTICLE_GUMMY_FILTER_RADIUS, PARTICLE_GUMMY_RADIUS_SCALE, particleVolumeWeight, } from './particleGummyMath'
import { particleGummyComposite, particleGummyDepthFragment, particleGummyFilterHorizontal, particleGummyFilterVertical, particleGummyLayout, particleGummyOpticalFragment, particleGummyShadowFragment, particleGummyShadowVertex, particleGummyVertex, } from './particleGummyShaders'
import { particleGummyFarProfileFragment, particleGummyNormalFragment, particleGummySurfaceFragment, } from './particleGummySurfaceShaders'
import { createParticleGummyTargets } from './particleGummyTargets'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'
import type { GummyFrame } from './gummyRenderer'

export type ParticleGummyRenderState = {
  positions: TgpuBuffer<d.WgslArray<d.Vec4f>> & StorageFlag
  restPositions: Float32Array
  /** Immutable dye coordinates, independent of geometry for multi-colour contact fixtures. */
  dyePositions?: Float32Array
  particleCount: number
  spacing: number
}
export type ParticleGummyRenderOptions = { raw?: boolean }

export function packParticleGummyCamera(
  data: Float32Array,
  frame: GummyFrame,
  format: GPUTextureFormat,
  radius: number,
  width: number,
  height: number,
) {
  data.set(frame.viewProjection, 0)
  data.set(frame.inverseViewProjection, 16)
  data.set(frame.eye.subarray(0, 3), 32)
  data[36] = width
  data[37] = height
  data[38] = frame.clay ? 1 : 0
  data[39] = format.endsWith('-srgb') ? 0 : 1
  const palette = frame.palette ?? 'blue'
  const solid =
    palette === 'blue' || palette === 'amber' || palette === 'berry'
      ? palette
      : 'blue'
  data.set(GUMMY_MATERIALS[solid].absorption, 40)
  data[43] = radius
  data.set(GUMMY_MATERIALS[solid].colour, 44)
  data[47] =
    palette === 'candy'
      ? 1
      : palette === 'lagoon'
        ? 2
        : palette === 'marble'
          ? 3
          : 0
  data[48] = frame.press?.height ?? 0
  data[49] = frame.press?.halfExtent ?? 0
  data[50] = frame.press ? 1 : 0
  data[51] = GUMMY_PRESS_THICKNESS
  data[53] = frame.floor === 'chess' ? 1 : 0
}

export function createParticleGummyRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  particles: ParticleGummyRenderState,
) {
  if (root.device !== device)
    throw new Error('Particle gummy renderer root and device must match')
  const dyePositions = particles.dyePositions ?? particles.restPositions
  if (
    !Number.isInteger(particles.particleCount) ||
    particles.particleCount < 1 ||
    particles.restPositions.length !== particles.particleCount * 4 ||
    !particles.restPositions.every(Number.isFinite)
  )
    throw new Error(
      'Particle gummy renderer needs a finite vec4 rest position for each particle',
    )
  if (
    dyePositions.length !== particles.particleCount * 4 ||
    !dyePositions.every(Number.isFinite)
  )
    throw new Error(
      'Particle gummy renderer needs finite vec4 dye coordinates for each particle',
    )
  const radius = particles.spacing * PARTICLE_GUMMY_RADIUS_SCALE
  const weight = particleVolumeWeight(particles.spacing, radius)
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const camera = own(root.createBuffer(GummyCamera).$usage('uniform'))
    const support = own(
      root
        .createBuffer(
          d.vec4f,
          d.vec4f(radius, weight, radius * 2, PARTICLE_GUMMY_FILTER_RADIUS),
        )
        .$usage('uniform'),
    )
    const restPositions = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, particles.particleCount), (buffer) => {
          buffer.write(new Float32Array(dyePositions).buffer)
        })
        .$usage('storage'),
    )
    const cameraGroup = root.createBindGroup(gummyCameraLayout, { camera })
    const particleGroup = root.createBindGroup(particleGummyLayout, {
      positions: particles.positions,
      restPositions,
      support,
    })
    const cameraData = new Float32Array(d.sizeOf(GummyCamera) / 4)
    const depth: GPUDepthStencilState = {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    }
    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
    const analytic = root
      .createRenderPipeline({
        vertex: particleGummyVertex,
        fragment: particleGummyDepthFragment,
        targets: {
          distance: { format: 'r32float' },
        },
        depthStencil: depth,
      })
      .with(cameraGroup)
      .with(particleGroup)
    const optical = root
      .createRenderPipeline({
        vertex: particleGummyVertex,
        fragment: particleGummyOpticalFragment,
        targets: {
          optical: { format: 'rgba16float', blend: additive },
          profileFirst: { format: 'rgba16float', blend: additive },
          profileSecond: { format: 'rgba16float', blend: additive },
        },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const reconstruction = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: particleGummySurfaceFragment,
        targets: { format: 'r32float' },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const farProfile = root
      .createRenderPipeline({
        vertex: particleGummyVertex,
        fragment: particleGummyFarProfileFragment,
        targets: { format: 'rgba16float', blend: additive },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const normals = root
      .createRenderPipeline({
        vertex: particleGummyVertex,
        fragment: particleGummyNormalFragment,
        targets: {
          normal: { format: 'rgba16float', blend: additive },
          dye: { format: 'rgba16float', blend: additive },
        },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const horizontal = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: particleGummyFilterHorizontal,
        targets: { format: 'r32float' },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const vertical = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: particleGummyFilterVertical,
        targets: { format: 'r32float' },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const composite = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: particleGummyComposite,
        targets: { format: 'rgba16float' },
      })
      .with(cameraGroup)
      .with(particleGroup)
    const shadow = root
      .createRenderPipeline({
        vertex: particleGummyShadowVertex,
        fragment: particleGummyShadowFragment,
        targets: { format: 'rgba16float', blend: additive },
      })
      .with(particleGroup)
    const background = root
      .createRenderPipeline({
        vertex: common.fullScreenTriangle,
        fragment: gummyBackgroundFragment,
        targets: { colour: { format: 'rgba16float' } },
        depthStencil: { ...depth, depthCompare: 'always' },
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
      analytic,
      optical,
      reconstruction,
      farProfile,
      normals,
      horizontal,
      vertical,
      composite,
      shadow,
      background,
      display,
    ])
      root.unwrap(pipeline)
    const sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    const lightTexture = own(
      device.createTexture({
        label: 'Particle gummy projected shadow',
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
    let targets: ReturnType<typeof createParticleGummyTargets> | undefined
    let sizeKey = ''
    let disposed = false
    return {
      supportRadius: radius,
      render(frame: GummyFrame, options: ParticleGummyRenderOptions = {}) {
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
          const next = createParticleGummyTargets(
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
          radius,
          width,
          height,
        )
        camera.write(cameraData.buffer)
        const encoder = root['~unstable'].createCommandEncoder({
          label: 'Particle gummy support frame',
        })
        const shadowPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: light,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        shadow.with(shadowPass).draw(6, particles.particleCount)
        shadowPass.end()
        const scene = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.scene,
              clearValue: [0.72, 0.65, 0.55, 1],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: target.sceneDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        })
        background.with(floorGroup).with(scene).draw(3)
        scene.end()
        const analyticPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.original,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: target.particleDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        })
        analytic
          .with(target.opaque)
          .with(analyticPass)
          .draw(6, particles.particleCount)
        analyticPass.end()
        const opticalPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.optical,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: target.profileFirst,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: target.profileSecond,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        optical
          .with(target.opaque)
          .with(target.profileSource)
          .with(opticalPass)
          .draw(6, particles.particleCount)
        opticalPass.end()
        const farPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.profileFar,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        farProfile
          .with(target.opaque)
          .with(target.profileSource)
          .with(farPass)
          .draw(6, particles.particleCount)
        farPass.end()
        const surfacePass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.surface,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        reconstruction.with(target.reconstruction).with(surfacePass).draw(3)
        surfacePass.end()
        if (!options.raw) {
          // Ping-pong ends each pass before that texture is sampled; no extra resize targets.
          for (let iteration = 0; iteration < 2; iteration++) {
            const horizontalPass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: target.horizontal,
                  clearValue: [0, 0, 0, 0],
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            })
            horizontal
              .with(
                iteration === 0
                  ? target.horizontalFilter
                  : target.refinementFilter,
              )
              .with(horizontalPass)
              .draw(3)
            horizontalPass.end()
            const verticalPass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: target.filtered,
                  clearValue: [0, 0, 0, 0],
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            })
            vertical.with(target.verticalFilter).with(verticalPass).draw(3)
            verticalPass.end()
          }
        }
        const normalPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.normal,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: target.dye,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        normals
          .with(options.raw ? target.rawNormal : target.filteredNormal)
          .with(normalPass)
          .draw(6, particles.particleCount)
        normalPass.end()
        const compositePass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.final,
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        composite
          .with(options.raw ? target.rawComposite : target.composite)
          .with(compositePass)
          .draw(3)
        compositePass.end()
        const displayPass = encoder.beginRenderPass({
          colorAttachments: [
            { view: context, loadOp: 'clear', storeOp: 'store' },
          ],
        })
        display.with(target.display).with(displayPass).draw(3)
        displayPass.end()
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
