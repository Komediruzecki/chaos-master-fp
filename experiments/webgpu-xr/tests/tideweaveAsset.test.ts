// The Tideweave kit must retain its open sightline, bounded reusable geometry and authored source lineage.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseBookGlb } from '../src/almanac/bookAsset'
import type { BookGeometry } from '../src/almanac/bookAsset'

interface AssetRecord {
  file: string
  bytes: number
  sha256: string
  triangles: number
  materialGroups: number
}
interface TideweaveManifest {
  sourceScriptSha256: string
  sourceBlendSha256: string
  assets: AssetRecord[]
  textures: unknown[]
  materials: string[]
  anchors: Record<string, number[]>
  coordinates: { up: string; worldPlacement: number[] }
  traceClearance: { min: number[]; max: number[] }
}
interface AssetDocument {
  nodes: { name?: string; translation?: number[] }[]
  materials: {
    name: string
    alphaMode?: string
    pbrMetallicRoughness: {
      baseColorFactor: number[]
      metallicFactor: number
      roughnessFactor: number
    }
  }[]
  textures?: unknown[]
  images?: unknown[]
  animations?: unknown[]
  skins?: unknown[]
  extensionsRequired?: string[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
}

const runtime = new URL('../public/models/observatory/', import.meta.url)
const source = new URL('../assets-source/observatory/', import.meta.url)
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(
  await readFile(new URL('tideweave-crossing.manifest.json', runtime), 'utf8'),
) as TideweaveManifest

async function asset(file: string) {
  const bytes = await readFile(new URL(file, runtime))
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  const document = JSON.parse(
    bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
  ) as AssetDocument
  return { bytes, document, geometry: parseBookGlb(buffer) }
}

function surfaceAudit(geometry: BookGeometry) {
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
    assert.ok(Math.hypot(...cross) > 1e-10, `zero-area triangle ${offset / 3}`)
    for (let corner = 0; corner < 3; corner++) {
      const at = geometry.indices[offset + corner] * 16 + 4
      const normal = Array.from(geometry.vertices.slice(at, at + 3))
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5)
      assert.ok(
        normal.reduce((sum, value, axis) => sum + value * cross[axis], 0) > 0,
        `normal opposes triangle ${offset / 3}`,
      )
    }
  }
}

await test('fresh Tideweave exports retain bounded nondegenerate geometry and exact manifest identities', async () => {
  for (const [file, minimum, maximum, groups] of [
    ['tideweave-crossing.glb', 6000, 18000, 4],
    ['tideweave-resonator.glb', 500, 1500, 3],
    ['tideweave-bridge-weave.glb', 800, 3000, 2],
  ] as const) {
    const { bytes, geometry } = await asset(file)
    const recorded = manifest.assets.find((entry) => entry.file === file)
    assert.ok(recorded, `${file} has no manifest record`)
    assert.equal(hash(bytes), recorded.sha256)
    assert.equal(bytes.byteLength, recorded.bytes)
    assert.equal(geometry.triangles, recorded.triangles)
    assert.equal(geometry.materials.length, groups)
    assert.equal(recorded.materialGroups, groups)
    assert.ok(geometry.triangles >= minimum && geometry.triangles <= maximum)
    assert.ok(Array.from(geometry.vertices).every(Number.isFinite))
    surfaceAudit(geometry)
  }
})

await test('the crossing keeps the interactive trace rectangle completely free of triangles', async () => {
  const { geometry } = await asset('tideweave-crossing.glb')
  const { min, max } = manifest.traceClearance
  assert.deepEqual(min, [-1.22, 0.48, -4.8])
  assert.deepEqual(max, [1.22, 1.78, -4.3])
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const points = [0, 1, 2].map((corner) => {
      const at = geometry.indices[offset + corner] * 16
      return Array.from(geometry.vertices.slice(at, at + 3))
    })
    // A separating AABB axis proves the entire triangle cannot touch the protected volume.
    assert.ok(
      [0, 1, 2].some(
        (axis) =>
          Math.max(...points.map((point) => point[axis])) < min[axis] ||
          Math.min(...points.map((point) => point[axis])) > max[axis],
      ),
      `triangle ${offset / 3} enters the trace clearance`,
    )
  }
  assert.deepEqual(manifest.coordinates, {
    up: '+Y',
    forward: '-Z',
    worldPlacement: [0, 0, 0],
  })
  assert.deepEqual(manifest.anchors.TraceCentre, [0, 1.12, -4.6])
  assert.deepEqual(manifest.anchors.BridgeMouth, [0, 0, -3.7])
  assert.deepEqual(manifest.anchors.FarLanding, [0, 0, -10])
})

await test('note ornament and earned weave fit their reusable local-space placement contracts', async () => {
  const resonator = (await asset('tideweave-resonator.glb')).geometry
  assert.ok(resonator.bounds.min[1] >= -0.2)
  assert.ok(resonator.bounds.max[1] <= 0.18)
  assert.ok(resonator.bounds.max[0] - resonator.bounds.min[0] < 0.2)
  assert.ok(resonator.bounds.max[2] - resonator.bounds.min[2] < 0.1)
  const weave = (await asset('tideweave-bridge-weave.glb')).geometry
  assert.ok(weave.bounds.min[1] > 0)
  assert.ok(weave.bounds.max[1] < 0.05)
  assert.ok(weave.bounds.min[0] > -0.7 && weave.bounds.max[0] < 0.7)
  assert.ok(weave.bounds.min[2] > -0.5 && weave.bounds.max[2] < 0.5)
})

await test('Tideweave uses the opaque factor path without image, decoder, animation or transparency dependencies', async () => {
  for (const record of manifest.assets) {
    const { document } = await asset(record.file)
    for (const key of ['textures', 'images', 'animations', 'skins'] as const)
      assert.equal(document[key]?.length ?? 0, 0)
    assert.deepEqual(document.extensionsRequired ?? [], [])
    for (const material of document.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE')
      const pbr = material.pbrMetallicRoughness
      assert.equal(pbr.baseColorFactor[3], 1)
      assert.ok(pbr.metallicFactor >= 0 && pbr.metallicFactor <= 1)
      assert.ok(pbr.roughnessFactor > 0)
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
  assert.deepEqual(manifest.textures, [])
  assert.deepEqual([...manifest.materials].sort(), [
    'Tideweave | aged brass',
    'Tideweave | mineral',
    'Tideweave | patinated bronze',
    'Tideweave | porcelain',
  ])
})

await test('the packed Blender source and recipe match the delivered kit manifest', async () => {
  for (const [file, expected] of [
    ['build_tideweave_crossing.py', manifest.sourceScriptSha256],
    ['tideweave-crossing.blend', manifest.sourceBlendSha256],
  ])
    assert.equal(hash(await readFile(new URL(file, source))), expected)
})
