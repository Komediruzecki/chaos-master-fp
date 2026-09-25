// Hardware-GPU contracts with synthetic poses/targets; never claims native XR.
import { d } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { advancePoint } from '../src/flameMath'
import { createRenderer } from '../src/renderer'
import { collectXrTargets } from '../src/xrTypes'
import type { GpuXrBinding } from '../src/xrTypes'

export async function verifyGpuContracts() {
  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No test adapter')
  const device = await adapter.requestDevice()
  device.pushErrorScope('validation')
  const renderer = createRenderer(device)
  const size = 256
  const texture = device.createTexture({
    size: [size, size, 2],
    format: 'bgra8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const readback = device.createBuffer({
    size: size * size * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    renderer.prepare('bgra8unorm')
    const before = await renderer.readPoints()
    await renderer.stepForTest()
    const after = await renderer.readPoints()
    if (![...before.flat(), ...after.flat()].every(Number.isFinite))
      throw new Error('GPU samples must be finite before and after compute')
    let maxError = 0
    before.forEach((p, i) => {
      let seed = i + 73129
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      const expected = advancePoint(d.vec4f(p[0], p[1], p[2], p[3]), seed >>> 0)
      const values = [expected.x, expected.y, expected.z, expected.w]
      values.forEach((value, j) => {
        maxError = Math.max(maxError, Math.abs(value - after[i][j]))
      })
    })
    if (maxError > 0.0001)
      throw new Error(
        `GPU step differs from CPU app variation math: ${maxError}`,
      )
    const pose = {
      views: ['left', 'right'].map((eye, i) => {
        const x = (i - 0.5) * 0.063
        return {
          eye,
          projectionMatrix: mat4.perspective(Math.PI / 3, 1, 0.05, 100),
          transform: {
            position: { x, y: 1.6, z: 0 },
            inverse: {
              matrix: mat4.lookAt([x, 1.6, 0], [x, 1.6, -2.5], [0, 1, 0]),
            },
          },
        }
      }),
    } as unknown as XRViewerPose
    const binding: GpuXrBinding = {
      getPreferredColorFormat: () => 'bgra8unorm',
      createProjectionLayer: () => {
        throw new Error('Synthetic harness does not create XR layers')
      },
      getViewSubImage: (_layer, view) => ({
        colorTexture: texture,
        viewport: { x: 0, y: 0, width: size, height: size },
        getViewDescriptor: () => ({
          dimension: '2d',
          baseArrayLayer: view.eye === 'left' ? 0 : 1,
          arrayLayerCount: 1,
        }),
      }),
    }
    const targets = collectXrTargets(binding, {} as XRProjectionLayer, pose)
    const generationBefore = renderer.stats().generation
    renderer.render(targets, 'bgra8unorm', 'compute', 0, true)
    if (renderer.stats().generation !== generationBefore + 1)
      throw new Error('Compute must advance once for both eyes')
    renderer.render(targets, 'bgra8unorm', 'probe', 0, false)
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
      [size, size, 2],
    )
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    const bytes = new Uint8Array(readback.getMappedRange())
    const eyes = [0, 1].map((layer) => {
      let lit = 0
      let xSum = 0
      for (let i = 0; i < size * size; i++) {
        const offset = (layer * size * size + i) * 4
        if (bytes[offset + 1] > 70) {
          lit++
          xSum += i % size
        }
      }
      return { lit, centroidX: xSum / lit }
    })
    if (eyes.some((eye) => eye.lit < 1000))
      throw new Error('One eye texture is empty')
    if (eyes[0].centroidX - eyes[1].centroidX < 2)
      throw new Error('Distinct eye uniforms did not produce parallax')
    readback.unmap()
    const validation = await device.popErrorScope()
    if (validation) throw new Error(validation.message)
    return {
      kind: 'hardware GPU with synthetic XR targets',
      nativeHeadsetTested: false,
      maxParityError: maxError,
      eyes,
      computeOncePerStereoFrame: true,
      format: 'bgra8unorm',
      arrayLayers: 2,
    }
  } finally {
    readback.destroy()
    texture.destroy()
    renderer.dispose()
    device.destroy()
  }
}
