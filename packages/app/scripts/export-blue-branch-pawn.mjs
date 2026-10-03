/** Export native blue branching cores and smooth hollow glass without rewriting prior assets. */
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGlbBuilder, validatePawnBoardGlb } from './pawn-board-glb.mjs'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(app, '../..')
const assets = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repository, 'assets')
assert(
  process.argv.length <= 3,
  'Usage: node export-blue-branch-pawn.mjs [output-directory]',
)
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export { buildBlueBranchPawnFlame, DEFAULT_BLUE_BRANCH_PAWN_RECIPE, BLUE_BRANCH_PAWN_POINT_LIGHTNESS } from './src/flame/chess/blueBranchPawnFlame'; export { sampleFlameFigurineCloud } from './src/flame/chess/flameFigurineCloud'; export { buildPawnShellGeometry, buildPawnShellFragments, isPointInsidePawnShellCavity, PAWN_SHELL_FLOOR, PAWN_SHELL_TOP } from './src/flame/chess/pawnBoardGeometry';",
    resolveDir: app,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  alias: {
    '@': resolve(app, 'src'),
    '@chaos-master/core': resolve(repository, 'packages/core/src'),
  },
})
const temporary = await mkdtemp(resolve(tmpdir(), 'lumen-blue-branch-export-'))
let native
try {
  const compiled = resolve(temporary, 'blue-branch.cjs')
  await writeFile(compiled, bundle.outputFiles[0].text)
  native = require(compiled)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const seed = 0x626c7565
const count = 100_000
const burnIn = 96
const lightness = native.BLUE_BRANCH_PAWN_POINT_LIGHTNESS
assert(
  Number.isFinite(lightness) && lightness > 0 && lightness <= 1,
  'Authored blue branch lightness',
)
const shellOptions = { radialSegments: 64, smoothNormals: true }
const originOffset = -Math.fround(native.PAWN_SHELL_FLOOR)
const shellHeight = native.PAWN_SHELL_TOP + originOffset
const closedShardCount = native.buildPawnShellFragments(shellOptions).length
assert.equal(closedShardCount, 1600, 'Authored runtime shard grid changed')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const colorPolicy = {
  source:
    'Native transform OkLab a/b recurrence, including colorSpeed and authored vibrancy.',
  fixedLightness: lightness,
  encoding:
    'FLOAT32 linear RGBA COLOR_0, alpha=1; white KHR_materials_unlit point material.',
  conversion:
    '@typegpu/color oklabToLinearRgb; clamp out-of-gamut linear channels into [0,1].',
  difference:
    'Live preview lightness is density/exposure dependent. Exported structural point colours use a fixed lightness and are not pixel matches.',
}

function shellAttributes(vertices) {
  const verticesCount = vertices.length / 6
  const positions = new Float32Array(verticesCount * 3)
  const normals = new Float32Array(verticesCount * 3)
  const uvs = new Float32Array(verticesCount * 2)
  for (let n = 0; n < verticesCount; n++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[n * 3 + axis] =
        vertices[n * 6 + axis] + (axis === 1 ? originOffset : 0)
      normals[n * 3 + axis] = vertices[n * 6 + 3 + axis]
    }
    uvs[n * 2] =
      Math.atan2(positions[n * 3 + 2], positions[n * 3]) / (2 * Math.PI) + 0.5
    uvs[n * 2 + 1] = positions[n * 3 + 1] / shellHeight
  }
  // Each triangle keeps a short cylindrical U interval; poles use the adjoining
  // corners' U, so micro-normal sampling does not stretch across the entire map.
  for (let start = 0; start < verticesCount; start += 3) {
    const indices = [start, start + 1, start + 2]
    const regular = indices.filter(
      (n) => Math.hypot(positions[n * 3], positions[n * 3 + 2]) > 1e-8,
    )
    const values = regular.map((n) => uvs[n * 2])
    if (Math.max(...values) - Math.min(...values) > 0.5)
      for (const n of regular) if (uvs[n * 2] < 0.5) uvs[n * 2] += 1
    const poleU =
      regular.reduce((sum, n) => sum + uvs[n * 2], 0) / regular.length
    for (const n of indices) if (!regular.includes(n)) uvs[n * 2] = poleU
  }
  return { positions, normals, uvs }
}

