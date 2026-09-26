// TypeGPU owns persistent resources; native XR supplies only this frame's targets.
import { d, tgpu } from 'typegpu'
import { SILENT_MUSIC } from './audio'
import { CHAIN_COUNT, POINT_COUNT, sampleCachedPoints } from './sampling'
import { Camera, computeFlame, computeLayout, fragment, renderLayout, STAR_COUNT, vertex, } from './shaders'
import type { TgpuRenderPipeline } from 'typegpu'
import type { MusicFrame } from './audio'
import type { EyeTarget } from './xrTypes'

export type SceneMode = 'probe' | 'cached' | 'compute'

function makeStars() {
  const data = new Float32Array(STAR_COUNT * 4)
  let seed = 29817
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = random() * 2 - 1
    const a = random() * Math.PI * 2
    const r = 10 + random() * 25
    const ring = Math.sqrt(1 - y * y)
    data.set(
      [Math.cos(a) * ring * r, y * r + 1.6, Math.sin(a) * ring * r, random()],
      i * 4,
    )
  }
  return data
}

export function createRenderer(device: GPUDevice) {
  const root = tgpu.initFromDevice({ device })
  const initial = sampleCachedPoints()
  const schema = d.arrayOf(d.vec4f, POINT_COUNT)
  const cached = root
    .createBuffer(schema, initial)
    .$usage('storage')
    .$name('cached flame')
  const live = root
    .createBuffer(schema)
    .$usage('storage')
    .$name('persistent live flame')
  const stars = root
    .createBuffer(d.arrayOf(d.vec4f, STAR_COUNT), makeStars())
    .$usage('storage')
  const compute = root
    .createComputePipeline({ compute: computeFlame })
    .with(root.createBindGroup(computeLayout, { points: live }))
  const pipelines = new Map<GPUTextureFormat, TgpuRenderPipeline>()
  const eyes = Array.from({ length: 2 }, () => {
    const camera = root.createBuffer(Camera).$usage('uniform')
    return {
      camera,
      raw: new Float32Array(d.sizeOf(Camera) / 4),
      live: root.createBindGroup(renderLayout, { camera, points: live, stars }),
      cached: root.createBindGroup(renderLayout, {
        camera,
        points: cached,
        stars,
      }),
    }
  })
  let generation = 0
  let rebuildRequested = true
  let submissions = 0
  const bufferId = window.crypto.randomUUID()
  // Compilation is forced during loading, not during the first moving XR frame.
  root.unwrap(compute)

  function prepare(format: GPUTextureFormat) {
    if (pipelines.has(format)) return
    const pipeline = root.createRenderPipeline({
      vertex,
      fragment,
      targets: {
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        },
      },
    })
    root.unwrap(pipeline)
    pipelines.set(format, pipeline)
  }

  function rebuild(encoder: GPUCommandEncoder) {
    compute.with(encoder).dispatchWorkgroups(Math.ceil(CHAIN_COUNT / 64))
    generation++
    rebuildRequested = false
  }
  return {
    prepare,
    render(
      targets: EyeTarget[],
      format: GPUTextureFormat,
      mode: SceneMode,
      elapsed: number,
      music: MusicFrame = SILENT_MUSIC,
      strength = 0.65,
    ) {
      if (!targets.length) return
      if (targets.length > eyes.length)
        throw new Error('This proof supports at most two XR views.')
      const pipeline = pipelines.get(format)
      if (!pipeline) throw new Error(`Unprepared color format: ${format}`)
      const encoder = device.createCommandEncoder({
        label: 'one flame generation, all eyes',
      })
      if (mode === 'compute' && rebuildRequested) rebuild(encoder)
      targets.forEach((target, index) => {
        const eye = eyes[index]
        eye.raw.set(target.view, 0)
        eye.raw.set(target.projection, 16)
        eye.raw.set([elapsed, 0, 0, mode === 'probe' ? 1 : 0], 32)
        eye.raw.set([music.energy, music.low, music.mid, music.high], 36)
        eye.raw.set([music.time, strength, 0, 0], 40)
        // Separate buffers avoid both eyes seeing the last queue.writeBuffer.
        eye.camera.write(eye.raw.buffer)
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.color,
              loadOp: target.clear ? 'clear' : 'load',
              storeOp: 'store',
              clearValue: { r: 0.003, g: 0.008, b: 0.019, a: 1 },
            },
          ],
        })
        const v = target.viewport
        pass.setViewport(v.x, v.y, v.width, v.height, 0, 1)
        pass.setScissorRect(v.x, v.y, v.width, v.height)
        pipeline
          .with(mode === 'compute' ? eye.live : eye.cached)
          .with(pass)
          .draw(
            mode === 'probe' ? 3 : 6,
            mode === 'probe' ? 3 : POINT_COUNT + STAR_COUNT,
          )
        pass.end()
      })
      device.queue.submit([encoder.finish()])
      submissions++
    },
    stats: () => ({
      generation,
      sampling: 'stable orbit paths; GPU rebuilds only on demand',
      submissions,
      bufferId,
      pointCount: POINT_COUNT,
      pipelineFormats: [...pipelines.keys()],
    }),
    // Manual, development-only verification. Never called in the frame loop.
    async readPoints(count = 32, source: 'cached' | 'compute' = 'compute') {
      return (await (source === 'cached' ? cached : live).read())
        .slice(0, count)
        .map((p) => [p.x, p.y, p.z, p.w])
    },
    requestRebuild() {
      rebuildRequested = true
    },
    async rebuildForTest() {
      const encoder = device.createCommandEncoder()
      rebuild(encoder)
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
    },
    shader: () => tgpu.resolve([computeFlame]),
    dispose: () => {
      root.destroy()
    },
  }
}
