// Validate the bounded, linear surface bundle before allocating or uploading GPU textures.
export const SURFACE_DETAIL_BYTES = 4_194_332
export const SURFACE_DETAIL_GPU_BYTES = SURFACE_DETAIL_BYTES - 32

export interface SurfaceLevel {
  layer: number
  level: number
  width: number
  height: number
  data: Uint8Array<ArrayBuffer>
}

export interface SurfaceData {
  width: number
  height: number
  layers: number
  mipCount: number
  bytes: number
  levels: SurfaceLevel[]
}

export function parseSurfaceData(buffer: ArrayBuffer, label = ''): SurfaceData {
  const description = label ? `${label.toLowerCase()} surface` : 'surface'
  if (buffer.byteLength !== SURFACE_DETAIL_BYTES)
    throw new Error(`The ${description} bundle has an unexpected size.`)
  const header = new DataView(buffer)
  if (
    new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== 'LMSURF01' ||
    header.getUint32(8, true) !== 512 ||
    header.getUint32(12, true) !== 512 ||
    header.getUint32(16, true) !== 3 ||
    header.getUint32(20, true) !== 10 ||
    header.getUint32(24, true) !== 4 ||
    header.getUint32(28, true) !== SURFACE_DETAIL_GPU_BYTES
  )
    throw new Error(`The ${description} bundle has an unsupported header.`)
  const levels: SurfaceLevel[] = []
  let offset = 32
  for (let layer = 0; layer < 3; layer++) {
    for (let level = 0; level < 10; level++) {
      const size = 512 >> level
      const length = size * size * 4
      levels.push({
        layer,
        level,
        width: size,
        height: size,
        data: new Uint8Array(buffer, offset, length),
      })
      offset += length
    }
  }
  return {
    width: 512,
    height: 512,
    layers: 3,
    mipCount: 10,
    bytes: buffer.byteLength,
    levels,
  }
}

export const EMPTY_SURFACE_DETAIL = {
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  error: '',
  downloadBytes: 0,
  textureBytes: 0,
  textureCount: 0,
  uploads: 0,
  mipCount: 0,
}
export type SurfaceSnapshot = typeof EMPTY_SURFACE_DETAIL
