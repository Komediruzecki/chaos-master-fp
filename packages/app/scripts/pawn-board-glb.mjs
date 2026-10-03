/** Minimal self-contained GLB/PNG authoring and strict checks for pawn-board exports. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, bytes) {
  const name = Buffer.from(type)
  const chunk = Buffer.alloc(bytes.length + 12)
  chunk.writeUInt32BE(bytes.length)
  name.copy(chunk, 4)
  bytes.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8)
  return chunk
}

/** Small authored linear roughness/metallic and tangent-space normal microtextures. */
export function microtexturePng(kind, size = 128) {
  const rows = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain =
        Math.sin(x * 17.37 + y * 7.13) * Math.cos(x * 5.73 - y * 23.51)
      const offset = y * (1 + size * 4) + 1 + x * 4
      const rgb =
        kind === 'normal'
          ? [
              128 + Math.round(grain * 4),
              128 + Math.round(Math.sin(x * 3.7 + y * 11.3) * 4),
              255,
            ]
          : kind === 'orm'
            ? [255, 128 + Math.round(grain * 10), 255]
            : [
                249 + Math.round(grain * 5),
                249 + Math.round(grain * 5),
                249 + Math.round(grain * 5),
              ]
      for (let channel = 0; channel < 3; channel++)
        rows[offset + channel] = rgb[channel]
      rows[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export function createGlbBuilder(name, extras = {}) {
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'Lumen Apeiron pawn-board exporter',
      extras: { units: 'metres' },
    },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [] }],
    materials: [],
    accessors: [],
    bufferViews: [],
    images: [],
    textures: [],
    samplers: [
      { magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 },
    ],
    extras,
  }
  const parts = []
  let byteLength = 0

  function bytes(value, target) {
    const padding = (4 - (byteLength % 4)) % 4
    if (padding) {
      parts.push(Buffer.alloc(padding))
      byteLength += padding
    }
    const buffer = Buffer.from(value)
    const index = gltf.bufferViews.length
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: byteLength,
      byteLength: buffer.length,
      ...(target ? { target } : {}),
    })
    parts.push(buffer)
    byteLength += buffer.length
    return index
  }

  function attribute(values, components, name) {
    assert(values instanceof Float32Array)
    assert(values.length > 0 && values.length % components === 0)
    assert([...values].every(Number.isFinite), 'non-finite attribute')
    const type = Object.keys(COMPONENTS).find(
      (key) => COMPONENTS[key] === components,
    )
    assert(type, 'unsupported attribute shape')
    const bufferView = bytes(
      Buffer.from(values.buffer, values.byteOffset, values.byteLength),
      34962,
    )
    const index = gltf.accessors.length
    const bounds =
      name === 'POSITION'
        ? {
            min: Array.from({ length: components }, (_, axis) =>
              values
                .filter((_value, n) => n % components === axis)
                .reduce((a, b) => Math.min(a, b), Infinity),
            ),
            max: Array.from({ length: components }, (_, axis) =>
              values
                .filter((_value, n) => n % components === axis)
                .reduce((a, b) => Math.max(a, b), -Infinity),
            ),
          }
        : {}
    gltf.accessors.push({
      bufferView,
      componentType: 5126,
      count: values.length / components,
      type,
      ...bounds,
    })
    return index
  }
  return {
    gltf,
    texture(kind) {
      const index = gltf.textures.length
      gltf.images.push({
        name: `Authored ${kind} microtexture`,
        bufferView: bytes(microtexturePng(kind)),
        mimeType: 'image/png',
      })
      gltf.textures.push({ sampler: 0, source: index })
      return index
    },
    primitive({ positions, normals, uvs, material, mode = 4 }) {
      const attributes = { POSITION: attribute(positions, 3, 'POSITION') }
      if (normals) attributes.NORMAL = attribute(normals, 3, 'NORMAL')
      if (uvs) attributes.TEXCOORD_0 = attribute(uvs, 2, 'TEXCOORD_0')
      gltf.meshes[0].primitives.push({ attributes, material, mode })
    },
    finish() {
      const binary = Buffer.concat([
        ...parts,
        Buffer.alloc((4 - (byteLength % 4)) % 4),
      ])
      gltf.buffers = [{ byteLength: binary.length }]
      const encoded = Buffer.from(JSON.stringify(gltf))
      const json = Buffer.concat([
        encoded,
        Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
      ])
      const glb = Buffer.alloc(12 + 8 + json.length + 8 + binary.length)
      glb.writeUInt32LE(0x46546c67, 0)
      glb.writeUInt32LE(2, 4)
      glb.writeUInt32LE(glb.length, 8)
      glb.writeUInt32LE(json.length, 12)
      glb.writeUInt32LE(0x4e4f534a, 16)
      json.copy(glb, 20)
      const offset = 20 + json.length
      glb.writeUInt32LE(binary.length, offset)
      glb.writeUInt32LE(0x004e4942, offset + 4)
      binary.copy(glb, offset + 8)
      validatePawnBoardGlb(glb)
      return glb
    },
  }
}

