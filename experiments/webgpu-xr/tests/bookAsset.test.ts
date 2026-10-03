// Synthetic GLB fixtures exercise export decoding, transform correctness and explicit rejection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBookGlb } from '../src/almanac/bookAsset'

function fixture() {
  const binary = new ArrayBuffer(100)
  const data = new DataView(binary)
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  points.forEach((point, i) => {
    const values = [...point, Math.SQRT1_2, Math.SQRT1_2, 0]
    values.forEach((value, c) => {
      data.setFloat32(16 + i * 24 + c * 4, value, true)
    })
  })
  ;[0, 1, 2].forEach((value, i) => {
    data.setUint16(92 + i * 2, value, true)
  })
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 16, byteLength: 72, byteStride: 24 },
      { buffer: 0, byteOffset: 88, byteLength: 12 },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
      },
      {
        bufferView: 0,
        byteOffset: 12,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
      },
      {
        bufferView: 1,
        byteOffset: 4,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Synthetic paper',
        pbrMetallicRoughness: {
          baseColorFactor: [0.01, 0.02, 0.03, 1],
          metallicFactor: 0.02,
          roughnessFactor: 0.9,
        },
      },
    ],
    nodes: [
      { name: 'Parent', translation: [1, 2, 3], children: [1, 2] },
      { name: 'Mesh', mesh: 0, scale: [2, 1, 0.5] },
      { name: 'OrbDockLeft', translation: [0.1, 0.2, 0.3] },
    ],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
  return {
    document,
    data,
    encode() {
      const text = new TextEncoder().encode(JSON.stringify(document))
      const jsonLength = Math.ceil(text.length / 4) * 4
      const buffer = new ArrayBuffer(
        12 + 8 + jsonLength + 8 + binary.byteLength,
      )
      const output = new DataView(buffer)
      output.setUint32(0, 0x46546c67, true)
      output.setUint32(4, 2, true)
      output.setUint32(8, buffer.byteLength, true)
      output.setUint32(12, jsonLength, true)
      output.setUint32(16, 0x4e4f534a, true)
      new Uint8Array(buffer, 20, jsonLength).fill(32)
      new Uint8Array(buffer, 20, text.length).set(text)
      output.setUint32(20 + jsonLength, binary.byteLength, true)
      output.setUint32(24 + jsonLength, 0x004e4942, true)
      new Uint8Array(buffer, 28 + jsonLength).set(new Uint8Array(binary))
      return buffer
    },
  }
}

await test('interleaved accessors respect buffer and accessor offsets, scene transforms and inverse-transpose normals', () => {
  const asset = parseBookGlb(fixture().encode())
  assert.deepEqual([...asset.indices], [0, 1, 2])
  assert.deepEqual([...asset.vertices.slice(0, 3)], [1, 2, 3])
  assert.deepEqual([...asset.vertices.slice(16, 19)], [3, 2, 3])
  assert.deepEqual([...asset.vertices.slice(32, 35)], [1, 3, 3])
  assert.ok(Math.abs(asset.vertices[4] - 1 / Math.sqrt(5)) < 1e-6)
  assert.ok(Math.abs(asset.vertices[5] - 2 / Math.sqrt(5)) < 1e-6)
  assert.deepEqual(asset.bounds, { min: [1, 2, 3], max: [3, 3, 3] })
  assert.ok(Math.abs(asset.anchors.OrbDockLeft[0] - 1.1) < 1e-6)
  assert.ok(Math.abs(asset.anchors.OrbDockLeft[1] - 2.2) < 1e-6)
  assert.ok(
    Math.abs(asset.vertices[8] - 0.01) < 1e-7,
    'linear glTF material factor remains linear',
  )
  assert.equal(asset.triangles, 1)
})

await test('negative-scale transforms preserve outward triangle winding', () => {
  const source = fixture()
  source.document.nodes[1].scale = [-2, 1, 0.5]
  const asset = parseBookGlb(source.encode())
  assert.deepEqual([...asset.indices], [0, 2, 1])
  assert.ok(asset.vertices[4] < 0)
})

await test('index bounds and byte-stride truncation fail before GPU upload', () => {
  const source = fixture()
  source.data.setUint16(96, 3, true)
  assert.throws(
    () => parseBookGlb(source.encode()),
    /index exceeds vertex bounds/,
  )
  source.data.setUint16(96, 2, true)
  source.document.bufferViews[0].byteLength = 60
  assert.throws(() => parseBookGlb(source.encode()), /buffer bounds/)
})

await test('texture, transparent and unknown extension materials cannot silently lose detail', () => {
  const texture = fixture()
  Object.assign(texture.document.materials[0].pbrMetallicRoughness, {
    baseColorTexture: { index: 0 },
  })
  assert.throws(() => parseBookGlb(texture.encode()), /without textures/)
  const transparent = fixture()
  Object.assign(transparent.document.materials[0], { alphaMode: 'BLEND' })
  assert.throws(() => parseBookGlb(transparent.encode()), /opaque factor/)
  const extension = fixture()
  Object.assign(extension.document.materials[0], {
    extensions: { KHR_materials_transmission: { transmissionFactor: 1 } },
  })
  assert.throws(() => parseBookGlb(extension.encode()), /material extension/)
})

await test('scalar specular extension is preserved in the GPU material data', () => {
  const source = fixture()
  Object.assign(source.document.materials[0], {
    extensions: { KHR_materials_specular: { specularFactor: 0.36 } },
  })
  assert.ok(Math.abs(parseBookGlb(source.encode()).vertices[15] - 0.36) < 1e-6)
})

await test('cycles, singular transforms and malformed binary containers fail explicitly', () => {
  const cyclic = fixture()
  cyclic.document.nodes[0].children = [0]
  assert.throws(() => parseBookGlb(cyclic.encode()), /cyclic/)
  const singular = fixture()
  singular.document.nodes[1].scale = [0, 1, 1]
  assert.throws(() => parseBookGlb(singular.encode()), /node transform/)
  const valid = fixture().encode()
  assert.throws(
    () => parseBookGlb(valid.slice(0, valid.byteLength - 4)),
    /complete glTF/,
  )
})
