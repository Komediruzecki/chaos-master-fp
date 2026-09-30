// One desktop render owner for compute, opaque depth, luminous points and resolve.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { SAMPLE_STEPS } from './recipes'
import { cloudFragment, cloudVertex, constructSpecimen, fullScreenVertex, resolveFragment, resolveLayout, SampleConfig, samplingLayout, sceneLayout, solidFragment, solidVertex, View, } from './shaders'
import type { TgpuBindGroup } from 'typegpu'
import type { BenchSettings } from './settings'

const MAX_POINTS = 524288
const palettes = {
  lagoon: [
    [0.002, 0.32, 0.39],
    [1, 0.42, 0.055],
  ],
  ember: [
    [0.25, 0.028, 0.06],
    [1, 0.68, 0.23],
  ],
  violet: [
    [0.15, 0.006, 0.45],
    [0.28, 0.72, 1],
  ],
  ivory: [
    [0.74, 0.78, 0.8],
    [0.74, 0.78, 0.8],
  ],
}

export function createBenchRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
) {
  const root = tgpu.initFromDevice({ device })
  const schema = d.arrayOf(d.vec4f, MAX_POINTS)
  const live = root.createBuffer(schema).$usage('storage')
  const cached = root.createBuffer(schema).$usage('storage')
  const config = root.createBuffer(SampleConfig).$usage('uniform')
  const camera = root.createBuffer(View).$usage('uniform')
  const raw = new Float32Array(d.sizeOf(View) / 4)
  const view = new Float32Array(16)
  const projection = new Float32Array(16)
  const groups = {
    compute: root.createBindGroup(sceneLayout, { camera, points: live }),
    cached: root.createBindGroup(sceneLayout, { camera, points: cached }),
  }
  const compute = root
    .createComputePipeline({ compute: constructSpecimen })
    .with(root.createBindGroup(samplingLayout, { config, points: live }))
  const cloud = root.createRenderPipeline({
    vertex: cloudVertex,
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
  })
  const solid = root.createRenderPipeline({
    vertex: solidVertex,
    fragment: solidFragment,
    targets: { format: 'rgba16float' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  })
  const resolve = root.createRenderPipeline({
    vertex: fullScreenVertex,
    fragment: resolveFragment,
    targets: { format },
  })
  // Fail initialization at shader compilation, not silently on the first frame.
  root.unwrap(compute)
  root.unwrap(cloud)
  root.unwrap(solid)
  root.unwrap(resolve)
  let hdr: GPUTexture | undefined
  let depth: GPUTexture | undefined
  let hdrView: GPUTextureView | undefined
  let depthView: GPUTextureView | undefined
  let resolveGroup: TgpuBindGroup | undefined
  let width = 0
  let height = 0
  let generation = 0
  let submissions = 0
  let identity = ''
  let cachedIdentity = ''
  let dirty = true
  let generationSubmitMs = 0

  function resize(nextWidth: number, nextHeight: number) {
    if (nextWidth === width && nextHeight === height) return
    hdr?.destroy()
    depth?.destroy()
    width = nextWidth
    height = nextHeight
    hdr = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    depth = device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    hdrView = hdr.createView()
    depthView = depth.createView()
    resolveGroup = root.createBindGroup(resolveLayout, {
      image: hdrView,
      camera,
    })
  }

  function render(
    color: GPUTextureView,
    w: number,
    h: number,
    settings: BenchSettings,
  ) {
    resize(w, h)
    const key = `${settings.recipe}:${settings.pointCount}:${settings.seed}`
    const encoder = device.createCommandEncoder()
    if (dirty || identity !== key) {
      const started = window.performance.now()
      config.write({
        values: d.vec4u(settings.recipe, settings.pointCount, settings.seed, 0),
      })
      compute
        .with(encoder)
        .dispatchWorkgroups(Math.ceil(settings.pointCount / SAMPLE_STEPS / 64))
      generationSubmitMs = window.performance.now() - started
      identity = key
      dirty = false
      generation++
    }
    const yaw = (settings.yaw * Math.PI) / 180
    const pitch = (settings.pitch * Math.PI) / 180
    const distance = settings.distance
    const eye = [
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    ]
    mat4.lookAt(eye, [0, 0, 0], [0, 1, 0], view)
    mat4.perspective(Math.PI / 3, width / height, 0.05, 100, projection)
    raw.set(view, 0)
    raw.set(projection, 16)
    // Normalize energy against sample count and footprint area; density still
    // changes visible detail, so this is not an exact perceptual brightness match.
    const gain =
      (131072 / settings.pointCount) *
      Math.pow(0.003 / settings.pointSize, 2) *
      0.48
    raw.set(
      [settings.pointSize, settings.exposure, gain, Number(settings.stars)],
      32,
    )
    raw.set([...palettes[settings.palette][0], 0], 36)
    raw.set([...palettes[settings.palette][1], 0], 40)
    const barZ =
      settings.depthProbe === 'front'
        ? 1.4
        : settings.depthProbe === 'behind'
          ? -1.4
          : 0
    raw.set(
      [Number(settings.rings), Number(settings.depthProbe !== 'off'), barZ, 0],
      44,
    )
    camera.write(raw.buffer)
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: hdrView!,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
      depthStencilAttachment: {
        view: depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })
    const group =
      groups[
        settings.source === 'cached' && cachedIdentity === key
          ? 'cached'
          : 'compute'
      ]
    if (settings.rings)
      solid
        .with(group)
        .with(pass)
        .draw(192 * 8 * 6, 2)
    if (settings.depthProbe !== 'off')
      solid.with(group).with(pass).draw(6, 1, 0, 2)
    cloud.with(group).with(pass).draw(6, settings.pointCount)
    pass.end()
    const final = encoder.beginRenderPass({
      colorAttachments: [{ view: color, loadOp: 'clear', storeOp: 'store' }],
    })
    resolve.with(resolveGroup!).with(final).draw(3)
    final.end()
    device.queue.submit([encoder.finish()])
    submissions++
  }

  return {
    render,
    setCachedData(key: string, data: Float32Array) {
      device.queue.writeBuffer(
        root.unwrap(cached),
        0,
        data.buffer,
        data.byteOffset,
        data.byteLength,
      )
      cachedIdentity = key
    },
    rebuild() {
      dirty = true
    },
    stats: () => ({
      generation,
      submissions,
      generationSubmitMs,
      bufferBytes: MAX_POINTS * 16 * 2,
      width,
      height,
    }),
    async readPoints(count: number, source: 'compute' | 'cached') {
      const points = await (source === 'cached' ? cached : live).read()
      return points
        .slice(0, count)
        .map((point) => [point.x, point.y, point.z, point.w])
    },
    dispose() {
      hdr?.destroy()
      depth?.destroy()
      root.destroy()
    },
  }
}
