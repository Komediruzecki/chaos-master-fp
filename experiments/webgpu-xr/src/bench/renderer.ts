// One desktop render owner for compute, opaque depth, luminous points and resolve.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { loadBookGeometry } from '../almanac/bookAsset'
import { createBookPass } from '../almanac/bookPass'
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
  changed: () => void = () => {},
) {
  const root = tgpu.initFromDevice({ device })
  const schema = d.arrayOf(d.vec4f, MAX_POINTS)
  const live = root.createBuffer(schema).$usage('storage')
  const cached = root.createBuffer(schema).$usage('storage')
  const config = root.createBuffer(SampleConfig).$usage('uniform')
  const camera = root.createBuffer(View).$usage('uniform')
  const partnerCamera = root.createBuffer(View).$usage('uniform')
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
  const createCloud = (count: number) =>
    root.createRenderPipeline({
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
      multisample: { count },
    })
  const createSolid = (count: number) =>
    root.createRenderPipeline({
      vertex: solidVertex,
      fragment: solidFragment,
      targets: { format: 'rgba16float' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: { count },
    })
  const cloud = createCloud(1)
  const solid = createSolid(1)
  const bookCloud = createCloud(4)
  const bookSolid = createSolid(4)
  const resolve = root.createRenderPipeline({
    vertex: fullScreenVertex,
    fragment: resolveFragment,
    targets: { format },
  })
  // Fail initialization at shader compilation, not silently on the first frame.
  root.unwrap(compute)
  root.unwrap(cloud)
  root.unwrap(solid)
  root.unwrap(bookCloud)
  root.unwrap(bookSolid)
  root.unwrap(resolve)
  let hdr: GPUTexture | undefined
  let multisampledHdr: GPUTexture | undefined
  let depth: GPUTexture | undefined
  let hdrView: GPUTextureView | undefined
  let multisampledHdrView: GPUTextureView | undefined
  let depthView: GPUTextureView | undefined
  let resolveGroup: TgpuBindGroup | undefined
  let width = 0
  let height = 0
  let samples = 1
  let generation = 0
  let submissions = 0
  let identity = ''
  let cachedIdentity = ''
  let dirty = true
  let generationSubmitMs = 0
  let scene: 'specimen' | 'book' = 'specimen'
  const book = {
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    error: '',
    dock: 'left' as 'left' | 'right',
    inspecting: false,
    clay: false,
    triangles: 0,
    geometryBytes: 0,
    bytes: 0,
    materials: [] as string[],
    draws: 0,
  }
  let bookPass: ReturnType<typeof createBookPass> | undefined
  let bookRequest: AbortController | undefined
  let disposed = false
  let partner: ReturnType<typeof createPartner> | undefined
  let partnerIdentity = ''
  let leftDock = [-0.69, 0.67, 0]
  let rightDock = [0.69, 0.67, 0]

  function createPartner() {
    const points = root.createBuffer(schema).$usage('storage')
    const sampleConfig = root.createBuffer(SampleConfig).$usage('uniform')
    return {
      points,
      sampleConfig,
      group: root.createBindGroup(sceneLayout, {
        camera: partnerCamera,
        points,
      }),
      compute: root.createComputePipeline({ compute: constructSpecimen }).with(
        root.createBindGroup(samplingLayout, {
          config: sampleConfig,
          points,
        }),
      ),
    }
  }

  async function loadBook() {
    bookRequest?.abort()
    const request = new AbortController()
    bookRequest = request
    book.status = 'loading'
    book.error = ''
    changed()
    try {
      const geometry = await loadBookGeometry(request.signal)
      if (disposed || bookRequest !== request) return
      if (!geometry.anchors.OrbDockLeft || !geometry.anchors.OrbDockRight)
        throw new Error(
          'The Almanac model is missing its orb attachment points.',
        )
      device.pushErrorScope('validation')
      let loaded: ReturnType<typeof createBookPass> | undefined
      let validation: GPUError | null = null
      try {
        loaded = createBookPass(root, camera, geometry, 4)
      } finally {
        validation = await device.popErrorScope()
      }
      if (disposed || bookRequest !== request) {
        loaded?.dispose()
        return
      }
      if (validation) {
        loaded?.dispose()
        throw new Error(validation.message)
      }
      bookPass?.dispose()
      bookPass = loaded
      leftDock = geometry.anchors.OrbDockLeft
      rightDock = geometry.anchors.OrbDockRight
      book.status = 'ready'
      book.triangles = geometry.triangles
      book.geometryBytes =
        geometry.vertices.byteLength + geometry.indices.byteLength
      book.bytes = geometry.bytes
      book.materials = geometry.materials
      book.draws = 1
      changed()
    } catch (error) {
      if (disposed || bookRequest !== request || request.signal.aborted) return
      book.status = 'error'
      book.error = error instanceof Error ? error.message : String(error)
      changed()
    }
  }

  function resize(nextWidth: number, nextHeight: number, sampleCount: number) {
    if (nextWidth === width && nextHeight === height && samples === sampleCount)
      return
    hdr?.destroy()
    multisampledHdr?.destroy()
    depth?.destroy()
    width = nextWidth
    height = nextHeight
    samples = sampleCount
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
      sampleCount,
    })
    multisampledHdr =
      sampleCount === 4
        ? device.createTexture({
            size: [width, height],
            format: 'rgba16float',
            sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        : undefined
    multisampledHdrView = multisampledHdr?.createView()
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
    resize(w, h, scene === 'book' ? 4 : 1)
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
    const isBook = scene === 'book'
    const dock = book.dock === 'left' ? leftDock : rightDock
    const otherDock = book.dock === 'left' ? rightDock : leftDock
    const yaw = ((settings.yaw + (isBook ? -8 : 0)) * Math.PI) / 180
    const pitch =
      ((isBook
        ? Math.max(
            -75,
            Math.min(85, settings.pitch + (book.inspecting ? 12 : 35)),
          )
        : settings.pitch) *
        Math.PI) /
      180
    const distance =
      settings.distance *
      (isBook
        ? book.inspecting
          ? 0.38
          : 1.05 * Math.max(1, 1.3 / (width / height))
        : 1)
    const target = isBook ? (book.inspecting ? dock : [0, 0.25, 0]) : [0, 0, 0]
    const eye = [
      target[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * Math.cos(pitch) * distance,
    ]
    mat4.lookAt(eye, target, [0, 1, 0], view)
    mat4.perspective(
      isBook ? Math.PI / 3.75 : Math.PI / 3,
      width / height,
      0.05,
      100,
      projection,
    )
    raw.set(view, 0)
    raw.set(projection, 16)
    // Normalize energy against sample count and footprint area; density still
    // changes visible detail, so this is not an exact perceptual brightness match.
    // Tiny MSAA splats can cover samples while their pixel-centre UV falls
    // outside the Gaussian. Keep distant book specimens visible at phone size.
    const dockDepth = (anchor: readonly number[]) =>
      -(
        view[2] * anchor[0] +
        view[6] * anchor[1] +
        view[10] * anchor[2] +
        view[14]
      )
    const bookFootprint =
      (2 *
        0.65 *
        Math.tan(Math.PI / 7.5) *
        Math.max(dockDepth(leftDock), dockDepth(rightDock), 0.05)) /
      (height * 0.34)
    const pointSize = isBook
      ? Math.max(settings.pointSize * 1.5, bookFootprint)
      : settings.pointSize
    const gain =
      (131072 / settings.pointCount) * Math.pow(0.003 / pointSize, 2) * 0.48
    raw.set([pointSize, settings.exposure, gain, Number(settings.stars)], 32)
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
    raw.set(isBook ? [...dock, 0.34] : [0, 0, 0, 1], 48)
    raw.set([...eye, Number(book.clay && isBook)], 52)
    raw.set([...leftDock, 0], 56)
    raw.set([...rightDock, 0], 60)
    camera.write(raw.buffer)
    if (isBook) {
      partner ??= createPartner()
      const otherRecipe = book.dock === 'left' ? 1 : 0
      const partnerKey = `${otherRecipe}:${settings.pointCount}:73129`
      if (partnerIdentity !== partnerKey) {
        partner.sampleConfig.write({
          values: d.vec4u(otherRecipe, settings.pointCount, 73129, 0),
        })
        partner.compute
          .with(encoder)
          .dispatchWorkgroups(
            Math.ceil(settings.pointCount / SAMPLE_STEPS / 64),
          )
        partnerIdentity = partnerKey
      }
      raw.set([...otherDock, 0.34], 48)
      raw.set([...palettes.lagoon[0], 0], 36)
      raw.set([...palettes.lagoon[1], 0], 40)
      partnerCamera.write(raw.buffer)
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: multisampledHdrView ?? hdrView!,
          resolveTarget: multisampledHdrView ? hdrView : undefined,
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
    const solidPipeline = isBook ? bookSolid : solid
    const cloudPipeline = isBook ? bookCloud : cloud
    if (isBook) bookPass?.draw(pass)
    if (settings.rings)
      solidPipeline
        .with(group)
        .with(pass)
        .draw(192 * 8 * 6, 2)
    if (settings.depthProbe !== 'off')
      solidPipeline.with(group).with(pass).draw(6, 1, 0, 2)
    if (isBook && partner) {
      if (settings.rings)
        solidPipeline
          .with(partner.group)
          .with(pass)
          .draw(192 * 8 * 6, 2)
    }
    cloudPipeline.with(group).with(pass).draw(6, settings.pointCount)
    if (isBook && partner)
      cloudPipeline.with(partner.group).with(pass).draw(6, settings.pointCount)
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
    setScene(next: 'specimen' | 'book') {
      scene = next
      if (next === 'book' && book.status === 'idle') void loadBook()
    },
    setBookDock(dock: 'left' | 'right') {
      book.dock = dock
    },
    setBookInspection(inspecting: boolean) {
      book.inspecting = inspecting
    },
    setBookClay(clay: boolean) {
      book.clay = clay
    },
    retryBook() {
      if (!disposed && book.status !== 'loading') void loadBook()
    },
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
      bufferBytes: MAX_POINTS * 16 * (partner ? 3 : 2) + book.geometryBytes,
      scene,
      book: {
        ...book,
        materials: [...book.materials],
        anchors: { left: [...leftDock], right: [...rightDock] },
      },
      width,
      height,
      samples,
    }),
    async readPoints(count: number, source: 'compute' | 'cached') {
      const points = await (source === 'cached' ? cached : live).read()
      return points
        .slice(0, count)
        .map((point) => [point.x, point.y, point.z, point.w])
    },
    dispose() {
      disposed = true
      bookRequest?.abort()
      bookPass?.dispose()
      hdr?.destroy()
      multisampledHdr?.destroy()
      depth?.destroy()
      root.destroy()
    },
  }
}
