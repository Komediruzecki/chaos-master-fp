// Direct render test — runs the GPU renderer and captures all logs/errors.

import { renderFlameGPU } from './src/render.ts'

const flame = {
  version: '1.0',
  transforms: {
    t0: {
      variations: { v0: { type: 'linearVar', weight: 1 } },
      probability: 1,
      color: { x: 0.5, y: 0.5 },
      visible: true,
      colorSpeed: 0.4,
    },
  },
  renderSettings: {
    skipIters: 20,
    drawMode: 'paint',
    pointInitMode: 'pointInitSquare',
    colorInitMode: 'colorInitPosition',
    gamma: 2.2,
    exposure: 1.0,
  },
}

console.log('[test] Starting render...')
try {
  // Let's intercept the adapter/device creation to listen for errors
  const originalRequestAdapter = navigator.gpu.requestAdapter.bind(
    navigator.gpu,
  )
  navigator.gpu.requestAdapter = async (options) => {
    const adapter = await originalRequestAdapter(options)
    if (adapter) {
      const originalRequestDevice = adapter.requestDevice.bind(adapter)
      adapter.requestDevice = async (deviceOptions) => {
        const device = await originalRequestDevice(deviceOptions)
        if (device) {
          device.pushErrorScope('validation')
          device.pushErrorScope('out-of-memory')
          device.pushErrorScope('internal')

          // Patch createShaderModule to log shader source
          const originalCreateShaderModule =
            device.createShaderModule.bind(device)
          device.createShaderModule = (descriptor) => {
            console.log(
              `[WebGPU Shader] Creating shader: ${descriptor.label || '<unnamed>'}`,
            )
            return originalCreateShaderModule(descriptor)
          }

          // Patch submit to check errors
          const originalSubmit = device.queue.submit.bind(device.queue)
          device.queue.submit = (commandBuffers) => {
            originalSubmit(commandBuffers)
            // Retrieve errors asynchronously
            device.popErrorScope().then((err) => {
              if (err) console.error('[WebGPU Internal Error]', err.message)
            })
            device.popErrorScope().then((err) => {
              if (err) console.error('[WebGPU OOM Error]', err.message)
            })
            device.popErrorScope().then((err) => {
              if (err) console.error('[WebGPU Validation Error]', err.message)
            })

            // Push again for the next batch/submit
            device.pushErrorScope('validation')
            device.pushErrorScope('out-of-memory')
            device.pushErrorScope('internal')
          }
        }
        return device
      }
    }
    return adapter
  }

  const result = await renderFlameGPU(flame as any, {
    width: 128,
    height: 128,
    quality: 0.5,
  })
  console.log(
    `[test] Render complete: ${result.width}x${result.height}, pixels=${result.pixels.length} bytes`,
  )

  // Check if pixels are all the same
  const firstPixel = result.pixels.slice(0, 4)
  let minR = 255,
    maxR = 0,
    minG = 255,
    maxG = 0,
    minB = 255,
    maxB = 0
  let nonZeroPixels = 0
  for (let i = 0; i < result.pixels.length; i += 4) {
    const r = result.pixels[i]!
    const g = result.pixels[i + 1]!
    const b = result.pixels[i + 2]!
    if (r !== 0 || g !== 0 || b !== 0) nonZeroPixels++
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (g < minG) minG = g
    if (g > maxG) maxG = g
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }
  console.log(`[test] First pixel RGBA: [${firstPixel.join(', ')}]`)
  console.log(
    `[test] Non-zero pixels: ${nonZeroPixels} / ${result.pixels.length / 4}`,
  )
  console.log(`[test] R range: ${minR}-${maxR}`)
  console.log(`[test] G range: ${minG}-${maxG}`)
  console.log(`[test] B range: ${minB}-${maxB}`)
} catch (err) {
  console.error('[test] Render failed:', err)
}
