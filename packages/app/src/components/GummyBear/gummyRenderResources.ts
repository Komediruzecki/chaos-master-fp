/** Scene-owned light and HDR targets survive geometry replacement after a tear. */
import { gummyFloorLayout } from './gummyShaders'
import { createGummyTargets } from './gummyTargets'
import type { TgpuRoot } from 'typegpu'

export type GummyRenderResources = ReturnType<typeof createGummyRenderResources>

/** One owner per canvas; renderers borrow this across atomic topology replacements. */
export function createGummyRenderResources(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
) {
  if (root.device !== device)
    throw new Error('Gummy render resources root and device must match')
  const sampler = device.createSampler({
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const light = device.createTexture({
    label: 'Gummy projected light',
    size: [512, 512],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  try {
    const lightView = light.createView()
    const floorGroup = root.createBindGroup(gummyFloorLayout, {
      light: lightView,
      sampler,
    })
    let targets: ReturnType<typeof createGummyTargets> | undefined
    let key = ''
    let disposed = false
    return {
      lightView,
      floorGroup,
      assertCompatible(
        nextRoot: TgpuRoot,
        nextDevice: GPUDevice,
        nextContext: GPUCanvasContext,
        nextFormat: GPUTextureFormat,
      ) {
        if (disposed) throw new Error('Gummy render resources were destroyed')
        if (
          nextRoot !== root ||
          nextDevice !== device ||
          nextContext !== context ||
          nextFormat !== format
        )
          throw new Error('Gummy render resources belong to another canvas')
      },
      targets(width: number, height: number, runtimeFracture: boolean) {
        if (disposed) throw new Error('Gummy render resources were destroyed')
        const nextKey = `${width}:${height}:${runtimeFracture}`
        if (key !== nextKey) {
          const next = createGummyTargets(
            root,
            device,
            width,
            height,
            sampler,
            runtimeFracture,
          )
          targets?.destroy()
          targets = next
          key = nextKey
        }
        return targets!
      },
      destroy() {
        if (disposed) return
        disposed = true
        targets?.destroy()
        light.destroy()
      },
    }
  } catch (error) {
    light.destroy()
    throw error
  }
}
