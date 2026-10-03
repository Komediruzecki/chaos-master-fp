/** Append checked linear COLOR_0 to native flame POINTS without changing older GLB exporters. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createGlbBuilder, validatePawnBoardGlb } from './pawn-board-glb.mjs'

function checkColours(colors, count) {
  assert(colors instanceof Float32Array, 'colour data must be Float32Array')
  assert.equal(colors.length, count * 4, 'colour count mismatch')
  for (let index = 0; index < colors.length; index++) {
    const value = colors[index]
    assert(
      Number.isFinite(value) && value >= 0 && value <= 1,
      'linear colour channel bounds',
    )
    if (index % 4 === 3) assert.equal(value, 1, 'opaque point alpha')
  }
}

function pack(gltf, binary) {
  assert.equal(binary.length % 4, 0, 'binary alignment')
  const encoded = Buffer.from(JSON.stringify(gltf))
  const json = Buffer.concat([
    encoded,
    Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
  ])
  const bytes = Buffer.alloc(28 + json.length + binary.length)
  bytes.writeUInt32LE(0x46546c67, 0)
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(json.length, 12)
  bytes.writeUInt32LE(0x4e4f534a, 16)
  json.copy(bytes, 20)
  const offset = 20 + json.length
  bytes.writeUInt32LE(binary.length, offset)
  bytes.writeUInt32LE(0x004e4942, offset + 4)
  binary.copy(bytes, offset + 8)
  return bytes
}

/** White unlit material multiplies linear per-vertex RGB; no surface is invented. */
export function createFlameFigurineGlb({
  name,
  positions,
  colors,
  extras = {},
}) {
  assert(
    positions instanceof Float32Array && positions.length % 3 === 0,
    'position shape',
  )
  checkColours(colors, positions.length / 3)
  const builder = createGlbBuilder(name, extras)
  builder.gltf.asset.generator = 'Lumen Apeiron nonlinear flame exporter'
  builder.gltf.extensionsUsed = ['KHR_materials_unlit']
  builder.gltf.materials.push({
    name: `${name} structural point colour`,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    extensions: { KHR_materials_unlit: {} },
    extras: {
      colourSpace: 'linear RGB',
      pointSize: 'Importer-dependent; no triangle surface or normals.',
    },
  })
  builder.primitive({ positions, material: 0, mode: 0 })
  const { gltf, binary } = validatePawnBoardGlb(builder.finish())
  const bufferView = gltf.bufferViews.length
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: binary.length,
    byteLength: colors.byteLength,
    target: 34962,
  })
  const accessor = gltf.accessors.length
  gltf.accessors.push({
    bufferView,
    componentType: 5126,
    count: colors.length / 4,
    type: 'VEC4',
  })
  gltf.meshes[0].primitives[0].attributes.COLOR_0 = accessor
  const combined = Buffer.concat([
    binary,
    Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength),
  ])
  gltf.buffers[0].byteLength = combined.length
  const bytes = pack(gltf, combined)
  validateFlameFigurineGlb(bytes)
  return bytes
}

function readColours(gltf, binary, primitive) {
  assert.equal(primitive.mode, 0, 'flame export must use POINTS')
  const accessor = gltf.accessors[primitive.attributes.COLOR_0]
  assert(accessor, 'missing COLOR_0')
  assert.equal(accessor.componentType, 5126, 'colour component type')
  assert.equal(accessor.type, 'VEC4', 'opaque colour accessor shape')
  assert(!accessor.normalized, 'float colour does not use normalized encoding')
  const view = gltf.bufferViews[accessor.bufferView]
  assert.equal(view.target, 34962, 'colour vertex buffer target')
  const colors = new Float32Array(accessor.count * 4)
  const stride = view.byteStride ?? 16
  for (let index = 0; index < colors.length; index++)
    colors[index] = binary.readFloatLE(
      (view.byteOffset ?? 0) +
        (accessor.byteOffset ?? 0) +
        Math.floor(index / 4) * stride +
        (index % 4) * 4,
    )
  checkColours(colors, gltf.accessors[primitive.attributes.POSITION].count)
  return colors
}

/** Reparse exported bytes, including header/accessor checks and colour-space bounds. */
export function validateFlameFigurineGlb(bytes) {
  const checked = validatePawnBoardGlb(bytes)
  const min = [Infinity, Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity, -Infinity]
  let coloredPoints = 0
  for (const mesh of checked.gltf.meshes)
    for (const primitive of mesh.primitives) {
      const colors = readColours(checked.gltf, checked.binary, primitive)
      coloredPoints += colors.length / 4
      for (let index = 0; index < colors.length; index++) {
        const axis = index % 4
        min[axis] = Math.min(min[axis], colors[index])
        max[axis] = Math.max(max[axis], colors[index])
      }
    }
  assert.equal(
    coloredPoints,
    checked.points,
    'all points have opaque linear colour',
  )
  return { ...checked, coloredPoints, colorBounds: { min, max } }
}
