// One retained-point and opaque-mesh render owner for the desktop observatory.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { parseBookGlb } from '../almanac/bookAsset'
import { ALMANAC_WORLDS, settingsForWorld } from '../almanac/catalog'
import { SAMPLE_STEPS } from '../bench/recipes'
import { cloudFragment, constructSpecimen, fullScreenVertex, resolveLayout, SampleConfig, samplingLayout, sceneLayout, View, } from '../bench/shaders'
import { createGlasswakePass } from './glasswakePass'
import { beamMatrix, createModelPass, primitiveGeometry } from './modelPass'
import { clamp, EMPTY_GLASSWAKE, GLASSWAKE_CENTER, OBSERVATORY_ASSETS, sceneCamera, traceWorld, WORLD_PLACEMENTS, } from './scene'
import { Model, modelLayout, orbVertex, Sky, skyFragment, skyLayout, toneMapFragment, } from './shaders'
import { EMPTY_TEMPLE, EMPTY_TEMPLE_STATS, TEMPLE_WORLD_PLACEMENTS, } from './temple'
import { createTempleAtmosphere } from './templeAtmosphere'
import { createTemplePass } from './templePass'
import { createWorldOrnaments } from './worldOrnaments'
import type { TgpuBindGroup } from 'typegpu'
import type { AssetStatus, ObservatoryFrame, Vec3, WorldId } from './scene'

const POINTS = 131072
const MSAA = 4
const identity = mat4.identity()

function transform(position: Vec3, scale = 1, yaw = 0, pitch = 0) {
  const matrix = mat4.translation(position)
  mat4.rotateY(matrix, yaw, matrix)
  mat4.rotateX(matrix, pitch, matrix)
  mat4.scale(matrix, [scale, scale, scale], matrix)
  return matrix
}

