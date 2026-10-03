/** Cached single-sample particle-gel attachments and bind groups with atomic resize rollback. */
import { gummyDisplayLayout } from './gummyShaders'
import { particleCompositeLayout, particleFilterLayout, particleOpaqueLayout, particleProfileSourceLayout, } from './particleGummyShaders'
import { particleNormalSourceLayout, particleSurfaceLayout, } from './particleGummySurfaceShaders'
import type { TgpuRoot } from 'typegpu'

export function createParticleGummyTargets(
  root: TgpuRoot,
  device: GPUDevice,
  width: number,
  height: number,
  sampler: GPUSampler,
) {
  const textures: GPUTexture[] = []
  const texture = (label: string, format: GPUTextureFormat, sampled = true) => {
    const next = device.createTexture({
      label: `Particle gummy ${label}`,
      size: [width, height],
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        (sampled ? GPUTextureUsage.TEXTURE_BINDING : 0),
    })
    textures.push(next)
    return next.createView()
  }
  try {
    const scene = texture('opaque studio', 'rgba16float')
    const sceneDepth = texture('opaque depth', 'depth24plus')
    const original = texture('analytic distance', 'r32float')
    const normal = texture('compact field gradient', 'rgba16float')
    const particleDepth = texture('nearest sphere depth', 'depth24plus', false)
    const horizontal = texture('horizontal distance', 'r32float')
    const filtered = texture('filtered distance', 'r32float')
    const optical = texture('additive optical depth', 'rgba16float')
    const dye = texture('integrated linear dye', 'rgba16float')
    const profileFirst = texture('near density samples', 'rgba16float')
    const profileSecond = texture('far density samples', 'rgba16float')
    const profileFar = texture('deeper density samples', 'rgba16float')
    const surface = texture('compact density surface', 'r32float')
    const final = texture('linear HDR composite', 'rgba16float')
    const opaque = root.createBindGroup(particleOpaqueLayout, {
      depth: sceneDepth,
    })
    const profileSource = root.createBindGroup(particleProfileSourceLayout, {
      original,
    })
    const reconstruction = root.createBindGroup(particleSurfaceLayout, {
      original,
      profileFirst,
      profileSecond,
      profileFar,
    })
    const filteredNormal = root.createBindGroup(particleNormalSourceLayout, {
      surface: filtered,
    })
    const rawNormal = root.createBindGroup(particleNormalSourceLayout, {
      surface,
    })
    const horizontalFilter = root.createBindGroup(particleFilterLayout, {
      original: surface,
      source: surface,
    })
    const verticalFilter = root.createBindGroup(particleFilterLayout, {
      original: surface,
      source: horizontal,
    })
    const refinementFilter = root.createBindGroup(particleFilterLayout, {
      original: surface,
      source: filtered,
    })
    const composite = root.createBindGroup(particleCompositeLayout, {
      depth: filtered,
      original: surface,
      normal,
      optical,
      dye,
      scene,
      sceneDepth,
      sampler,
    })
    const rawComposite = root.createBindGroup(particleCompositeLayout, {
      depth: surface,
      original: surface,
      normal,
      optical,
      dye,
      scene,
      sceneDepth,
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
      original,
      normal,
      particleDepth,
      horizontal,
      filtered,
      optical,
      dye,
      profileFirst,
      profileSecond,
      profileFar,
      surface,
      final,
      opaque,
      profileSource,
      reconstruction,
      filteredNormal,
      rawNormal,
      horizontalFilter,
      verticalFilter,
      refinementFilter,
      composite,
      rawComposite,
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
