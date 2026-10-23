/** Reparse coloured POINTS, inspect byte offsets, and reject corrupt colour/header data. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { createFlameFigurineGlb, validateFlameFigurineGlb, } from './flame-figurine-glb.mjs'

function fixture(
  colors = new Float32Array([
    0.421875, 0.421875, 0.421875, 1, 0.125, 0.25, 0.5, 1,
  ]),
) {
  return createFlameFigurineGlb({
    name: 'Colour fixture',
    positions: new Float32Array([-1, 0, 0.25, 1, 1.8, -0.5]),
    colors,
  })
}

function colourByteOffset(bytes) {
  const { gltf } = validateFlameFigurineGlb(bytes)
  const primitive = gltf.meshes[0].primitives[0]
  const accessor = gltf.accessors[primitive.attributes.COLOR_0]
  return (
    28 +
    bytes.readUInt32LE(12) +
    gltf.bufferViews[accessor.bufferView].byteOffset
  )
}

await test('coloured GLB reparses independent FLOAT32 positions and linear RGBA values', () => {
  const bytes = fixture()
  const checked = validateFlameFigurineGlb(bytes)
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  assert.equal(checked.points, 2)
  assert.equal(checked.coloredPoints, 2)
  assert.equal(checked.triangles, 0)
  const primitive = checked.gltf.meshes[0].primitives[0]
  const position = checked.gltf.accessors[primitive.attributes.POSITION]
  const color = checked.gltf.accessors[primitive.attributes.COLOR_0]
  assert.equal(color.componentType, 5126)
  assert.equal(color.type, 'VEC4')
  assert.equal(color.count, position.count)
  assert.deepEqual(position.min, [-1, 0, -0.5])
  assert.deepEqual(position.max, [1, Math.fround(1.8), 0.25])
  const offset = colourByteOffset(bytes)
  assert.equal(offset % 4, 0)
  assert.equal(bytes.readFloatLE(offset), 0.421875) // Linear neutral .75³, not sRGB encoded.
  assert.equal(bytes.readFloatLE(offset + 16), 0.125)
  assert.equal(bytes.readFloatLE(offset + 28), 1)
  assert.deepEqual(checked.colorBounds, {
    min: [0.125, 0.25, 0.421875, 1],
    max: [0.421875, 0.421875, 0.5, 1],
  })
  assert.deepEqual(
    checked.gltf.materials[0].pbrMetallicRoughness.baseColorFactor,
    [1, 1, 1, 1],
  )
  assert(checked.gltf.extensionsUsed.includes('KHR_materials_unlit'))
})

await test('input validation rejects colour count, range, nonfinite channels, and nonopaque alpha', () => {
  assert.throws(() => fixture(new Float32Array(4)), /colour count/)
  assert.throws(
    () => fixture(new Float32Array([1.1, 0, 0, 1, 0, 0, 0, 1])),
    /channel bounds/,
  )
  assert.throws(
    () => fixture(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1])),
    /channel bounds/,
  )
  assert.throws(
    () => fixture(new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 1])),
    /opaque point alpha/,
  )
})

await test('byte validation rejects altered header lengths and corrupt COLOR_0 channels', () => {
  const wrongLength = fixture()
  wrongLength.writeUInt32LE(wrongLength.length - 4, 8)
  assert.throws(() => validateFlameFigurineGlb(wrongLength), /GLB length/)
  const wrongRange = fixture()
  wrongRange.writeFloatLE(-0.01, colourByteOffset(wrongRange))
  assert.throws(() => validateFlameFigurineGlb(wrongRange), /channel bounds/)
  const wrongAlpha = fixture()
  wrongAlpha.writeFloatLE(0, colourByteOffset(wrongAlpha) + 12)
  assert.throws(
    () => validateFlameFigurineGlb(wrongAlpha),
    /opaque point alpha/,
  )
  const nonfinite = fixture()
  nonfinite.writeFloatLE(Infinity, colourByteOffset(nonfinite))
  assert.throws(
    () => validateFlameFigurineGlb(nonfinite),
    /non-finite accessor/,
  )
  assert.throws(
    () => validateFlameFigurineGlb(Buffer.from(fixture().subarray(0, 28))),
    /GLB length/,
  )
})