export function createObservatoryRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  changed: () => void,
) {
  const root = tgpu.initFromDevice({ device })
  const camera = root.createBuffer(View).$usage('uniform')
  const cameraRaw = new Float32Array(d.sizeOf(View) / 4)
  const sky = root.createBuffer(Sky).$usage('uniform')
  const skyRaw = new Float32Array(d.sizeOf(Sky) / 4)
  const skyGroup = root.createBindGroup(skyLayout, { sky })
  const skyPipeline = root
    .createRenderPipeline({
      vertex: fullScreenVertex,
      fragment: skyFragment,
      targets: { format: 'rgba16float' },
      multisample: { count: MSAA },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
    .with(skyGroup)
  const cloud = root.createRenderPipeline({
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
    multisample: { count: MSAA },
  })
  const resolve = root.createRenderPipeline({
    vertex: fullScreenVertex,
    fragment: toneMapFragment,
    targets: { format },
  })
  root.unwrap(skyPipeline)
  root.unwrap(cloud)
  root.unwrap(resolve)
  const sphere = createModelPass(root, camera, primitiveGeometry('sphere'))
  const ring = createModelPass(root, camera, primitiveGeometry('ring'))
  const beam = createModelPass(root, camera, primitiveGeometry('beam'))
  const loaded = new Map<string, ReturnType<typeof createModelPass>>()
  const assetStates: AssetStatus[] = OBSERVATORY_ASSETS.map((asset) => ({
    id: asset.id,
    status: 'idle',
    error: '',
    triangles: 0,
    bytes: 0,
  }))
  const requests = new Map<string, AbortController>()
  const worlds = Object.entries(WORLD_PLACEMENTS).map(([id, config]) => {
    const catalogWorld = ALMANAC_WORLDS.find((world) => world.id === id)
    const settings = catalogWorld && settingsForWorld(catalogWorld)
    if (settings?.recipe === undefined || settings.seed === undefined)
      throw new Error(`No specimen identity for ${id}.`)
    const points = root
      .createBuffer(d.arrayOf(d.vec4f, POINTS))
      .$usage('storage')
    const sample = root.createBuffer(SampleConfig).$usage('uniform')
    sample.write({ values: d.vec4u(settings.recipe, POINTS, settings.seed, 0) })
    const view = root.createBuffer(View).$usage('uniform')
    const model = root.createBuffer(Model).$usage('uniform')
    return {
      id: id as WorldId,
      config,
      ornaments: createModelPass(
        root,
        camera,
        createWorldOrnaments(id as WorldId),
      ),
      points,
      sample,
      view,
      model,
      raw: new Float32Array(d.sizeOf(View) / 4),
      modelRaw: new Float32Array(d.sizeOf(Model) / 4),
      group: root.createBindGroup(sceneLayout, { camera: view, points }),
      modelGroup: root.createBindGroup(modelLayout, { model }),
      compute: root
        .createComputePipeline({ compute: constructSpecimen })
        .with(root.createBindGroup(samplingLayout, { config: sample, points })),
    }
  })
  let glass: ReturnType<typeof createGlasswakePass> | undefined
  let temple: ReturnType<typeof createTemplePass> | undefined
  let templeAtmosphere: ReturnType<typeof createTempleAtmosphere> | undefined
  let templeStats = { ...EMPTY_TEMPLE_STATS }
  let renderedShards = 0
  let disposed = false
  let generated = false
  let generations = 0
  let submissions = 0
  let width = 0
  let height = 0
  let drawCalls = 0
  let triangles = 0
  let hdr: GPUTexture | undefined
  let msaa: GPUTexture | undefined
  let depth: GPUTexture | undefined
  let hdrView: GPUTextureView | undefined
  let msaaView: GPUTextureView | undefined
  let depthView: GPUTextureView | undefined
  let resolveGroup: TgpuBindGroup | undefined
  let projectedCamera: ReturnType<typeof sceneCamera> | undefined
  let bridgeProgress = 0
  let lastBridgeTarget = 0
  let previousTime = 0

  async function loadAssets() {
    await Promise.all(
      OBSERVATORY_ASSETS.map(async (asset) => {
        const state = assetStates.find(
          (candidate) => candidate.id === asset.id,
        )!
        if (state.status === 'loading' || state.status === 'ready' || disposed)
          return
        const request = new AbortController()
        requests.set(asset.id, request)
        state.status = 'loading'
        state.error = ''
        changed()
        try {
          const response = await fetch(asset.url, { signal: request.signal })
          if (!response.ok)
            throw new Error(`Model request failed (HTTP ${response.status}).`)
          const bytes = await response.arrayBuffer()
          if (bytes.byteLength > 32 * 1024 * 1024)
            throw new Error('Model exceeds the 32 MiB study limit.')
          const geometry = parseBookGlb(bytes)
          if (disposed || request.signal.aborted) return
          device.pushErrorScope('validation')
          let model: ReturnType<typeof createModelPass> | undefined
          let validation: GPUError | null = null
          try {
            try {
              model = createModelPass(root, camera, geometry)
            } finally {
              validation = await device.popErrorScope()
            }
          } catch (error) {
            model?.dispose()
            throw error
          }
          if (disposed || request.signal.aborted || validation) {
            model?.dispose()
            if (validation) throw new Error(validation.message)
            return
          }
          loaded.set(asset.id, model)
          state.status = 'ready'
          state.bytes = bytes.byteLength
          state.triangles = geometry.triangles
        } catch (error) {
          if (disposed || request.signal.aborted) return
          state.status = 'error'
          state.error = error instanceof Error ? error.message : String(error)
        } finally {
          requests.delete(asset.id)
          if (!disposed) changed()
        }
      }),
    )
  }

  function resize(w: number, h: number) {
    if (w === width && h === height) return
    hdr?.destroy()
    msaa?.destroy()
    depth?.destroy()
    width = w
    height = h
    hdr = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    msaa = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      sampleCount: MSAA,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    depth = device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      sampleCount: MSAA,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    hdrView = hdr.createView()
    msaaView = msaa.createView()
    depthView = depth.createView()
    resolveGroup = root.createBindGroup(resolveLayout, {
      image: hdrView,
      camera,
    })
  }

  function drawModel(
    pass: GPURenderPassEncoder,
    model: ReturnType<typeof createModelPass> | undefined,
    id: string,
    matrix: ArrayLike<number>,
    tint?: readonly number[],
  ) {
    if (!model) return
    model.draw(pass, id, matrix, tint)
    drawCalls++
    triangles += model.triangles
  }

  function drawTrace(pass: GPURenderPassEncoder, frame: ObservatoryFrame) {
    if (frame.view !== 'trace') return
    const { target, response, acceptedSegments, phase } = frame.trace
    target.forEach((point, index) => {
      const position = traceWorld(point)
      const accepted = index < acceptedSegments
      const active = phase === 'demo' && frame.instructionNote === index
      const tint = accepted
        ? [0.2, 1, 0.65, 0.8]
        : active
          ? [1, 0.85, 0.4, 1.1]
          : [0.25, 0.65, 0.9, 0.25]
      drawModel(
        pass,
        sphere,
        `trace-anchor-${index}`,
        transform(position, 0.04),
        tint,
      )
      if (index > 0)
        drawModel(
          pass,
          beam,
          `trace-target-${index}`,
          beamMatrix(traceWorld(target[index - 1]), position, 0.007),
          [0.2, 0.55, 0.8, 0.25],
        )
    })
    // Downsample only the displayed trail, preserving the pure judge's full input.
    const stride = Math.max(1, Math.ceil(response.length / 96))
    for (let i = stride; i < response.length; i += stride) {
      drawModel(
        pass,
        beam,
        `trace-response-${Math.floor(i / stride)}`,
        beamMatrix(
          traceWorld(response[i - stride]),
          traceWorld(response[i]),
          0.009,
        ),
        [0.3, 1, 0.7, 0.8],
      )
    }
  }

  function render(
    color: GPUTextureView,
    w: number,
    h: number,
    frame: ObservatoryFrame,
  ) {
    if (disposed) return
    resize(w, h)
    const glassMode = frame.view === 'glasswake'
    const templeMode = frame.view === 'temple'
    const worldPlacements = templeMode
      ? TEMPLE_WORLD_PLACEMENTS
      : WORLD_PLACEMENTS
    if (templeMode) {
      temple ??= createTemplePass(root, camera)
      templeAtmosphere ??= createTempleAtmosphere(root, camera)
    }
    templeStats = { ...EMPTY_TEMPLE_STATS }
    if (glassMode) glass ??= createGlasswakePass(root, camera)
    renderedShards = 0
    projectedCamera = sceneCamera(frame, w / h)
    const { eye, view, projection, inverse, fov } = projectedCamera
    cameraRaw.set(view, 0)
    cameraRaw.set(projection, 16)
    cameraRaw.set([0.003, 1.05, 0.48, 0], 32)
    cameraRaw.set([...eye, Number(frame.clay)], 52)
    cameraRaw.set([...worldPlacements.glasswake.center, 0], 56)
    cameraRaw.set([...worldPlacements.tideweave.center, 0], 60)
    camera.write(cameraRaw.buffer)
    skyRaw.set(inverse, 0)
    skyRaw.set([...eye, 0], 16)
    skyRaw.set([w, h, 0, 0], 20)
    skyRaw.set(
      [...worldPlacements.glasswake.center, worldPlacements.glasswake.scale],
      24,
    )
    skyRaw.set(
      [...worldPlacements.tideweave.center, worldPlacements.tideweave.scale],
      28,
    )
    sky.write(skyRaw.buffer)
    const encoder = device.createCommandEncoder()
    if (!generated) {
      worlds.forEach((world) => {
        world.compute
          .with(encoder)
          .dispatchWorkgroups(Math.ceil(POINTS / SAMPLE_STEPS / 64))
      })
      generated = true
      generations += worlds.length
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaaView!,
          resolveTarget: hdrView,
          loadOp: 'clear',
          storeOp: 'discard',
          clearValue: [0, 0, 0, 0],
        },
      ],
      depthStencilAttachment: {
        view: depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    })
    drawCalls = 1
    triangles = 1
    skyPipeline.with(pass).draw(3)
    if (
      templeMode &&
      !frame.clay &&
      templeAtmosphere?.draw(
        pass,
        frame.temple ?? EMPTY_TEMPLE,
        frame.motion ?? true,
      )
    ) {
      drawCalls++
      triangles += 2
    }
    if (!glassMode && !templeMode) {
      // Close encounter framing would put narrow views beneath the bay's overhead beam.
      drawModel(pass, loaded.get('bay'), 'bay', identity)
      drawModel(
        pass,
        loaded.get('book'),
        'book',
        transform([0, 0.91, -0.1], 0.65),
      )
      drawModel(pass, loaded.get('landing'), 'landing', transform([0, 0, -10]))
      drawModel(
        pass,
        loaded.get('relic'),
        'relic',
        transform([0, 0.1, -10], 1.5, frame.time * 0.08),
      )
    } else if (glassMode) {
      drawModel(
        pass,
        loaded.get('landing'),
        'glasswake-plinth',
        transform([0, 0.04, -4.6], 0.65),
        [1, 0.87, 0.64, 0.06],
      )
    }
    const wanted =
      clamp(
        frame.trace.acceptedSegments / Math.max(1, frame.trace.segmentCount),
        0,
        1,
      ) * 5
    const delta = clamp(frame.time - previousTime, 0, 0.05)
    previousTime = frame.time
    if (wanted < bridgeProgress || (delta === 0 && wanted !== lastBridgeTarget))
      bridgeProgress = wanted
    else bridgeProgress = Math.min(wanted, bridgeProgress + delta * 2.5)
    lastBridgeTarget = wanted
    for (let i = 0; i < 5; i++) {
      const reveal = clamp(bridgeProgress - i, 0, 1)
      if (reveal > 0 && !glassMode && !templeMode)
        drawModel(
          pass,
          loaded.get('bridge'),
          `bridge-${i}`,
          transform([0, -0.42 * (1 - reveal), -4.2 - i], 1),
          [0.65 + reveal * 0.35, 0.75 + reveal * 0.25, 1, (1 - reveal) * 0.25],
        )
    }
    if (!glassMode && !templeMode) {
      // A distant destination reads as an instrument, without claiming finished temple lore.
      drawModel(
        pass,
        ring,
        'arrival-ring',
        transform([0, 1, -10], 1.15, frame.time * 0.03, Math.PI / 2),
        [0.7, 0.75, 1, 0.2],
      )
    }
    if (!glassMode) {
      worlds.forEach((world) => {
        const placement = worldPlacements[world.id]
        const position = placement.center
        const selected = frame.selectedWorld === world.id
        const time = frame.time
        const glasswake = world.id === 'glasswake'
        const matrix = transform(
          position,
          placement.scale,
          glasswake ? Math.sin(time * 0.11) * 0.1 : -time * 0.045,
          glasswake ? 0.06 : Math.sin(time * 0.13) * 0.07,
        )
        if (glasswake) mat4.rotateZ(matrix, time * 0.025, matrix)
        drawModel(pass, world.ornaments, `${world.id}-ornaments`, matrix, [
          1,
          1,
          1,
          selected ? 0.09 : 0.035,
        ])
      })
      drawTrace(pass, frame)
    }
    worlds.forEach((world) => {
      if (glassMode && world.id !== 'glasswake') return
      const { low, high } = world.config
      const placement = worldPlacements[world.id]
      const center = glassMode ? GLASSWAKE_CENTER : placement.center
      const scale = glassMode ? 0.65 : placement.scale
      const selected = world.id === frame.selectedWorld
      const depthAt = -(
        view[2] * center[0] +
        view[6] * center[1] +
        view[10] * center[2] +
        view[14]
      )
      const footprint = Math.max(
        0.0035,
        (Math.max(depthAt, 0.1) * Math.tan(fov / 2) * 1.3) / (h * scale),
      )
      const gain = Math.pow(0.003 / footprint, 2) * 0.62
      world.raw.set(cameraRaw)
      world.raw.set([footprint, 1.05, gain, 0], 32)
      world.raw.set([...low, 0], 36)
      world.raw.set([...high, 0], 40)
      world.view.write(world.raw.buffer)
      const glasswake = world.id === 'glasswake'
      const coreMatrix = transform(
        center,
        scale,
        glasswake ? Math.sin(frame.time * 0.11) * 0.1 : -frame.time * 0.045,
        glasswake ? 0.06 : Math.sin(frame.time * 0.13) * 0.07,
      )
      if (glasswake) mat4.rotateZ(coreMatrix, frame.time * 0.025, coreMatrix)
      world.modelRaw.set(coreMatrix, 0)
      world.modelRaw.set([1, 1, 1, 0], 16)
      world.modelRaw.set(
        [
          frame.time,
          templeMode || selected ? frame.music.level : 0,
          scale,
          world.config.style,
        ],
        20,
      )
      world.model.write(world.modelRaw.buffer)
      cloud.with(world.group).with(world.modelGroup).with(pass).draw(6, POINTS)
      drawCalls++
      triangles += POINTS * 2
    })
    if (templeMode && temple) {
      temple.draw(pass, frame.temple ?? EMPTY_TEMPLE, frame.motion ?? true)
      templeStats = temple.stats()
      drawCalls += templeStats.renderedParts + templeStats.connectionSegments
      triangles += templeStats.visibleTriangles
    }
    if (glassMode && glass) {
      glass.draw(
        pass,
        {
          ...(frame.glasswake ?? EMPTY_GLASSWAKE),
          center: GLASSWAKE_CENTER,
          motion: frame.motion ?? true,
          clay: frame.clay,
        },
        eye,
      )
      const stats = glass.stats()
      renderedShards = stats.visibleShards
      drawCalls += stats.drawCalls
      triangles += stats.triangles
    }
    pass.end()
    const final = encoder.beginRenderPass({
      colorAttachments: [{ view: color, loadOp: 'clear', storeOp: 'store' }],
    })
    resolve.with(resolveGroup!).with(final).draw(3)
    final.end()
    drawCalls++
    triangles++
    device.queue.submit([encoder.finish()])
    submissions++
  }

  return {
    render,
    loadAssets,
    camera: () => projectedCamera,
    stats: () => ({
      assets: assetStates.map((asset) => ({ ...asset })),
      submissions,
      generations,
      drawCalls,
      triangles,
      bridgeProgress,
      renderedShards,
      temple: { ...templeStats },
      livePoints: POINTS * worlds.length,
      bufferBytes:
        (glass?.stats().bytes ?? 0) +
        (temple?.bytes ?? 0) +
        (templeAtmosphere?.bytes ?? 0) +
        d.sizeOf(View) +
        d.sizeOf(Sky) +
        worlds.length *
          (POINTS * 16 +
            d.sizeOf(SampleConfig) +
            d.sizeOf(View) +
            d.sizeOf(Model)) +
        [
          ...loaded.values(),
          ...worlds.map((world) => world.ornaments),
          sphere,
          ring,
          beam,
        ].reduce((sum, model) => sum + model.bytes, 0),
      width,
      height,
    }),
    async readPoints(worldId: WorldId, count = 32) {
      const world = worlds.find((candidate) => candidate.id === worldId)!
      return (await world.points.read())
        .slice(0, clamp(count, 1, POINTS))
        .map((point) => [point.x, point.y, point.z, point.w])
    },
    dispose() {
      disposed = true
      for (const request of requests.values()) request.abort()
      requests.clear()
      for (const model of [
        ...loaded.values(),
        ...worlds.map((world) => world.ornaments),
        sphere,
        ring,
        beam,
      ])
        model.dispose()
      loaded.clear()
      glass?.dispose()
      temple?.dispose()
      templeAtmosphere?.dispose()
      hdr?.destroy()
      msaa?.destroy()
      depth?.destroy()
      // Runtime owns the device and destroys it immediately after this disposer,
      // releasing the shared camera, sky and retained-world buffers together.
      root.destroy()
    },
  }
}
