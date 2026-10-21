// Shipping reliefs must fit the curved book, preserve the completed exercises, and remain bounded closed meshes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { mat4 } from 'wgpu-matrix'
import { parseBookGlb } from '../src/almanac/bookAsset'
import { BRIDGE_NOTE_NAMES, BRIDGE_TARGET } from '../src/observatory/encounter'
import type { BookGeometry } from '../src/almanac/bookAsset'

interface ReliefManifest {
  sourceScriptSha256: string
  bookRecipeSha256: string
  sourceBlendSha256: string
  assets: {
    file: string
    sha256: string
    bytes: number
    triangles: number
    sourceMeshObjects: number
  }[]
  notes: Record<string, string[]>
  anchors: Record<string, Record<string, number[]>>
  tideweaveTraceTarget: number[][]
}
interface GltfDocument {
  nodes: {
    name?: string
    mesh?: number
    children?: number[]
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }[]
  scene?: number
  scenes: { nodes: number[] }[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
  materials: {
    alphaMode?: string
    pbrMetallicRoughness: { baseColorFactor: number[] }
  }[]
  textures?: unknown[]
  images?: unknown[]
  animations?: unknown[]
  skins?: unknown[]
}

const runtime = new URL('../public/models/almanac/', import.meta.url)
const source = new URL('../assets-source/almanac/', import.meta.url)
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(
  await readFile(new URL('earned-reliefs.manifest.json', runtime), 'utf8'),
) as ReliefManifest

async function asset(world: 'glasswake' | 'tideweave') {
  const bytes = await readFile(new URL(`${world}-earned.glb`, runtime))
  const geometry = parseBookGlb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  const document = JSON.parse(
    bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
  ) as GltfDocument
  return { bytes, geometry, document }
}

// This is the placement contract of the existing authored book, independent of the relief generator.
function pageHeight(x: number, z: number) {
  const t = Math.max(0, Math.min(1, (Math.abs(x) - 0.035) / 1.29))
  return (
    0.143 +
    0.146 * Math.sin(Math.PI * t) * Math.exp(-0.45 * t) -
    0.057 * Math.exp(-12 * t) +
    0.006 * Math.cos(z * 2.8)
  )
}

function close(actual: readonly number[], expected: readonly number[]) {
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < actual.length; index++)
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-6,
      `${actual[index]} differs from ${expected[index]}`,
    )
}

function validateClosedSurfaces(geometry: BookGeometry) {
  const points = new Map<string, number>()
  const welded: number[] = []
  const edges = new Map<string, { count: number; direction: number }>()
  for (let index = 0; index < geometry.vertices.length / 16; index++) {
    const key = Array.from(geometry.vertices.slice(index * 16, index * 16 + 3))
      .map((value) => Math.round(value * 1e7))
      .join(',')
    if (!points.has(key)) points.set(key, points.size)
    welded.push(points.get(key)!)
  }
  const position = (index: number) =>
    Array.from(geometry.vertices.slice(index * 16, index * 16 + 3))
  for (let at = 0; at < geometry.indices.length; at += 3) {
    const ids = Array.from(geometry.indices.slice(at, at + 3))
    const triangle = ids.map(position)
    const ab = triangle[1].map((value, axis) => value - triangle[0][axis])
    const ac = triangle[2].map((value, axis) => value - triangle[0][axis])
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    assert.ok(Math.hypot(...cross) > 1e-10, `degenerate triangle ${at / 3}`)
    // Sample every triangle interior as well as vertices so a coarse flat plaque cannot cut through paper.
    const center = [0, 1, 2].map(
      (axis) => triangle.reduce((sum, point) => sum + point[axis], 0) / 3,
    )
    assert.ok(center[1] - pageHeight(center[0], center[2]) > 0.007)
    ids.forEach((index, corner) => {
      const normal = Array.from(
        geometry.vertices.slice(index * 16 + 4, index * 16 + 7),
      )
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5)
      assert.ok(
        normal.reduce((sum, value, axis) => sum + value * cross[axis], 0) > 0,
        `triangle ${at / 3} opposes its normal`,
      )
      const a = welded[index]
      const b = welded[ids[(corner + 1) % 3]]
      const key = `${Math.min(a, b)},${Math.max(a, b)}`
      const edge = edges.get(key) ?? { count: 0, direction: 0 }
      edge.count++
      edge.direction += a < b ? 1 : -1
      edges.set(key, edge)
    })
  }
  for (const [edge, state] of edges) {
    assert.equal(state.count, 2, `${edge} is not a closed manifold edge`)
    assert.equal(state.direction, 0, `${edge} has inconsistent winding`)
  }
}