/** Extend only this new export with COLOR_0; the shared builder contract stays intact. */
function appendColors(bytes, colors) {
  const { gltf, binary } = validatePawnBoardGlb(bytes)
  const point = gltf.meshes
    .flatMap((mesh) => mesh.primitives)
    .find((primitive) => primitive.mode === 0)
  assert(point, 'Missing native point primitive')
  const points = gltf.accessors[point.attributes.POSITION].count
  assert(
    colors instanceof Float32Array && colors.length === points * 4,
    'Point colour shape',
  )
  for (let n = 0; n < colors.length; n++) {
    assert(
      Number.isFinite(colors[n]) && colors[n] >= 0 && colors[n] <= 1,
      'Linear colour bounds',
    )
    if (n % 4 === 3) assert.equal(colors[n], 1, 'Opaque point alpha')
  }
  const bufferView = gltf.bufferViews.length
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: binary.length,
    byteLength: colors.byteLength,
    target: 34962,
  })
  point.attributes.COLOR_0 = gltf.accessors.length
  gltf.accessors.push({
    bufferView,
    componentType: 5126,
    count: points,
    type: 'VEC4',
  })
  const combined = Buffer.concat([
    binary,
    Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength),
  ])
  gltf.buffers[0].byteLength = combined.length
  const encoded = Buffer.from(JSON.stringify(gltf))
  const json = Buffer.concat([
    encoded,
    Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
  ])
  const result = Buffer.alloc(28 + json.length + combined.length)
  result.writeUInt32LE(0x46546c67, 0)
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(json.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  json.copy(result, 20)
  const offset = 20 + json.length
  result.writeUInt32LE(combined.length, offset)
  result.writeUInt32LE(0x004e4942, offset + 4)
  combined.copy(result, offset + 8)
  const checked = validatePawnBoardGlb(result)
  const accessor = checked.gltf.accessors[point.attributes.COLOR_0]
  const view = checked.gltf.bufferViews[accessor.bufferView]
  for (let n = 0; n < colors.length; n++)
    assert.equal(
      checked.binary.readFloatLE(view.byteOffset + n * 4),
      colors[n],
      'Saved linear colour changed',
    )
  return { bytes: result, checked }
}

