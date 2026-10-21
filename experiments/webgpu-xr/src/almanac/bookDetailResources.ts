// One retained surface texture per renderer, with a neutral fallback and abort-safe replacement.
import { d, tgpu } from 'typegpu'
import { BOOK_DETAIL_BYTES, BOOK_DETAIL_GPU_BYTES, BOOK_DETAIL_URL, EMPTY_BOOK_DETAIL, parseBookDetailData, } from './bookDetailData'
import type { TgpuRoot } from 'typegpu'
import type { BookDetailData } from './bookDetailData'

export const bookDetailLayout = tgpu.bindGroupLayout({
  surfaceMap: { texture: d.texture2dArray(d.f32) },
  surfaceSampler: { sampler: 'filtering' },
})

export function createBookDetailResources(root: TgpuRoot, changed: () => void) {
  const device = root.device
  const sampler = root.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  })
  const snapshot = { ...EMPTY_BOOK_DETAIL }
  let disposed = false
  let request: AbortController | undefined

  function upload(data: BookDetailData) {
    const texture = root
      .createTexture({
        size: [data.width, data.height, data.layers],
        format: 'rgba8unorm',
        mipLevelCount: data.mipCount,
      })
      .$usage('sampled')
    try {
      const raw = root.unwrap(texture)
      for (const mip of data.levels) {
        device.queue.writeTexture(
          { texture: raw, mipLevel: mip.level, origin: [0, 0, mip.layer] },
          mip.data,
          { bytesPerRow: mip.width * 4, rowsPerImage: mip.height },
          [mip.width, mip.height, 1],
        )
      }
      const group = root.createBindGroup(bookDetailLayout, {
        surfaceMap: texture.createView(d.texture2dArray(d.f32)),
        surfaceSampler: sampler,
      })
      // Force allocation and validation now, not in a later render frame.
      root.unwrap(group)
      return { texture, group }
    } catch (error) {
      texture.destroy()
      throw error
    }
  }

  const neutral = new Uint8Array([128, 128, 128, 255])
  let current = upload({
    width: 1,
    height: 1,
    layers: 3,
    mipCount: 1,
    bytes: 12,
    levels: [0, 1, 2].map((layer) => ({
      layer,
      level: 0,
      width: 1,
      height: 1,
      data: neutral,
    })),
  })
  snapshot.textureBytes = 12
  snapshot.textureCount = 1
  snapshot.mipCount = 1

  async function load() {
    if (
      disposed ||
      snapshot.status === 'loading' ||
      snapshot.status === 'ready'
    )
      return
    request?.abort()
    const own = new AbortController()
    request = own
    const stale = () => disposed || request !== own || own.signal.aborted
    snapshot.status = 'loading'
    snapshot.error = ''
    changed()
    let candidate: ReturnType<typeof upload> | undefined
    try {
      const response = await fetch(BOOK_DETAIL_URL, { signal: own.signal })
      if (!response.ok)
        throw new Error(
          `Book surface request failed (HTTP ${response.status}).`,
        )
      const announced = Number(response.headers.get('content-length') ?? 0)
      if (announced > BOOK_DETAIL_BYTES)
        throw new Error('The book surface bundle exceeds its size limit.')
      const data = parseBookDetailData(await response.arrayBuffer())
      if (stale()) return
      device.pushErrorScope('validation')
      let validation: GPUError | null
      try {
        candidate = upload(data)
      } finally {
        validation = await device.popErrorScope()
      }
      if (validation) throw new Error(validation.message)
      if (stale()) return
      const previous = current
      current = candidate
      candidate = undefined
      previous.texture.destroy()
      snapshot.status = 'ready'
      snapshot.downloadBytes = data.bytes
      snapshot.textureBytes = BOOK_DETAIL_GPU_BYTES
      snapshot.mipCount = data.mipCount
      snapshot.uploads++
    } catch (error) {
      if (stale()) return
      snapshot.status = 'error'
      snapshot.error = error instanceof Error ? error.message : String(error)
    } finally {
      candidate?.texture.destroy()
      if (!stale()) changed()
    }
  }

  return {
    get group() {
      return current.group
    },
    load,
    snapshot: () => ({ ...snapshot }),
    dispose() {
      if (disposed) return
      disposed = true
      request?.abort()
      current.texture.destroy()
      snapshot.textureCount = 0
      snapshot.textureBytes = 0
    },
  }
}

export type BookDetailResources = ReturnType<typeof createBookDetailResources>
