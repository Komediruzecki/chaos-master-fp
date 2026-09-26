// Hardware-GPU contracts with synthetic poses/targets; never claims native XR.
import { mat4 } from 'wgpu-matrix'
import { createRenderer } from '../src/renderer'
import { POINT_COUNT } from '../src/sampling'
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
    const empty = await renderer.readPoints(POINT_COUNT)
    if (!empty.flat().every((value) => value === 0))
      throw new Error('GPU output must start empty, not as a CPU cloud upload')
    await renderer.rebuildForTest()
    const after = await renderer.readPoints(POINT_COUNT)
    const cached = await renderer.readPoints(POINT_COUNT, 'cached')
    if (![...cached.flat(), ...after.flat()].every(Number.isFinite))
      throw new Error('Every cached and GPU sample must be finite')
    if (!after.some((point) => Math.hypot(...point.slice(0, 3)) > 0.1))
      throw new Error('Compute must construct the cloud from the empty output')
    let maxError = 0
    cached.forEach((p, i) => {
      p.forEach((value, j) => {
        maxError = Math.max(maxError, Math.abs(value - after[i][j]))
      })
    })
    if (maxError > 0.0001)
      throw new Error(
        `GPU cloud differs from CPU app variation math: ${maxError}`,
      )
    await renderer.rebuildForTest()
    const repeated = await renderer.readPoints(POINT_COUNT)
    if (JSON.stringify(after) !== JSON.stringify(repeated))
      throw new Error(
        'Identical flame settings must rebuild identical GPU samples',
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

    async function readFrame() {
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
        [size, size, 2],
      )
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(readback.getMappedRange()).slice()
      readback.unmap()
      return bytes
    }
    const generationBefore = renderer.stats().generation
    renderer.requestRebuild()
    renderer.render(targets, 'bgra8unorm', 'compute', 0)
    if (renderer.stats().generation !== generationBefore + 1)
      throw new Error('A requested rebuild must run once for both eyes')
    const gpuFrame = await readFrame()
    renderer.render(targets, 'bgra8unorm', 'cached', 0)
    const cachedFrame = await readFrame()
    let pixelChannelError = 0
    let changedChannels = 0
    gpuFrame.forEach((value, i) => {
      const difference = Math.abs(value - cachedFrame[i])
      pixelChannelError += difference
      if (difference > 1) changedChannels++
    })
    const meanPixelError = pixelChannelError / gpuFrame.length
    const changedChannelFraction = changedChannels / gpuFrame.length
    if (meanPixelError > 0.1 || changedChannelFraction > 0.005)
      throw new Error(
        `Cached/GPU images disagree: ${meanPixelError}, ${changedChannelFraction}`,
      )
    // Neither a changed orientation nor another eye redraw needs new samples.
    for (let frame = 1; frame <= 30; frame++)
      renderer.render(targets, 'bgra8unorm', 'compute', frame / 10)
    if (renderer.stats().generation !== generationBefore + 1)
      throw new Error('Rotation must reuse the built cloud')
    if (
      JSON.stringify(after) !==
      JSON.stringify(await renderer.readPoints(POINT_COUNT))
    )
      throw new Error('Rendering moved stable samples')

    // A music frame is a pure view of the rest cloud, shared by both eyes.
    // Advancing audio, pausing it, or choosing the CPU cloud must never drift it.
    const music = { time: 12.5, energy: 0.7, low: 0.8, mid: 0.45, high: 0.6 }
    const silentMusic = { time: 12.5, energy: 0, low: 0, mid: 0, high: 0 }
    const musicGeneration = renderer.stats().generation
    renderer.render(targets, 'bgra8unorm', 'compute', 0, music, 0.65)
    const musicGpuFrame = await readFrame()
    renderer.render(targets, 'bgra8unorm', 'cached', 0, music, 0.65)
    const musicCachedFrame = await readFrame()
    const musicEyes = [0, 1].map((layer) => {
      let totalDifference = 0
      let changedChannels = 0
      let reactivePixels = 0
      const start = layer * size * size * 4
      const end = start + size * size * 4
      for (let i = start; i < end; i += 4) {
        let pixelReacted = false
        for (let channel = 0; channel < 4; channel++) {
          const offset = i + channel
          const difference = Math.abs(
            musicGpuFrame[offset] - musicCachedFrame[offset],
          )
          totalDifference += difference
          if (difference > 1) changedChannels++
          if (Math.abs(musicGpuFrame[offset] - gpuFrame[offset]) > 2)
            pixelReacted = true
        }
        if (pixelReacted) reactivePixels++
      }
      const meanPixelChannelError = totalDifference / (end - start)
      const changedPixelChannelFraction = changedChannels / (end - start)
      if (meanPixelChannelError > 0.1 || changedPixelChannelFraction > 0.005)
        throw new Error(
          `Music cached/GPU images disagree in eye ${layer}: ${meanPixelChannelError}, ${changedPixelChannelFraction}`,
        )
      if (reactivePixels < 50)
        throw new Error(`Music must visibly change the flame in eye ${layer}`)
      return {
        meanPixelChannelError,
        changedPixelChannelFraction,
        reactivePixels,
      }
    })
    renderer.render(targets, 'bgra8unorm', 'compute', 0, music, 0)
    const stationaryFrame = await readFrame()
    if (gpuFrame.some((value, i) => value !== stationaryFrame[i]))
      throw new Error('Zero music strength must preserve the exact silent view')
    renderer.render(targets, 'bgra8unorm', 'compute', 0, silentMusic, 0.65)
    const silentFrame = await readFrame()
    if (gpuFrame.some((value, i) => value !== silentFrame[i]))
      throw new Error('Silent audio must stay still regardless of audio time')
    for (let frame = 1; frame <= 30; frame++)
      renderer.render(
        targets,
        'bgra8unorm',
        'compute',
        0,
        { ...music, time: music.time + frame / 10 },
        0.65,
      )
    renderer.render(targets, 'bgra8unorm', 'compute', 0, music, 0.65)
    const repeatedMusicFrame = await readFrame()
    if (musicGpuFrame.some((value, i) => value !== repeatedMusicFrame[i]))
      throw new Error('Replaying a frozen music frame must render exact pixels')
    renderer.render(targets, 'bgra8unorm', 'cached', 0, music, 0.65)
    const repeatedCachedMusicFrame = await readFrame()
    if (
      musicCachedFrame.some((value, i) => value !== repeatedCachedMusicFrame[i])
    )
      throw new Error('Cached music frames must also replay without drift')
    if (renderer.stats().generation !== musicGeneration)
      throw new Error('Music rendering must reuse the built cloud')
    if (
      JSON.stringify(after) !==
        JSON.stringify(await renderer.readPoints(POINT_COUNT)) ||
      JSON.stringify(cached) !==
        JSON.stringify(await renderer.readPoints(POINT_COUNT, 'cached'))
    )
      throw new Error('Music rendering changed immutable rest samples')
    renderer.requestRebuild()
    renderer.render(targets, 'bgra8unorm', 'compute', 0)
    const rebuiltFrame = await readFrame()
    if (gpuFrame.some((value, i) => value !== rebuiltFrame[i]))
      throw new Error(
        'The same GPU flame/cameras must render identical pixels after rebuild',
      )
    renderer.render(targets, 'bgra8unorm', 'probe', 0)
    const bytes = await readFrame()
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
    const validation = await device.popErrorScope()
    if (validation) throw new Error(validation.message)
    return {
      kind: 'hardware GPU with synthetic XR targets',
      nativeHeadsetTested: false,
      comparedPoints: POINT_COUNT,
      maxParityError: maxError,
      meanPixelChannelError: meanPixelError,
      changedPixelChannelFraction: changedChannelFraction,
      repeatBuildExact: true,
      stableAcross30RotatingFrames: true,
      music: {
        eyes: musicEyes,
        frozenFrameReplaysExactly: true,
        zeroStrengthMatchesSilenceExactly: true,
        zeroEnvelopesIgnoreAudioTime: true,
        restSamplesUnchanged: true,
        noCloudRegeneration: true,
      },
      eyes,
      computeOncePerRequestedStereoBuild: true,
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
