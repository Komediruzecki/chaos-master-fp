// The shipped caldera and tone star must retain the authored geometry, material and anchor contracts.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { mat4 } from 'wgpu-matrix'
import { parseBookGlb } from '../src/almanac/bookAsset'
import { GLASSWAKE_TONE_STAR_POSITIONS } from '../src/observatory/glasswakeChamber'
import { GLASSWAKE_CENTER } from '../src/observatory/scene'
import type { BookGeometry } from '../src/almanac/bookAsset'

interface AssetRecord {
  file: string
  bytes: number
  sha256: string
  triangles: number
}
interface ChamberManifest {
  sourceScriptSha256: string
  helperScriptSha256: string
  compatibleHelper?: {
    sha256: string
    functions: string[]
    verification: string
  }
  sourceBlendSha256: string
  assets: AssetRecord[]
  anchors: Record<string, number[]>
  coordinates: { up: string; worldPlacement: number[] }
  materials: string[]
  textures: unknown[]
}
interface GltfNode {
  name?: string
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
interface AssetDocument {
  nodes: GltfNode[]
  scene?: number
  scenes: { nodes: number[] }[]
  materials: {
    name: string
    alphaMode?: string
    emissiveFactor?: number[]
    pbrMetallicRoughness: {
      baseColorFactor: number[]
      metallicFactor: number
      roughnessFactor: number
    }
  }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  textures?: unknown[]
  images?: unknown[]
  animations?: unknown[]
  skins?: unknown[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
}

const runtime = new URL('../public/models/observatory/', import.meta.url)
const source = new URL('../assets-source/observatory/', import.meta.url)
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(
  await readFile(new URL('glasswake-chamber.manifest.json', runtime), 'utf8'),
) as ChamberManifest

async function asset(file: string) {
  const bytes = await readFile(new URL(file, runtime))
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  const geometry = parseBookGlb(buffer)
  const jsonLength = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  const document = JSON.parse(
    bytes.toString('utf8', 20, 20 + jsonLength),
  ) as AssetDocument
  return { bytes, geometry, document }
}

function close(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
) {
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < actual.length; index++)
    assert.ok(
      Math.abs(actual[index] - expected[index]) < tolerance,
      `${index}: ${actual[index]} differs from ${expected[index]}`,
    )
}

function assertSurfaceGeometry(geometry: BookGeometry) {
  const position = (index: number) =>
    Array.from(geometry.vertices.slice(index * 16, index * 16 + 3))
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const a = position(geometry.indices[offset])
    const b = position(geometry.indices[offset + 1])
    const c = position(geometry.indices[offset + 2])
    const ab = b.map((value, axis) => value - a[axis])
    const ac = c.map((value, axis) => value - a[axis])
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const area = Math.hypot(...cross)
    assert.ok(area > 1e-10, `triangle ${offset / 3} has zero area`)
    for (let corner = 0; corner < 3; corner++) {
      const at = geometry.indices[offset + corner] * 16 + 4
      const normal = Array.from(geometry.vertices.slice(at, at + 3))
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5)
      assert.ok(
        normal.reduce((sum, value, axis) => sum + value * cross[axis], 0) > 0,
        `triangle ${offset / 3} winding opposes its normal`,
      )
    }
  }
}

await test('committed exports load with bounded triangles and intact nondegenerate outward-facing surfaces', async () => {
  for (const [file, minimum, maximum] of [
    ['glasswake-chamber.glb', 1000, 12000],
    ['glasswake-tone-star.glb', 12, 64],
  ] as const) {
    const { geometry, bytes } = await asset(file)
    const recorded = manifest.assets.find((entry) => entry.file === file)
    assert.ok(recorded, `${file} is absent from manifest`)
    assert.ok(geometry.triangles >= minimum && geometry.triangles <= maximum)
    assert.equal(geometry.triangles, recorded.triangles)
    assert.equal(bytes.byteLength, recorded.bytes)
    assert.equal(hash(bytes), recorded.sha256)
    assert.ok(Array.from(geometry.vertices).every(Number.isFinite))
    assertSurfaceGeometry(geometry)
  }
  const star = (await asset('glasswake-tone-star.glb')).geometry
  close(star.bounds.min, [-Math.sqrt(3) * 0.025, -0.085, -0.05])
  close(star.bounds.max, [Math.sqrt(3) * 0.025, 0.085, 0.05])
})

