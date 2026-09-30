// Read real framebuffer pixels to verify opaque depth ordering in the desktop bench.
import { createBenchRenderer } from '../src/bench/renderer'
import { DEFAULT_BENCH_SETTINGS } from '../src/bench/settings'
import type { BenchSettings } from '../src/bench/settings'

export async function verifyBenchGpuContracts() {
  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No hardware adapter for the depth test')
  const device = await adapter.requestDevice()
  const size = 512
  const texture = device.createTexture({
    size: [size, size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const view = texture.createView()
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  let renderer: ReturnType<typeof createBenchRenderer> | undefined
  device.pushErrorScope('validation')
  try {
    renderer = createBenchRenderer(device, 'rgba8unorm')
    const settings: BenchSettings = {
      ...DEFAULT_BENCH_SETTINGS,
      recipe: 0,
      pointCount: 32768,
      exposure: 1.4,
      pointSize: 0.004,
      source: 'compute',
      rings: false,
      stars: false,
    }
    const draw = async (patch: Partial<BenchSettings>) => {
      renderer!.render(view, size, size, { ...settings, ...patch })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readback, bytesPerRow: size * 4 },
        [size, size],
      )
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(readback.getMappedRange()).slice()
      readback.unmap()
      return bytes
    }
    const front = await draw({ depthProbe: 'front' })
    const generation = renderer.stats().generation
    const through = await draw({ depthProbe: 'through' })
    const behind = await draw({ depthProbe: 'behind' })
    const unoccluded = await draw({ depthProbe: 'off' })
    const sums = { front: 0, through: 0, behind: 0 }
    let revealedByBehind = 0
    let revealedByThrough = 0
    let stillOccludedByThrough = 0
    let cloudPixels = 0
    // This strip lies inside the bar at every distance. Restricting the extent
    // prevents perspective changes in the bar's silhouette passing the test.
    for (let y = size / 2 - 90; y < size / 2 + 90; y++) {
      for (let x = size / 2 - 1; x <= size / 2; x++) {
        const offset = (y * size + x) * 4
        const light = (pixels: Uint8Array) =>
          pixels[offset] + pixels[offset + 1] + pixels[offset + 2]
        const f = light(front)
        const t = light(through)
        const b = light(behind)
        sums.front += f
        sums.through += t
        sums.behind += b
        if (light(unoccluded) > 80) cloudPixels++
        if (b - f > 12) revealedByBehind++
        if (t - f > 12) revealedByThrough++
        if (b - t > 12) stillOccludedByThrough++
      }
    }
    if (cloudPixels < 30)
      throw new Error(
        `Depth strip did not contain enough flame pixels: ${cloudPixels}`,
      )
    if (
      revealedByBehind < 30 ||
      revealedByThrough < 12 ||
      stillOccludedByThrough < 12
    )
      throw new Error(
        `Opaque depth ordering failed: ${JSON.stringify({ revealedByBehind, revealedByThrough, stillOccludedByThrough, sums })}`,
      )
    const side = await draw({ depthProbe: 'off', yaw: 90 })
    let changedPixels = 0
    for (let i = 0; i < side.length; i += 4) {
      if (
        Math.abs(side[i] - unoccluded[i]) +
          Math.abs(side[i + 1] - unoccluded[i + 1]) +
          Math.abs(side[i + 2] - unoccluded[i + 2]) >
        12
      )
        changedPixels++
    }
    if (changedPixels < 1000)
      throw new Error(
        'Side inspection did not change enough actual rendered pixels',
      )
    if (renderer.stats().generation !== generation)
      throw new Error('Depth or camera inspection regenerated the cloud')
    const validation = await device.popErrorScope()
    if (validation) throw new Error(validation.message)
    return {
      kind: 'desktop hardware framebuffer readback',
      nativeHeadsetTested: false,
      format: 'rgba8unorm',
      size,
      centralStripPixels: 360,
      cloudPixels,
      revealedByBehind,
      revealedByThrough,
      stillOccludedByThrough,
      luminanceSums: sums,
      sideViewChangedPixels: changedPixels,
      presentationPreservesGeneration: true,
    }
  } finally {
    readback.destroy()
    texture.destroy()
    renderer?.dispose()
    device.destroy()
  }
}
