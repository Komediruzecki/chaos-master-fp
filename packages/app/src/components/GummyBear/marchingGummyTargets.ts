/** Owned and cached front/nearest-exit attachments for the marching-cubes gummy comparison. */
import { gummyDisplayLayout } from './gummyShaders'
import { marchingGummyCompositeLayout, marchingGummyFrontLayout, marchingGummyOpaqueLayout, } from './marchingGummyRenderShaders'
import type { TgpuRoot } from 'typegpu'

export function createMarchingGummyTargets(
  root: TgpuRoot,
  device: GPUDevice,
  width: number,
  height: number,
  sampler: GPUSampler,
) {
  const textures: GPUTexture[] = []
  const texture = (label: string, format: GPUTextureFormat) => {
    const result = device.createTexture({
      label: `Marching gummy ${label}`,
      size: [width, height],
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    textures.push(result)
    return result.createView()
  }
  try {
    const scene = texture('studio', 'rgba16float')
    const sceneDepth = texture('studio depth', 'depth24plus')
    const front = texture('front normal and distance', 'rgba16float')
    const rest = texture('front dye coordinates', 'rgba16float')
    const frontDepth = texture('front depth', 'depth24plus')
    const exit = texture('nearest exit dye and distance', 'rgba16float')
    const exitDepth = texture('nearest exit depth', 'depth24plus')
    const final = texture('HDR composite', 'rgba16float')
    const opaque = root.createBindGroup(marchingGummyOpaqueLayout, {
      depth: sceneDepth,
    })
    const frontSource = root.createBindGroup(marchingGummyFrontLayout, {
      front,
    })
    const composite = root.createBindGroup(marchingGummyCompositeLayout, {
      front,
      rest,
      exit,
      scene,
      sampler,
    })
    const display = root.createBindGroup(gummyDisplayLayout, {
      scene: final,
      sampler,
    })
    let disposed = false
    return {
      scene,
      sceneDepth,
      front,
      rest,
      frontDepth,
      exit,
      exitDepth,
      final,
      opaque,
      frontSource,
      composite,
      display,
      destroy() {
        if (disposed) return
        disposed = true
        for (const item of textures) item.destroy()
      },
    }
  } catch (error) {
    for (const item of textures) item.destroy()
    throw error
  }
}