const shell = shellAttributes(
  native.buildPawnShellGeometry(shellOptions).vertices,
)
const reports = []
await mkdir(assets, { recursive: true })
for (const side of ['light', 'dark']) {
  const palette = side === 'light' ? 'frost' : 'ember'
  const stem = `fractal-pawn-blue-branch-${palette}`
  const recipe = { ...native.DEFAULT_BLUE_BRANCH_PAWN_RECIPE, side }
  const flame = native.buildBlueBranchPawnFlame(recipe)
  const cloud = native.sampleFlameFigurineCloud(flame, {
    count,
    seed,
    burnIn,
    lightness,
  })
  const positions = new Float32Array(cloud.count * 3)
  for (let n = 0; n < cloud.count; n++) {
    assert(
      native.isPointInsidePawnShellCavity(
        [cloud.points[n * 4], cloud.points[n * 4 + 1], cloud.points[n * 4 + 2]],
        shellOptions,
      ),
      'Saved core point escapes the glass cavity',
    )
    for (let axis = 0; axis < 3; axis++)
      positions[n * 3 + axis] =
        cloud.points[n * 4 + axis] + (axis === 1 ? originOffset : 0)
  }
  const builder = createGlbBuilder(
    `${palette === 'frost' ? 'Frost' : 'Ember'} blue branching pawn`,
    {
      kind: 'native-ifs-blue-branching-pawn',
      studyId: 'blue-branch-pawn',
      units: 'metres',
      yUp: true,
      baseOnY: 0,
      side,
      recipe,
      nativeFlame: flame,
      shell: {
        ...shellOptions,
        hollow: true,
        wallThicknessMetres: 0.018,
        preservedSharpProfileCreasesDegrees: 40,
      },
      pointCloud: {
        topology: 'glTF POINTS',
        count,
        seed,
        burnIn,
        reconstructedSurface: false,
        nativeOriginOffset: [0, originOffset, 0],
      },
      colorPolicy,
      fracture: {
        embeddedAnimation: false,
        runtimeGenerator: 'buildPawnShellFragments',
        closedShardCount,
        radialSegments: 64,
      },
    },
  )
  builder.gltf.asset.generator =
    'Lumen Apeiron native blue branching pawn exporter'
  const maps = {
    colour: builder.texture('colour'),
    orm: builder.texture('orm'),
    normal: builder.texture('normal'),
  }
  builder.gltf.extensionsUsed = [
    'KHR_materials_transmission',
    'KHR_materials_ior',
    'KHR_materials_volume',
    'KHR_materials_unlit',
  ]
  builder.gltf.materials.push(
    {
      name: 'Clear thin-wall glass',
      alphaMode: 'OPAQUE',
      doubleSided: false,
      pbrMetallicRoughness: {
        baseColorFactor: [0.99, 0.997, 1, 1],
        baseColorTexture: { index: maps.colour },
        metallicFactor: 0,
        roughnessFactor: 0.055,
        metallicRoughnessTexture: { index: maps.orm },
      },
      normalTexture: { index: maps.normal, scale: 0.025 },
      extensions: {
        KHR_materials_transmission: { transmissionFactor: 1 },
        KHR_materials_ior: { ior: 1.5 },
        KHR_materials_volume: {
          thicknessFactor: 0.018,
          attenuationDistance: 3,
          attenuationColor: [0.97, 0.99, 1],
        },
      },
      extras: {
        hollow: true,
        materialPolicy:
          'Subtle authored micro-normal; no frosting. Portable volume optics approximate the live two-wall shader.',
      },
    },
    {
      name: 'Native structural point colours',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      extensions: { KHR_materials_unlit: {} },
      extras: {
        colourSpace: 'linear RGB',
        pointSize:
          'Importer-dependent; native points have no reconstructed solid surface.',
      },
    },
  )
  builder.primitive({ ...shell, material: 0 })
  builder.primitive({ positions, material: 1, mode: 0 })
  // Keep native points separate from polygon surfaces: Blender otherwise uses
  // corner-domain colors, which cannot retain COLOR_0 on loose point vertices.
  const [surfacePrimitive, pointPrimitive] = builder.gltf.meshes[0].primitives
  builder.gltf.meshes = [
    { name: 'Smooth hollow glass shell', primitives: [surfacePrimitive] },
    { name: 'Native branching IFS core', primitives: [pointPrimitive] },
  ]
  builder.gltf.nodes = [
    { name: 'Smooth hollow glass shell', mesh: 0 },
    { name: 'Native branching IFS core', mesh: 1 },
  ]
  builder.gltf.scenes[0].nodes = [0, 1]
  const { bytes, checked } = appendColors(builder.finish(), cloud.colors)
  assert.equal(checked.points, count)
  assert.equal(checked.textures, 3)
  const primitives = checked.gltf.meshes.flatMap((mesh) => mesh.primitives)
  assert.equal(primitives.filter((p) => p.mode === 0).length, 1)
  assert.equal(primitives.filter((p) => p.mode === 4).length, 1)
  const bounds = {
    min: [0, 1, 2].map((axis) =>
      Math.min(
        ...primitives.map(
          (p) => checked.gltf.accessors[p.attributes.POSITION].min[axis],
        ),
      ),
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(
        ...primitives.map(
          (p) => checked.gltf.accessors[p.attributes.POSITION].max[axis],
        ),
      ),
    ),
  }
  assert.equal(bounds.min[1], 0)
  assert(Math.abs(bounds.max[1] - 1.89) < 1e-6, 'Human-scale shell bounds')
  const json = `${JSON.stringify({ format: 'lumen-fractal-figurine-study', version: 1, studyId: 'blue-branch-pawn', side, flame }, null, 2)}\n`
  await writeFile(resolve(assets, `${stem}.glb`), bytes)
  await writeFile(resolve(assets, `${stem}.json`), json)
  const componentCounts = cloud.components.map(() => 0)
  for (const component of cloud.componentIds) componentCounts[component]++
  reports.push({
    file: `${stem}.glb`,
    recipeFile: `${stem}.json`,
    side,
    sha256: hash(bytes),
    recipeSha256: hash(json),
    bytes: bytes.length,
    nativePoints: count,
    triangles: checked.triangles,
    bounds,
    nativeCoreBounds: cloud.bounds,
    seed,
    burnIn,
    embeddedTextures: checked.textures,
    components: cloud.components.map((name, n) => ({
      name,
      points: componentCounts[n],
    })),
    checks:
      'Reparsed GLB/chunks/alignment/accessors/bounds/finite data/unit normals/materials/PNG signatures and every saved linear COLOR_0 value.',
  })
}

