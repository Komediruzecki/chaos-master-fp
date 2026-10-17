// Offscreen hardware proof using the observatory's actual model and retained-orb pipelines.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { parseBookGlb } from '../src/almanac/bookAsset'
import { sampleSpecimen } from '../src/bench/recipes'
import { cloudFragment, sceneLayout, View } from '../src/bench/shaders'
import { createModelPass } from '../src/observatory/modelPass'
import { Model, modelLayout, orbVertex } from '../src/observatory/shaders'

/** Import from the running Vite origin in hardware Chromium; no Playwright test runner. */
export async function verifyObservatoryDepth() {
  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter)
    throw new Error('No GPU adapter for observatory depth verification')
  const adapterName = [
    adapter.info.vendor,
    adapter.info.architecture,
    adapter.info.description,
  ].join(' / ')
  if (/swiftshader|llvmpipe/i.test(adapterName))
    throw new Error('Observatory depth verification requires a hardware GPU')
  const device = await adapter.requestDevice()
  const root = tgpu.initFromDevice({ device })
  const size = 256
  const count = 32768
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  let mesh: ReturnType<typeof createModelPass> | undefined
  let scopeOpen = true
  device.pushErrorScope('validation')
  try {
    const hdr = own(
      device.createTexture({
        size: [size, size],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      }),
    )
    const msaa = own(
      device.createTexture({
        size: [size, size],
        format: 'rgba16float',
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      }),
    )
    const depth = own(
      device.createTexture({
        size: [size, size],
        format: 'depth24plus',
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      }),
    )
    const readback = own(
      device.createBuffer({
        size: size * size * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
    )
    const camera = root.createBuffer(View).$usage('uniform')
    const raw = new Float32Array(d.sizeOf(View) / 4)
    raw.set(mat4.lookAt([0, 3, 0.001], [0, 0, 0], [0, 0, -1]), 0)
    raw.set(mat4.perspective(Math.PI / 4, 1, 0.05, 10), 16)
    raw.set([0.012, 1, 0.6, 0], 32)
    raw.set([0.002, 0.32, 0.39, 0], 36)
    raw.set([1, 0.42, 0.055, 0], 40)
    raw.set([0, 3, 0.001, 0], 52)
    raw.set([-2.8, 3, -5.8, 0], 56)
    raw.set([2.8, 3, -5.8, 0], 60)
    camera.write(raw.buffer)
    const points = root
      .createBuffer(d.arrayOf(d.vec4f, count))
      .$usage('storage')
    points.write(new Float32Array(sampleSpecimen(0, count, 73129)).buffer)
    const model = root.createBuffer(Model).$usage('uniform')
    const modelRaw = new Float32Array(d.sizeOf(Model) / 4)
    const response = await fetch('/models/observatory/bridge-segment.glb')
    if (!response.ok)
      throw new Error(`Bridge fixture failed: HTTP ${response.status}`)
    const geometry = parseBookGlb(await response.arrayBuffer())
    mesh = createModelPass(root, camera, geometry)
    const cloud = root
      .createRenderPipeline({
        vertex: orbVertex,
        fragment: cloudFragment,
        targets: {
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: false,
          depthCompare: 'less-equal',
        },
        multisample: { count: 4 },
      })
      .with(root.createBindGroup(sceneLayout, { camera, points }))
      .with(root.createBindGroup(modelLayout, { model }))
    root.unwrap(cloud)
    const identity = mat4.identity()
    const draw = async (height: number | null, withMesh = true) => {
      const transform = mat4.translation([0, height ?? 0, 0])
      mat4.scale(transform, [0.28, 0.28, 0.28], transform)
      modelRaw.set(transform, 0)
      modelRaw.set([1, 1, 1, 0], 16)
      modelRaw.set([0, 0, 0.28, 0], 20)
      model.write(modelRaw.buffer)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: msaa.createView(),
            resolveTarget: hdr.createView(),
            loadOp: 'clear',
            storeOp: 'discard',
            clearValue: [0, 0, 0, 0],
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      })
      if (withMesh) mesh!.draw(pass, 'bridge-depth-fixture', identity)
      if (height !== null) cloud.with(pass).draw(6, count)
      pass.end()
      encoder.copyTextureToBuffer(
        { texture: hdr },
        { buffer: readback, bytesPerRow: size * 8 },
        [size, size],
      )
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const pixels = new Uint16Array(readback.getMappedRange()).slice()
      readback.unmap()
      return pixels
    }
    const baseline = await draw(null)
    const above = await draw(0.4)
    const below = await draw(-0.6)
    const unblocked = await draw(-0.6, false)
    let aboveChanged = 0,
      belowChanged = 0,
      unblockedPixels = 0
    for (let pixel = 0; pixel < size * size; pixel++) {
      const offset = pixel * 4
      // Binary16 equality proves hidden samples leave the opaque baseline untouched.
      if (
        [0, 1, 2].some(
          (channel) => above[offset + channel] !== baseline[offset + channel],
        )
      )
        aboveChanged++
      if (
        [0, 1, 2].some(
          (channel) => below[offset + channel] !== baseline[offset + channel],
        )
      )
        belowChanged++
      if ([0, 1, 2].some((channel) => unblocked[offset + channel] !== 0))
        unblockedPixels++
    }
    const validation = await device.popErrorScope()
    scopeOpen = false
    if (validation) throw new Error(validation.message)
    if (aboveChanged < 150 || unblockedPixels < 100 || belowChanged !== 0)
      throw new Error(
        `Observatory depth failed: ${JSON.stringify({ aboveChanged, belowChanged, unblockedPixels })}`,
      )
    return {
      adapter: adapterName,
      aboveChanged,
      belowChanged,
      unblockedPixels,
      mesh: 'bridge-segment.glb',
      triangles: geometry.triangles,
      samples: count,
      pipelines: [
        'createModelPass/modelVertex/bookFragment',
        'orbVertex/cloudFragment',
      ],
      format: 'rgba16float',
      msaa: 4,
      size,
      sharedDepthVerified: true,
      nativeHeadsetTested: false,
    }
  } finally {
    if (scopeOpen) await device.popErrorScope().catch(() => null)
    mesh?.dispose()
    for (const resource of owned.reverse()) resource.destroy()
    root.destroy()
    device.destroy()
  }
}
