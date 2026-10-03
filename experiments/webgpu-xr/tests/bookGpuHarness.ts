// Hardware framebuffer proof that the imported book occludes actual flame samples.
import { d, tgpu } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { loadBookGeometry } from '../src/almanac/bookAsset'
import { createBookPass } from '../src/almanac/bookPass'
import { sampleSpecimen } from '../src/bench/recipes'
import { createBenchRenderer } from '../src/bench/renderer'
import { DEFAULT_BENCH_SETTINGS } from '../src/bench/settings'
import { cloudFragment, cloudVertex, sceneLayout, View, } from '../src/bench/shaders'

export async function verifyBookDepth() {
  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter)
    throw new Error('No hardware adapter for book depth verification')
  const device = await adapter.requestDevice()
  const root = tgpu.initFromDevice({ device })
  const size = 512
  const hdr = device.createTexture({
    size: [size, size],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const depth = device.createTexture({
    size: [size, size],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const colorView = hdr.createView()
  const depthView = depth.createView()
  const readback = device.createBuffer({
    size: size * size * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  device.pushErrorScope('validation')
  try {
    const camera = root.createBuffer(View).$usage('uniform')
    const raw = new Float32Array(d.sizeOf(View) / 4)
    raw.set(mat4.lookAt([0, 4, 0.001], [0, 0, 0], [0, 0, -1]), 0)
    raw.set(mat4.perspective(Math.PI / 4, 1, 0.05, 10), 16)
    raw.set([0.006, 1, 0.6, 0], 32)
    raw.set([0.002, 0.32, 0.39, 0], 36)
    raw.set([1, 0.42, 0.055, 0], 40)
    raw.set([0, 4, 0.001, 0], 52)
    const points = root
      .createBuffer(d.arrayOf(d.vec4f, 32768))
      .$usage('storage')
    points.write(new Float32Array(sampleSpecimen(0, 32768, 73129)).buffer)
    const geometry = await loadBookGeometry(new AbortController().signal)
    raw.set([...geometry.anchors.OrbDockLeft, 0], 56)
    raw.set([...geometry.anchors.OrbDockRight, 0], 60)
    const book = createBookPass(root, camera, geometry)
    const cloud = root
      .createRenderPipeline({
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
      .with(root.createBindGroup(sceneLayout, { camera, points }))
    root.unwrap(cloud)
    const draw = async (height: number | null, withBook = true) => {
      raw.set([-0.69, height ?? 0.67, 0, 0.28], 48)
      camera.write(raw.buffer)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: colorView, loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      })
      if (withBook) book.draw(pass)
      if (height !== null) cloud.with(pass).draw(6, 32768)
      pass.end()
      encoder.copyTextureToBuffer(
        { texture: hdr },
        { buffer: readback, bytesPerRow: size * 8 },
        [size, size],
      )
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const values = new Uint16Array(readback.getMappedRange()).slice()
      readback.unmap()
      return values
    }
    const baseline = await draw(null)
    const above = await draw(0.67)
    const below = await draw(-0.5)
    const unblockedBelow = await draw(-0.5, false)
    let aboveChanged = 0,
      belowChanged = 0,
      unblockedPixels = 0
    for (let pixel = 0; pixel < size * size; pixel++) {
      const at = pixel * 4
      // Exact binary16 equality is intentional: fully occluded fragments must
      // leave the independently rendered opaque baseline untouched.
      if (
        above[at] !== baseline[at] ||
        above[at + 1] !== baseline[at + 1] ||
        above[at + 2] !== baseline[at + 2]
      )
        aboveChanged++
      if (
        below[at] !== baseline[at] ||
        below[at + 1] !== baseline[at + 1] ||
        below[at + 2] !== baseline[at + 2]
      )
        belowChanged++
      if (
        unblockedBelow[at] ||
        unblockedBelow[at + 1] ||
        unblockedBelow[at + 2]
      )
        unblockedPixels++
    }
    const validation = await device.popErrorScope()
    if (validation) throw new Error(validation.message)
    if (aboveChanged < 300 || unblockedPixels < 200 || belowChanged !== 0)
      throw new Error(
        `Book depth failed: ${JSON.stringify({ aboveChanged, belowChanged, unblockedPixels })}`,
      )
    return {
      aboveChanged,
      belowChanged,
      unblockedPixels,
      triangles: geometry.triangles,
      bookOccludesFlame: true,
      format: 'rgba16float',
      size,
      nativeHeadsetTested: false,
    }
  } finally {
    readback.destroy()
    hdr.destroy()
    depth.destroy()
    root.destroy()
    device.destroy()
  }
}

/** A phone-size framebuffer must retain the selected live flame above its page. */
export async function verifyBookPhoneVisibility() {
  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter)
    throw new Error('No hardware adapter for phone flame verification')
  if (
    /swiftshader|llvmpipe/i.test(
      `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`,
    )
  )
    throw new Error('Phone flame verification requires a hardware GPU')
  const device = await adapter.requestDevice()
  const width = 375
  const height = 430
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const image = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const imageView = image.createView()
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const renderer = createBenchRenderer(device, 'rgba8unorm')
  const errors: string[] = []
  device.addEventListener('uncapturederror', (event) => {
    event.preventDefault()
    errors.push(event.error.message)
  })
  try {
    renderer.setScene('book')
    const deadline = window.performance.now() + 15000
    while (renderer.stats().book.status === 'loading') {
      if (window.performance.now() > deadline)
        throw new Error('The phone regression model did not finish loading')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (renderer.stats().book.status !== 'ready')
      throw new Error(
        renderer.stats().book.error || 'Phone regression model is not ready',
      )
    const settings = { ...DEFAULT_BENCH_SETTINGS, stars: true }
    const draw = async (palette: 'lagoon' | 'ivory') => {
      renderer.render(imageView, width, height, { ...settings, palette })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture: image },
        { buffer: readback, bytesPerRow },
        [width, height],
      )
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const pixels = new Uint8Array(readback.getMappedRange()).slice()
      readback.unmap()
      return pixels
    }
    const lagoon = await draw('lagoon')
    const ivory = await draw('ivory')
    let changedPixels = 0
    let channelDifference = 0
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = y * bytesPerRow + x * 4
        const difference = Math.max(
          Math.abs(ivory[offset] - lagoon[offset]),
          Math.abs(ivory[offset + 1] - lagoon[offset + 1]),
          Math.abs(ivory[offset + 2] - lagoon[offset + 2]),
        )
        if (difference >= 3) changedPixels++
        channelDifference += difference
      }
    if (errors.length) throw new Error(errors.join('\n'))
    // Only the selected cloud changes palette. Book, rings, sky and partner orb
    // remain identical, so this counts visible flame coverage rather than art.
    if (changedPixels < 150)
      throw new Error(
        `Phone flame disappeared: only ${changedPixels} pixels respond to its palette (${channelDifference} channel difference)`,
      )
    return {
      width,
      height,
      changedPixels,
      channelDifference,
      minChangedPixels: 150,
      samples: renderer.stats().samples,
      selectedFlameVisible: true,
      nativeHeadsetTested: false,
    }
  } finally {
    renderer.dispose()
    readback.destroy()
    image.destroy()
    device.destroy()
  }
}