const sources = [
  'packages/app/src/flame/chess/blueBranchPawnFlame.ts',
  'packages/app/src/flame/chess/pawnFlame.ts',
  'packages/app/src/flame/chess/flameFigurineCloud.ts',
  'packages/app/src/flame/chess/pawnBoardGeometry.ts',
  'packages/app/src/flame/randomSource.ts',
  'packages/app/src/flame/clashTeams.ts',
  'packages/core/src/schema/walkGroups.ts',
  'packages/core/src/math/affineTransform3D.ts',
  'packages/app/scripts/export-blue-branch-pawn.mjs',
  'packages/app/scripts/pawn-board-glb.mjs',
]
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sources.map(async (path) => [
      path,
      hash(await readFile(resolve(repository, path))),
    ]),
  ),
)
await writeFile(
  resolve(assets, 'blue-branch-pawn-manifest.json'),
  `${JSON.stringify(
    {
      format: 'lumen-native-blue-branching-pawns',
      version: 1,
      sourceHashes,
      colorPolicy,
      units: 'metres',
      yUp: true,
      baseOnY: 0,
      shell: {
        ...shellOptions,
        topMetres: shellHeight,
        wallThicknessMetres: 0.018,
        ior: 1.5,
        transmission: 1,
        roughnessFactor: 0.055,
        microNormalScale: 0.025,
      },
      textures: {
        embedded: true,
        count: 3,
        size: [128, 128],
        maps: [
          'base-color (sRGB)',
          'occlusion/roughness/metallic (linear)',
          'tangent-space normal (linear)',
        ],
        note: 'ORM green multiplies roughnessFactor; metal remains zero. Fine micro-normal variation is deliberately minimal.',
      },
      runtimeFracture: {
        embeddedAnimation: false,
        generator: 'buildPawnShellFragments',
        radialSegments: 64,
        profileBands: 25,
        closedShardCount,
      },
      assets: reports,
      limitations: [
        'The core is 100,000 deterministic native affine IFS POINTS with linear vertex colours, not a solid branching triangle mesh. Importers choose point size; Blender imports loose vertices.',
        'The smooth closed hollow shell is a real triangle mesh. KHR_materials_transmission/ior/volume depend on viewer support, illumination and transparency policy; unsupported viewers may display opaque glass.',
        'Portable glass material extensions approximate the live screen-space two-wall absorption shader. Mutual glass refraction, exact multiple internal reflections and lighting-dependent caustics are not reproduced.',
        'Sampling uses the native affine/color recurrence and fixed component masses; CPU and GPU arithmetic are not bit-identical. Fixed-lightness export colours differ from density-based native preview grading.',
        'No fracture animation, collision or shard meshes are embedded. The live game generates 1600 closed glass shards from the same authored 64-segment grid.',
      ],
    },
    null,
    2,
  )}\n`,
)
console.log(
  JSON.stringify(
    {
      destination: assets,
      assets: reports.map(({ file, nativePoints, triangles, bytes }) => ({
        file,
        nativePoints,
        triangles,
        bytes,
      })),
    },
    null,
    2,
  ),
)
