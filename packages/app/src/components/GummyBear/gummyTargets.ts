/** Cached HDR gummy frame targets with atomic resize allocation and complete rollback. */
import { gummyDisplayLayout, gummyExitFilterLayout, gummySceneLayout, } from './gummyShaders'
import type { TgpuRoot } from 'typegpu'

export function createGummyTargets(
  root: TgpuRoot,
  device: GPUDevice,
  width: number,
  height: number,
  sampler: GPUSampler,
  runtimeFracture = false,
) {
  const textures: GPUTexture[] = []
  const texture = (
    format: GPUTextureFormat,
    sampleCount = 1,
    sampled = false,
  ) => {
    const next = device.createTexture({
      label: `Gummy ${format}/${sampleCount}`,
      size: [width, height],
      format,
      sampleCount,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        (sampled ? GPUTextureUsage.TEXTURE_BINDING : 0),
    })
    textures.push(next)
    return next.createView()
  }
  try {
    const multisample = texture('rgba16float', 4)
    const depth = texture('depth24plus', 4)
    const scene = texture('rgba16float', 1, true)
    const final = texture('rgba16float', 1, true)
    const exits = texture('rgba16float', 1, true)
    const restExits = texture('rgba16float', 1, true)
    const exitDepth = texture('depth24plus')
    const fronts = runtimeFracture ? texture('rg16float', 1, true) : undefined
    const exitFilter = fronts
      ? root.createBindGroup(gummyExitFilterLayout, { fronts })
      : undefined
    const optical = root.createBindGroup(gummySceneLayout, {
      scene,
      exits,
      restExits,
      sampler,
    })
    const display = root.createBindGroup(gummyDisplayLayout, {
      scene: final,
      sampler,
    })
    let disposed = false
    return {
      multisample,
      depth,
      scene,
      final,
      exits,
      restExits,
      exitDepth,
      fronts,
      exitFilter,
      optical,
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
