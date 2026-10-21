// Shipping surface fields retain linear mips, periodic borders and exact provenance.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../public/models/almanac/surfaces/', import.meta.url)
const bundle = readFileSync(new URL('almanac-surfaces-v1.bin', root))
const manifest = JSON.parse(
  readFileSync(new URL('manifest.json', root), 'utf8'),
) as {
  bytes: number
  payloadBytes: number
  sha256: string
  generatorSha256: string
  layers: {
    name: string
    index: number
    mips: {
      level: number
      width: number
      height: number
      offset: number
      bytes: number
    }[]
  }[]
}

await test('shipping surface bundle matches its authored source and complete mip inventory', () => {
  assert.equal(bundle.subarray(0, 8).toString(), 'LMSURF01')
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => bundle.readUInt32LE(8 + index * 4)),
    [512, 512, 3, 10, 4, 4194300],
  )
  assert.equal(bundle.length, 4194332)
  assert.equal(bundle.length, manifest.bytes)
  assert.equal(bundle.length - 32, manifest.payloadBytes)
  assert.equal(
    createHash('sha256').update(bundle).digest('hex'),
    manifest.sha256,
  )
  const recipe = readFileSync(
    new URL('../assets-source/almanac/build_surfaces.py', import.meta.url),
  )
  assert.equal(
    createHash('sha256').update(recipe).digest('hex'),
    manifest.generatorSha256,
  )
  assert.deepEqual(
    manifest.layers.map(({ name }) => name),
    ['paper', 'leather', 'metal'],
  )
  let cursor = 32
  for (const [layerIndex, layer] of manifest.layers.entries()) {
    assert.equal(layer.index, layerIndex)
    assert.equal(layer.mips.length, 10)
    for (const [index, mip] of layer.mips.entries()) {
      assert.equal(mip.level, index)
      assert.equal(mip.width, 512 >> index)
      assert.equal(mip.height, mip.width)
      assert.equal(mip.bytes, mip.width * mip.height * 4)
      assert.equal(mip.offset, cursor)
      cursor += mip.bytes
    }
  }
  assert.equal(cursor, bundle.length)
})

await test('every shipped mip is a linear area average and reserved alpha is opaque', () => {
  for (const layer of manifest.layers) {
    for (const [level, mip] of layer.mips.entries()) {
      for (let pixel = 0; pixel < mip.bytes; pixel += 4) {
        assert.equal(bundle[mip.offset + pixel + 3], 255)
      }
      if (level === 0) continue
      const prior = layer.mips[level - 1]
      for (let y = 0; y < mip.height; y++) {
        for (let x = 0; x < mip.width; x++) {
          for (let channel = 0; channel < 3; channel++) {
            const address =
              prior.offset + (y * 2 * prior.width + x * 2) * 4 + channel
            const sum =
              bundle[address] +
              bundle[address + 4] +
              bundle[address + prior.width * 4] +
              bundle[address + prior.width * 4 + 4]
            assert.equal(
              bundle[mip.offset + (y * mip.width + x) * 4 + channel],
              Math.floor((sum + 2) / 4),
            )
          }
        }
      }
    }
  }
})

await test('surface edges repeat without a seam spike and metal brushing stays directional', () => {
  const gradients: number[][] = []
  for (const layer of manifest.layers) {
    const mip = layer.mips[0]
    const sample = (x: number, y: number, channel: number) =>
      bundle[mip.offset + ((y % 512) * 512 + (x % 512)) * 4 + channel]
    const layerGradient: number[] = []
    for (let channel = 0; channel < 3; channel++) {
      let dx = 0,
        dy = 0,
        edgeX = 0,
        edgeY = 0,
        sum = 0,
        squares = 0
      for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
          const value = sample(x, y, channel)
          const stepX = Math.abs(value - sample(x + 1, y, channel))
          const stepY = Math.abs(value - sample(x, y + 1, channel))
          if (x === 511) edgeX += stepX
          else dx += stepX
          if (y === 511) edgeY += stepY
          else dy += stepY
          sum += value
          squares += value * value
        }
      }
      const averageX = dx / (512 * 511)
      const averageY = dy / (512 * 511)
      assert.ok(
        edgeX / 512 < averageX * 1.5 + 0.1,
        `${layer.name} channel${channel} x seam`,
      )
      assert.ok(
        edgeY / 512 < averageY * 1.5 + 0.1,
        `${layer.name} channel${channel} y seam`,
      )
      const mean = sum / 512 ** 2
      assert.ok(
        mean > 120 && mean < 135,
        `${layer.name} channel${channel} centered`,
      )
      assert.ok(
        squares / 512 ** 2 - mean ** 2 > 3,
        `${layer.name} channel${channel} has detail`,
      )
      if (channel === 0) layerGradient.push(averageX, averageY)
    }
    gradients.push(layerGradient)
  }
  assert.ok(
    gradients[2][1] > gradients[2][0] * 10,
    'metal brush follows texture U',
  )
  assert.ok(
    Math.abs(gradients[0][0] - gradients[0][1]) < 1,
    'paper has no dominant grid direction',
  )
})
