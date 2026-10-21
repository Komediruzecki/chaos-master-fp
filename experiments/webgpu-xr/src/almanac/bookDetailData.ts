// Validate the bounded, linear surface bundle before allocating or uploading GPU textures.
export const BOOK_DETAIL_URL =
  '/models/almanac/surfaces/almanac-surfaces-v1.bin'
export const BOOK_DETAIL_BYTES = 4_194_332
export const BOOK_DETAIL_GPU_BYTES = BOOK_DETAIL_BYTES - 32

export interface BookDetailLevel {
  layer: number
  level: number
  width: number
  height: number
  data: Uint8Array<ArrayBuffer>
}

export interface BookDetailData {
  width: number
  height: number
  layers: number
  mipCount: number
  bytes: number
  levels: BookDetailLevel[]
}

export function parseBookDetailData(buffer: ArrayBuffer): BookDetailData {
  if (buffer.byteLength !== BOOK_DETAIL_BYTES)
    throw new Error('The book surface bundle has an unexpected size.')
  const header = new DataView(buffer)
  if (
    new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== 'LMSURF01' ||
    header.getUint32(8, true) !== 512 ||
    header.getUint32(12, true) !== 512 ||
    header.getUint32(16, true) !== 3 ||
    header.getUint32(20, true) !== 10 ||
    header.getUint32(24, true) !== 4 ||
    header.getUint32(28, true) !== BOOK_DETAIL_GPU_BYTES
  )
    throw new Error('The book surface bundle has an unsupported header.')
  const levels: BookDetailLevel[] = []
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

export const EMPTY_BOOK_DETAIL = {
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  error: '',
  downloadBytes: 0,
  textureBytes: 0,
  textureCount: 0,
  uploads: 0,
  mipCount: 0,
}
export type BookDetailSnapshot = typeof EMPTY_BOOK_DETAIL
