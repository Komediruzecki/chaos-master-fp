// One desktop render owner for compute, opaque depth, luminous points and resolve.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { loadBookGeometry } from '../almanac/bookAsset'
import { BOOK_RELIEFS, EMPTY_BOOK_AWARDS } from '../almanac/bookAwards'
import { EMPTY_BOOK_DETAIL } from '../almanac/bookDetailData'
import { createBookDetailResources } from '../almanac/bookDetailResources'
import { createBookPass } from '../almanac/bookPass'
import { ALMANAC_WORLDS, settingsForWorld } from '../almanac/catalog'
import { WORLD_VISUALS } from '../almanac/worldIdentity'
import { SAMPLE_STEPS } from './recipes'
import { cloudFragment, cloudVertex, constructSpecimen, fullScreenVertex, resolveFragment, resolveLayout, SampleConfig, samplingLayout, sceneLayout, solidFragment, solidVertex, View, } from './shaders'
import type { TgpuBindGroup } from 'typegpu'
import type { BookGeometry } from '../almanac/bookAsset'
import type { BookAwards } from '../almanac/bookAwards'
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

function bookSpecimen(dock: 'left' | 'right') {
  const id = dock === 'left' ? 'glasswake' : 'tideweave'
  const world = ALMANAC_WORLDS.find((entry) => entry.id === id)
  const settings = world ? settingsForWorld(world) : undefined
  if (!settings || settings.recipe === undefined || settings.seed === undefined)
    throw new Error(`The Almanac study ${id} has no supported specimen.`)
  return { ...settings, recipe: settings.recipe, seed: settings.seed }
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
    reliefStatus: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    reliefError: '',
    dock: 'left' as 'left' | 'right',
    inspecting: false,
    clay: false,
    awards: { ...EMPTY_BOOK_AWARDS },
    reliefTriangles: 0,
    triangles: 0,
    geometryBytes: 0,
    bytes: 0,
    materials: [] as string[],
    draws: 0,
  }
  let bookPass: ReturnType<typeof createBookPass> | undefined
  let bookDetail: ReturnType<typeof createBookDetailResources> | undefined
  let reliefPasses: (ReturnType<typeof createBookPass> | undefined)[] = []
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

  function updateBookDraws() {
    book.draws =
      (bookPass ? 1 : 0) +
      BOOK_RELIEFS.filter(
        (relief, index) => book.awards[relief.id] && reliefPasses[index],
      ).length
  }

  async function loadBook() {
    bookRequest?.abort()
    const request = new AbortController()
    bookRequest = request
    book.status = 'loading'
    book.error = ''
    book.reliefStatus = 'loading'
    book.reliefError = ''
    changed()
    const stale = () =>
      disposed || bookRequest !== request || request.signal.aborted
    // Optional details never withhold the base book, including on a slow connection.
    const reliefLoads = Promise.allSettled(
      BOOK_RELIEFS.map((relief) =>
        loadBookGeometry(request.signal, relief.url),
      ),
    )

    async function upload(geometry: BookGeometry) {
      device.pushErrorScope('validation')
      let candidate: ReturnType<typeof createBookPass> | undefined
      try {
        let validation: GPUError | null
        try {
          bookDetail ??= createBookDetailResources(root, changed)
          void bookDetail.load()
          candidate = createBookPass(root, camera, geometry, 4, bookDetail)
        } finally {
          validation = await device.popErrorScope()
        }
        if (validation) throw new Error(validation.message)
        if (stale()) {
          candidate.dispose()
          return undefined
        }
        return candidate
      } catch (error) {
        candidate?.dispose()
        throw error
      }
    }
    try {
      const geometry = await loadBookGeometry(request.signal)
      if (stale()) return
      if (!geometry.anchors.OrbDockLeft || !geometry.anchors.OrbDockRight)
        throw new Error(
          'The Almanac model is missing its orb attachment points.',
        )
      const loaded = await upload(geometry)
      if (!loaded) return
      bookPass?.dispose()
      reliefPasses.forEach((relief) => relief?.dispose())
      reliefPasses = []
      bookPass = loaded
      leftDock = geometry.anchors.OrbDockLeft
      rightDock = geometry.anchors.OrbDockRight
      book.status = 'ready'
      book.triangles = geometry.triangles
      book.reliefTriangles = 0
      book.geometryBytes =
        geometry.vertices.byteLength + geometry.indices.byteLength
      book.bytes = geometry.bytes
      book.materials = [...geometry.materials]
      updateBookDraws()
      changed()
      const reliefs = await reliefLoads
      if (stale()) return
      const failures: string[] = []
      for (let index = 0; index < reliefs.length; index++) {
        const result = reliefs[index]
        if (result.status === 'rejected') {
          failures.push(`${BOOK_RELIEFS[index].id}: ${String(result.reason)}`)
          continue
        }
        try {
          const relief = await upload(result.value)
          if (!relief) return
          reliefPasses[index] = relief
          book.reliefTriangles += result.value.triangles
          book.geometryBytes +=
            result.value.vertices.byteLength + result.value.indices.byteLength
          book.bytes += result.value.bytes
          book.materials = [
            ...new Set([...book.materials, ...result.value.materials]),
          ]
        } catch (error) {
          if (stale()) return
          failures.push(`${BOOK_RELIEFS[index].id}: ${String(error)}`)
        }
      }
      book.reliefStatus = failures.length ? 'error' : 'ready'
      book.reliefError = failures.join('; ')
      updateBookDraws()
      changed()
    } catch (error) {
      if (stale()) return
      request.abort()
      book.status = 'error'
      book.error = error instanceof Error ? error.message : String(error)
      book.reliefStatus = 'idle'
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
    const visual = settings.worldVisual
      ? WORLD_VISUALS[settings.worldVisual]
      : undefined
    const other = isBook
      ? bookSpecimen(book.dock === 'left' ? 'right' : 'left')
      : undefined
    const otherVisual = other?.worldVisual
      ? WORLD_VISUALS[other.worldVisual]
      : undefined
    const dock = book.dock === 'left' ? leftDock : rightDock
    const otherDock = book.dock === 'left' ? rightDock : leftDock
    const yaw = ((settings.yaw + (isBook ? -8 : 0)) * Math.PI) / 180
    const pitch =
      ((isBook
        ? Math.max(
            -75,
            Math.min(85, settings.pitch + (book.inspecting ? 12 : 50)),
          )
        : settings.pitch) *
        Math.PI) /
      180
    const distance =
      settings.distance *
      (isBook
        ? book.inspecting
          ? 0.38
          : 1.15 * Math.max(1, 1.3 / (width / height))
        : 1)
    const target = isBook
      ? book.inspecting
        ? dock
        : [dock[0] * 0.18, 0.25, 0]
      : [0, 0, 0]
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
    raw.set([...(visual?.low ?? palettes[settings.palette][0]), 0], 36)
    raw.set([...(visual?.high ?? palettes[settings.palette][1]), 0], 40)
    const barZ =
      settings.depthProbe === 'front'
        ? 1.4
        : settings.depthProbe === 'behind'
          ? -1.4
          : 0
    raw.set(
      [
        Number(settings.rings),
        Number(settings.depthProbe !== 'off'),
        barZ,
        visual?.style ?? 0,
      ],
      44,
    )
    raw.set(isBook ? [...dock, 0.34] : [0, 0, 0, 1], 48)
    raw.set([...eye, Number(book.clay && isBook)], 52)
    raw.set([...leftDock, Number(isBook)], 56)
    raw.set([...rightDock, 0], 60)
    camera.write(raw.buffer)
    if (other) {
      partner ??= createPartner()
      const partnerKey = `${other.recipe}:${settings.pointCount}:${other.seed}`
      if (partnerIdentity !== partnerKey) {
        partner.sampleConfig.write({
          values: d.vec4u(other.recipe, settings.pointCount, other.seed, 0),
        })
        partner.compute
          .with(encoder)
          .dispatchWorkgroups(
            Math.ceil(settings.pointCount / SAMPLE_STEPS / 64),
          )
        partnerIdentity = partnerKey
      }
      raw.set([...otherDock, 0.34], 48)
      const otherPalette = palettes[other.palette ?? 'lagoon']
      raw.set([...(otherVisual?.low ?? otherPalette[0]), 0], 36)
      raw.set([...(otherVisual?.high ?? otherPalette[1]), 0], 40)
      raw.set([Number(other.rings), 0, 0, otherVisual?.style ?? 0], 44)
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
    if (isBook) {
      bookPass?.draw(pass)
      BOOK_RELIEFS.forEach((relief, index) => {
        if (book.awards[relief.id]) reliefPasses[index]?.draw(pass)
      })
    }
    if (settings.rings)
      solidPipeline
        .with(group)
        .with(pass)
        .draw(192 * 8 * 6, visual?.style === 2 ? 1 : 2)
    if (settings.depthProbe !== 'off')
      solidPipeline.with(group).with(pass).draw(6, 1, 0, 2)
    if (isBook && partner) {
      if (other?.rings)
        solidPipeline
          .with(partner.group)
          .with(pass)
          .draw(192 * 8 * 6, otherVisual?.style === 2 ? 1 : 2)
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
    setBookAwards(awards: BookAwards) {
      book.awards = { ...awards }
      updateBookDraws()
    },
    retryBook() {
      if (
        !disposed &&
        book.status !== 'loading' &&
        book.reliefStatus !== 'loading'
      )
        void loadBook()
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
        detail: bookDetail?.snapshot() ?? { ...EMPTY_BOOK_DETAIL },
        awards: { ...book.awards },
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
      reliefPasses.forEach((relief) => relief?.dispose())
      bookDetail?.dispose()
      hdr?.destroy()
      multisampledHdr?.destroy()
      depth?.destroy()
      root.destroy()
    },
  }
}