await test('caldera uses only opaque factor materials and no texture, transmission, skinning or animation payload', async () => {
  const expected = [
    ['Obsidian | gloss', 'Obsidian | worn', 'Porcelain | bone'],
    ['Glass | frost'],
  ]
  const files = ['glasswake-chamber.glb', 'glasswake-tone-star.glb']
  for (const [index, file] of files.entries()) {
    const { geometry, document } = await asset(file)
    assert.deepEqual(
      [...geometry.materials].sort(),
      [...expected[index]].sort(),
    )
    for (const key of ['textures', 'images', 'animations', 'skins'] as const)
      assert.equal(document[key]?.length ?? 0, 0, `${file}: unexpected ${key}`)
    for (const extension of [
      ...(document.extensionsUsed ?? []),
      ...(document.extensionsRequired ?? []),
    ])
      assert.equal(extension, 'KHR_materials_specular')
    for (const material of document.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE')
      assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1)
      assert.equal(material.pbrMetallicRoughness.metallicFactor, 0)
      assert.ok(material.pbrMetallicRoughness.roughnessFactor > 0)
      assert.deepEqual(material.emissiveFactor ?? [0, 0, 0], [0, 0, 0])
      assert.doesNotMatch(
        JSON.stringify(material),
        /Texture|transmission|volume/i,
      )
    }
    for (const mesh of document.meshes)
      for (const primitive of mesh.primitives)
        assert.deepEqual(Object.keys(primitive.attributes).sort(), [
          'NORMAL',
          'POSITION',
        ])
  }
  assert.deepEqual([...manifest.materials].sort(), expected.flat().sort())
  assert.deepEqual(manifest.textures, [])
})

function namedAnchors(document: AssetDocument) {
  const anchors = new Map<string, number[]>()

  function visit(index: number, parent: Float32Array) {
    const node = document.nodes[index]
    let local = node.matrix
      ? new Float32Array(node.matrix)
      : mat4.fromQuat(node.rotation ?? [0, 0, 0, 1])
    if (!node.matrix) {
      local = mat4.scale(local, node.scale ?? [1, 1, 1])
      local[12] = node.translation?.[0] ?? 0
      local[13] = node.translation?.[1] ?? 0
      local[14] = node.translation?.[2] ?? 0
    }
    const transform = mat4.multiply(parent, local)
    if (node.name) anchors.set(node.name, Array.from(transform.slice(12, 15)))
    for (const child of node.children ?? []) visit(child, transform)
  }
  for (const root of document.scenes[document.scene ?? 0].nodes)
    visit(root, mat4.identity())
  return anchors
}

await test('exported named anchors, authored manifest and runtime world positions agree', async () => {
  const { document } = await asset('glasswake-chamber.glb')
  const nodes = namedAnchors(document)
  assert.equal(manifest.coordinates.up, '+Y')
  close(manifest.coordinates.worldPlacement, [0, 0, -4.6])
  const world = (position: readonly number[]) =>
    position.map(
      (value, axis) => value + manifest.coordinates.worldPlacement[axis],
    )
  for (const key of [
    'SealCenter',
    'ToneStar.C',
    'ToneStar.E',
    'ToneStar.G',
    'ListenerMark',
  ]) {
    const node = nodes.get(key)
    assert.ok(node, `GLB is missing ${key}`)
    close(node, manifest.anchors[key])
  }
  close(world(manifest.anchors.SealCenter), GLASSWAKE_CENTER)
  for (const [group, note] of ['C', 'E', 'G'].entries())
    close(
      world(manifest.anchors[`ToneStar.${note}`]),
      GLASSWAKE_TONE_STAR_POSITIONS[group],
    )
  close(manifest.anchors.ListenerMark, [0, 0, 1.9])
})

await test('manifest hashes identify the Blender source, generation recipe and compatible helper', async () => {
  if (manifest.compatibleHelper) {
    assert.deepEqual(manifest.compatibleHelper.functions, ['bp', 'aim'])
    assert.match(manifest.compatibleHelper.verification, /not regenerated/)
    assert.match(manifest.helperScriptSha256, /^[a-f0-9]{64}$/)
  }
  for (const [file, expected] of [
    ['build_glasswake_chamber.py', manifest.sourceScriptSha256],
    [
      'build_observatory.py',
      manifest.compatibleHelper?.sha256 ?? manifest.helperScriptSha256,
    ],
    ['glasswake-chamber.blend', manifest.sourceBlendSha256],
  ])
    assert.equal(
      hash(await readFile(new URL(file, source))),
      expected,
      `${file} changed without re-export`,
    )
})
