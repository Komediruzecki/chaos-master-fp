/**
 * Minimal PNG encoder using Deno's CompressionStream for deflate.
 * Encodes RGBA pixel data into a valid PNG file.
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

// CRC32 lookup table
const crcTable: number[] = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable.push(c)
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const length = data.length
  const buf = new ArrayBuffer(12 + length)
  const view = new DataView(buf)
  const out = new Uint8Array(buf)

  view.setUint32(0, length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  const crc = crc32(out.slice(4, 8 + length))
  view.setUint32(8 + length, crc)
  return out
}

function ihdrChunk(width: number, height: number): Uint8Array {
  const data = new ArrayBuffer(13)
  const view = new DataView(data)
  view.setUint32(0, width)
  view.setUint32(4, height)
  view.setUint8(8, 8) // bit depth
  view.setUint8(9, 6) // color type: RGBA
  view.setUint8(10, 0) // compression
  view.setUint8(11, 0) // filter
  view.setUint8(12, 0) // interlace
  return chunk('IHDR', new Uint8Array(data))
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()

  void writer.write(data.buffer as ArrayBuffer)
  void writer.close()

  const chunks: Uint8Array[] = []
  let totalLen = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLen += value.length
  }

  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const c of chunks) {
    result.set(c, offset)
    offset += c.length
  }
  return result
}

export async function encodePNG(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  // Apply PNG filter (none — byte 0 before each row)
  const rowLen = 1 + width * 4
  const rawData = new Uint8Array(height * rowLen)
  for (let y = 0; y < height; y++) {
    rawData[y * rowLen] = 0 // filter type: none
    const srcStart = y * width * 4
    const dstStart = y * rowLen + 1
    for (let x = 0; x < width * 4; x++) {
      rawData[dstStart + x] = pixels[srcStart + x]!
    }
  }

  const compressed = await deflate(rawData)
  const idat = chunk('IDAT', compressed)

  const result = new Uint8Array(
    PNG_SIGNATURE.length + 25 + idat.length + 12, // 25 = IHDR chunk, 12 = IEND chunk
  )
  let offset = 0
  result.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  const ihdr = ihdrChunk(width, height)
  result.set(ihdr, offset)
  offset += ihdr.length
  result.set(idat, offset)
  offset += idat.length
  result.set(chunk('IEND', new Uint8Array(0)), offset)

  return result
}