await test('earned reliefs preserve bounded closed geometry and stay above the existing paper without covering orb charts', async () => {
  let triangles = 0
  for (const [world, expectedTriangles, expectedMeshes] of [
    ['glasswake', 626, 9],
    ['tideweave', 536, 8],
  ] as const) {
    const { bytes, geometry, document } = await asset(world)
    const record = manifest.assets.find(
      (entry) => entry.file === `${world}-earned.glb`,
    )
    assert.ok(record)
    assert.equal(geometry.triangles, expectedTriangles)
    assert.equal(record.triangles, expectedTriangles)
    assert.equal(record.sourceMeshObjects, expectedMeshes)
    assert.equal(
      document.nodes.filter((node) => node.mesh !== undefined).length,
      expectedMeshes,
    )
    assert.equal(bytes.byteLength, record.bytes)
    assert.equal(hash(bytes), record.sha256)
    assert.ok(bytes.byteLength < 64 * 1024)
    triangles += geometry.triangles
    const minX = world === 'glasswake' ? -1.15 : 0.23
    const maxX = world === 'glasswake' ? -0.23 : 1.15
    for (let at = 0; at < geometry.vertices.length; at += 16) {
      const [x, y, z] = geometry.vertices.slice(at, at + 3)
      assert.ok(
        Array.from(geometry.vertices.slice(at, at + 16)).every(Number.isFinite),
      )
      assert.ok(x >= minX - 1e-6 && x <= maxX + 1e-6)
      assert.ok(z >= 0.49 - 1e-6 && z <= 0.75 + 1e-6)
      const clearance = y - pageHeight(x, z)
      assert.ok(clearance >= 0.009 - 1e-6 && clearance <= 0.068 + 1e-6)
    }
    validateClosedSurfaces(geometry)
  }
  assert.ok(triangles <= 1500)
})

await test('relief exports remain compatible with the factor-only runtime and contain no hidden texture or animation dependency', async () => {
  for (const world of ['glasswake', 'tideweave'] as const) {
    const { geometry, document } = await asset(world)
    assert.deepEqual(
      [...geometry.materials].sort(),
      [
        'Relief | night enamel',
        'Relief | satin silver',
        world === 'glasswake'
          ? 'Relief | burnished gold'
          : 'Relief | verdigris glass',
      ].sort(),
    )
    for (const key of ['textures', 'images', 'animations', 'skins'] as const)
      assert.equal(document[key]?.length ?? 0, 0)
    for (const material of document.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE')
      assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1)
      assert.doesNotMatch(
        JSON.stringify(material),
        /Texture|transmission|volume/i,
      )
    }
    for (const model of document.meshes)
      for (const primitive of model.primitives)
        assert.deepEqual(Object.keys(primitive.attributes).sort(), [
          'NORMAL',
          'POSITION',
        ])
  }
})

function anchors(document: GltfDocument) {
  const result = new Map<string, number[]>()

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
    const matrix = mat4.multiply(parent, local)
    if (node.name?.startsWith('EarnedNote.'))
      result.set(
        node.name.slice('EarnedNote.'.length),
        Array.from(matrix.slice(12, 15)),
      )
    for (const child of node.children ?? []) visit(child, matrix)
  }
  for (const root of document.scenes[document.scene ?? 0].nodes)
    visit(root, mat4.identity())
  return result
}

await test('earned markers retain the completed three-star and four-note exercise rather than the eight-note world motif', async () => {
  assert.deepEqual(manifest.notes.glasswake, ['C', 'E', 'G'])
  assert.deepEqual(manifest.notes.tideweave, BRIDGE_NOTE_NAMES)
  assert.deepEqual(manifest.tideweaveTraceTarget, BRIDGE_TARGET)
  for (const world of ['glasswake', 'tideweave'] as const) {
    const points = anchors((await asset(world)).document)
    assert.equal(points.size, world === 'glasswake' ? 3 : 4)
    const coords =
      world === 'glasswake'
        ? [
            [-0.99, 0.62],
            [-0.69, 0.62],
            [-0.39, 0.62],
          ]
        : BRIDGE_TARGET.map(([u, v]) => [0.23 + u * 0.92, 0.49 + v * 0.26])
    manifest.notes[world].forEach((note, index) => {
      const point = points.get(note)
      assert.ok(point)
      const [x, z] = coords[index]
      close(point, [x, pageHeight(x, z) + 0.068, z])
      close(point, manifest.anchors[world][note])
    })
  }
})

await test('manifest identifies the editable Blender source and the recipe that owns paper curvature', async () => {
  for (const [file, expected] of [
    ['build_book_reliefs.py', manifest.sourceScriptSha256],
    ['build_book.py', manifest.bookRecipeSha256],
    ['almanac-page-reliefs.blend', manifest.sourceBlendSha256],
  ])
    assert.equal(
      hash(await readFile(new URL(file, source))),
      expected,
      `${file} needs a matching re-export`,
    )
})
