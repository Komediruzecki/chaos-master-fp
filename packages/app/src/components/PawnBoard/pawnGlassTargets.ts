/** Sized glass frame attachments and cached sampled bindings, destroyed together on resize. */
import { displayLayout, glassSceneLayout } from './pawnBoardShaders'
import type { TgpuRoot } from 'typegpu'

export function createPawnGlassTargets(
  root: TgpuRoot,
  device: GPUDevice,
  width: number,
  height: number,
  sampler: GPUSampler,
) {
  const textures: GPUTexture[] = []
  const texture = (
    format: GPUTextureFormat,
    sampleCount = 1,
    sampled = false,
  ) => {
    const next = device.createTexture({
      label: `Pawn glass ${format}/${sampleCount}`,
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
    const exitDepth = texture('depth24plus')
    const glass = root.createBindGroup(glassSceneLayout, {
      scene,
      exits,
      sampler,
    })
    const display = root.createBindGroup(displayLayout, {
      scene: final,
      sampler,
    })
    return {
      multisample,
      depth,
      scene,
      final,
      exits,
      exitDepth,
      glass,
      display,
      destroy() {
        for (const item of textures) item.destroy()
      },
    }
  } catch (error) {
    for (const item of textures) item.destroy()
    throw error
  }
}
