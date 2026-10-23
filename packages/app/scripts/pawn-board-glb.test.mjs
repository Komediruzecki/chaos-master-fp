/** Export format tests fail on damaged lengths, views, accessor bounds, and non-finite values. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import { boxVertices, createGlbBuilder, validatePawnBoardGlb, } from './pawn-board-glb.mjs'

function fixture() {
  const builder = createGlbBuilder('Test mesh')
  builder.texture('orm')
  builder.gltf.materials.push({
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.3 },
  })
  builder.primitive({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    material: 0,
  })
  return builder.finish()
}

function changeJson(glb, mutate) {
  const length = glb.readUInt32LE(12)
  const parsed = JSON.parse(glb.subarray(20, 20 + length).toString())
  mutate(parsed)
  const json = Buffer.from(JSON.stringify(parsed))
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ])
  const tail = glb.subarray(20 + length)
  const result = Buffer.concat([glb.subarray(0, 20), padded, tail])
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(padded.length, 12)
  return result
}

await test('reads its serialized GLB with embedded texture and exact position bounds', () => {
  const report = validatePawnBoardGlb(fixture())
  assert.equal(report.triangles, 1)
  assert.equal(report.points, 0)
  assert.equal(report.textures, 1)
  assert.deepEqual(report.gltf.accessors[0].max, [1, 1, 0])
})

await test('refuses malformed header lengths, bufferViews, or declared accessor bounds', () => {
  const badLength = Buffer.from(fixture())
  badLength.writeUInt32LE(24, 8)
  assert.throws(() => validatePawnBoardGlb(badLength), /GLB length/)
  assert.throws(
    () =>
      validatePawnBoardGlb(
        changeJson(fixture(), (json) => {
          json.bufferViews[1].byteOffset = 1_000_000
        }),
      ),
    /bufferView bounds/,
  )
  assert.throws(
    () =>
      validatePawnBoardGlb(
        changeJson(fixture(), (json) => {
          json.accessors[0].max[0] = 2
        }),
      ),
    /declared bound/,
  )
})

await test('rejects non-finite decoded positions rather than validating metadata alone', () => {
  const glb = fixture()
  const parsed = validatePawnBoardGlb(glb)
  const positionView =
    parsed.gltf.bufferViews[parsed.gltf.accessors[0].bufferView]
  glb.writeFloatLE(
    Number.NaN,
    20 + glb.readUInt32LE(12) + 8 + positionView.byteOffset,
  )
  assert.throws(() => validatePawnBoardGlb(glb), /non-finite accessor/)
})

await test('authors cuboid triangles with outward winding matching their normals', () => {
  const vertices = boxVertices(2, 4, 6, [0, 0, 0])
  assert.equal(vertices.length, 36 * 8)
  for (let n = 0; n < vertices.length; n += 24) {
    const a = vertices.slice(n, n + 3),
      b = vertices.slice(n + 8, n + 11),
      c = vertices.slice(n + 16, n + 19)
    const ab = b.map((value, axis) => value - a[axis]),
      ac = c.map((value, axis) => value - a[axis])
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    assert(
      cross.reduce(
        (sum, value, axis) => sum + value * vertices[n + 3 + axis],
        0,
      ) > 0,
    )
  }
})