function decodeAttributes(gltf, binary) {
  return gltf.accessors.map((accessor) => {
    assert.equal(accessor.componentType, 5126, 'export uses float32 attributes')
    const components = COMPONENTS[accessor.type]
    assert(components && Number.isInteger(accessor.count) && accessor.count > 0)
    const view = gltf.bufferViews[accessor.bufferView]
    assert(view, 'missing bufferView')
    const stride = view.byteStride ?? components * 4
    const start = accessor.byteOffset ?? 0
    assert.equal(start % 4, 0, 'accessor alignment')
    assert(
      start + (accessor.count - 1) * stride + components * 4 <= view.byteLength,
      'accessor bounds',
    )
    const decoded = Array.from(
      { length: accessor.count * components },
      (_, index) =>
        binary.readFloatLE(
          (view.byteOffset ?? 0) +
            start +
            Math.floor(index / components) * stride +
            (index % components) * 4,
        ),
    )
    assert(decoded.every(Number.isFinite), 'non-finite accessor')
    for (const [bound, reduce, initial] of [
      ['min', Math.min, Infinity],
      ['max', Math.max, -Infinity],
    ]) {
      if (!accessor[bound]) continue
      for (let axis = 0; axis < components; axis++)
        assert.equal(
          accessor[bound][axis],
          decoded
            .filter((_value, index) => index % components === axis)
            .reduce((a, b) => reduce(a, b), initial),
          'accessor declared bound',
        )
    }
    return decoded
  })
}

function validatePrimitives(gltf, values) {
  let points = 0,
    triangles = 0
  for (const mesh of gltf.meshes)
    for (const primitive of mesh.primitives) {
      assert(
        primitive.mode === 0 || primitive.mode === 4,
        'unsupported primitive mode',
      )
      const position = gltf.accessors[primitive.attributes.POSITION]
      assert(
        position?.type === 'VEC3' && position.min && position.max,
        'position bounds',
      )
      assert(gltf.materials[primitive.material], 'missing material')
      for (const index of Object.values(primitive.attributes))
        assert.equal(
          gltf.accessors[index]?.count,
          position.count,
          'attribute count mismatch',
        )
      if (primitive.mode === 0) points += position.count
      else {
        assert.equal(position.count % 3, 0)
        triangles += position.count / 3
      }
      if (primitive.attributes.NORMAL !== undefined) {
        const normals = values[primitive.attributes.NORMAL]
        for (let index = 0; index < normals.length; index += 3)
          assert(
            Math.abs(Math.hypot(...normals.slice(index, index + 3)) - 1) < 1e-4,
            'unit normal',
          )
      }
    }
  return { points, triangles }
}

function validateMaterials(gltf) {
  for (const material of gltf.materials) {
    const pbr = material.pbrMetallicRoughness
    assert(
      pbr &&
        pbr.roughnessFactor >= 0 &&
        pbr.roughnessFactor <= 1 &&
        pbr.metallicFactor >= 0 &&
        pbr.metallicFactor <= 1,
      'PBR material bounds',
    )
    for (const extension of Object.keys(material.extensions ?? {}))
      assert(
        gltf.extensionsUsed?.includes(extension),
        'undeclared material extension',
      )
    if (material.extensions?.KHR_materials_transmission) {
      assert.equal(
        material.alphaMode,
        'OPAQUE',
        'transmission uses optical transparency',
      )
      assert.equal(pbr.metallicFactor, 0)
      assert(material.extensions.KHR_materials_ior.ior >= 1)
      assert(material.extensions.KHR_materials_volume.thicknessFactor > 0)
    }
  }
}

/** Reparse bytes, check ranges and finite decoded values, then inspect topology/material policy. */
export function validatePawnBoardGlb(glb) {
  assert(glb.length >= 28, 'truncated GLB')
  assert.equal(glb.readUInt32LE(0), 0x46546c67, 'GLB magic')
  assert.equal(glb.readUInt32LE(4), 2, 'GLB version')
  assert.equal(glb.readUInt32LE(8), glb.length, 'GLB length')
  const jsonLength = glb.readUInt32LE(12)
  assert.equal(jsonLength % 4, 0, 'JSON alignment')
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a, 'JSON chunk type')
  const binaryOffset = 20 + jsonLength
  assert(binaryOffset + 8 <= glb.length, 'JSON chunk bounds')
  const gltf = JSON.parse(glb.subarray(20, binaryOffset).toString())
  assert.equal(gltf.asset.version, '2.0')
  assert.equal(gltf.asset.extras.units, 'metres')
  assert.equal(glb.readUInt32LE(binaryOffset + 4), 0x004e4942, 'BIN chunk type')
  const binary = glb.subarray(binaryOffset + 8)
  assert.equal(glb.readUInt32LE(binaryOffset), binary.length, 'BIN length')
  assert.equal(binary.length % 4, 0, 'BIN alignment')
  assert.equal(gltf.buffers.length, 1)
  assert.equal(gltf.buffers[0].byteLength, binary.length)
  for (const view of gltf.bufferViews) {
    assert.equal(view.buffer, 0)
    assert.equal((view.byteOffset ?? 0) % 4, 0, 'bufferView alignment')
    assert(
      (view.byteOffset ?? 0) + view.byteLength <= binary.length,
      'bufferView bounds',
    )
  }
  const topology = validatePrimitives(gltf, decodeAttributes(gltf, binary))
  for (const image of gltf.images) {
    assert.equal(image.mimeType, 'image/png')
    const view = gltf.bufferViews[image.bufferView]
    assert(
      binary
        .subarray(view.byteOffset, view.byteOffset + 8)
        .equals(PNG_SIGNATURE),
      'embedded PNG signature',
    )
  }
  validateMaterials(gltf)
  return { gltf, binary, ...topology, textures: gltf.images.length }
}

/** A triangle-list cuboid with outward normals and independent UVs for each face. */
export function boxVertices(width, height, depth, centre) {
  const vertices = []
  const half = [width / 2, height / 2, depth / 2]
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3,
        v = (axis + 2) % 3
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const position = [...centre]
        position[axis] += half[axis] * sign
        position[u] += half[u] * a
        position[v] += half[v] * b
        return position
      })
      const order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
      for (const corner of order) {
        const normal = [0, 0, 0]
        normal[axis] = sign
        const uv = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ][corner]
        vertices.push(...corners[corner], ...normal, ...uv)
      }
    }
  return vertices
}
