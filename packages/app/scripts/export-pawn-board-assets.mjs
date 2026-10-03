/** Rebuild metre-scale pawn/board GLBs directly from native recipe and shared shell sources. */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxVertices, createGlbBuilder, validatePawnBoardGlb, } from './pawn-board-glb.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const app = resolve(directory, '..')
const repository = resolve(app, '../..')
const assets = resolve(repository, 'assets')
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export { buildPawnFlame, DEFAULT_PAWN_RECIPE } from './src/flame/chess/pawnFlame'; export { buildStructuralPawnFlame, DEFAULT_STRUCTURAL_PAWN_RECIPE } from './src/flame/chess/structuralPawnFlame'; export { samplePawnCloud } from './src/flame/chess/pawnCloud'; export { buildPawnShellGeometry, PAWN_SHELL_FLOOR } from './src/flame/chess/pawnBoardGeometry';",
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
const temporary = await mkdtemp(resolve(tmpdir(), 'lumen-pawn-export-'))
let native
try {
  const compiled = resolve(temporary, 'native-pawn.cjs')
  await writeFile(compiled, bundle.outputFiles[0].text)
  native = require(compiled)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
const seed = 0x7061776e
const reports = []

function textures(builder) {
  return {
    colour: builder.texture('colour'),
    orm: builder.texture('orm'),
    normal: builder.texture('normal'),
  }
}

function attributes(vertices, stride, yOffset = 0) {
  const count = vertices.length / stride
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2)
  for (let n = 0; n < count; n++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[n * 3 + axis] =
        vertices[n * stride + axis] + (axis === 1 ? yOffset : 0)
      normals[n * 3 + axis] = vertices[n * stride + 3 + axis]
    }
    uvs[n * 2] =
      stride === 8
        ? vertices[n * stride + 6]
        : Math.atan2(positions[n * 3 + 2], positions[n * 3]) / (2 * Math.PI) +
          0.5
    uvs[n * 2 + 1] =
      stride === 8 ? vertices[n * stride + 7] : positions[n * 3 + 1] / 1.89
  }
  return { positions, normals, uvs }
}

async function save(name, builder, metadata) {
  const bytes = builder.finish()
  const report = validatePawnBoardGlb(bytes)
  await writeFile(resolve(assets, name), bytes)
  const positionBounds = report.gltf.meshes.flatMap((mesh) =>
    mesh.primitives.map(
      (primitive) => report.gltf.accessors[primitive.attributes.POSITION],
    ),
  )
  reports.push({
    file: name,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    points: report.points,
    triangles: report.triangles,
    embeddedTextures: report.textures,
    bounds: {
      min: [0, 1, 2].map((axis) =>
        Math.min(...positionBounds.map((position) => position.min[axis])),
      ),
      max: [0, 1, 2].map((axis) =>
        Math.max(...positionBounds.map((position) => position.max[axis])),
      ),
    },
    checks:
      'GLB header/chunks, byte alignment, buffer/accessor ranges, decoded finite data, bounds, normals, materials and texture signatures passed',
    ...metadata,
  })
}

await mkdir(assets, { recursive: true })
for (const form of ['echo', 'lattice'])
  for (const side of ['light', 'dark']) {
    const frost = side === 'light'
    const name = `fractal-pawn-${form}-${frost ? 'frost' : 'ember'}.glb`
    const recipe = {
      ...(form === 'echo'
        ? native.DEFAULT_PAWN_RECIPE
        : native.DEFAULT_STRUCTURAL_PAWN_RECIPE),
      side,
    }
    const flame = (
      form === 'echo' ? native.buildPawnFlame : native.buildStructuralPawnFlame
    )(recipe)
    const cloud = native.samplePawnCloud(flame, { count: 24_000, seed })
    const builder = createGlbBuilder(
      `${frost ? 'Frost' : 'Ember'} ${form} pawn`,
      {
        kind: 'pawn',
        units: 'metres',
        yUp: true,
        baseOnY: 0,
        form,
        recipe,
        nativeFlame: flame,
        pointCloud: {
          topology: 'glTF POINTS',
          count: cloud.count,
          seed,
          reconstructedSurface: false,
          nativeOriginOffset: [0, -native.PAWN_SHELL_FLOOR, 0],
        },
        glassFallbackMaterial: 2,
        fracture: {
          embeddedAnimation: false,
          runtimeGenerator: 'buildPawnShellFragments',
          closedShardCount: 800,
        },
      },
    )
    const maps = textures(builder)
    const tint = frost ? [0.3, 0.82, 0.92] : [1, 0.34, 0.09]
    const glassColour = frost ? [0.86, 0.96, 1] : [1, 0.89, 0.73]
    builder.gltf.extensionsUsed = [
      'KHR_materials_transmission',
      'KHR_materials_ior',
      'KHR_materials_volume',
      'KHR_materials_unlit',
    ]
    builder.gltf.materials.push(
      {
        name: `${frost ? 'Frost' : 'Ember'} glass`,
        alphaMode: 'OPAQUE',
        doubleSided: false,
        pbrMetallicRoughness: {
          baseColorFactor: [...glassColour, 1],
          metallicFactor: 0,
          roughnessFactor: 0.12,
          metallicRoughnessTexture: { index: maps.orm },
        },
        normalTexture: { index: maps.normal, scale: 0.08 },
        extensions: {
          KHR_materials_transmission: { transmissionFactor: 0.96 },
          KHR_materials_ior: { ior: 1.45 },
          KHR_materials_volume: {
            thicknessFactor: 0.018,
            attenuationDistance: 3,
            attenuationColor: glassColour,
          },
        },
        extras: { fallbackMaterial: 2 },
      },
      {
        name: `${frost ? 'Frost' : 'Ember'} native IFS points`,
        pbrMetallicRoughness: {
          baseColorFactor: [...tint, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        emissiveFactor: tint,
        extensions: { KHR_materials_unlit: {} },
        extras: {
          pointSize: 'glTF POINTS size is importer-dependent',
          reconstructedSurface: false,
        },
      },
      {
        name: `${frost ? 'Frost' : 'Ember'} alpha glass fallback`,
        alphaMode: 'BLEND',
        doubleSided: false,
        pbrMetallicRoughness: {
          baseColorFactor: [...glassColour, 0.22],
          metallicFactor: 0,
          roughnessFactor: 0.12,
          metallicRoughnessTexture: { index: maps.orm },
        },
        extras: {
          purpose:
            'Assign manually when optical-transmission extensions are unsupported; alpha coverage is an approximation.',
        },
      },
    )
    builder.primitive({
      ...attributes(
        native.buildPawnShellGeometry().vertices,
        6,
        -native.PAWN_SHELL_FLOOR,
      ),
      material: 0,
    })
    const positions = new Float32Array(cloud.count * 3)
    for (let n = 0; n < cloud.count; n++) {
      positions[n * 3] = cloud.points[n * 4]
      positions[n * 3 + 1] = cloud.points[n * 4 + 1] - native.PAWN_SHELL_FLOOR
      positions[n * 3 + 2] = cloud.points[n * 4 + 2]
    }
    builder.primitive({ positions, material: 1, mode: 0 })
    await save(name, builder, {
      form,
      side,
      seed,
      recipe,
      topology: 'closed glass triangle shell plus native IFS POINTS',
    })
  }

const board = createGlbBuilder('Pawn chess board', {
  kind: 'board',
  units: 'metres',
  yUp: true,
  baseOnY: 0,
  files: 8,
  ranks: 8,
  tileSpacing: 1.6,
  tileWidth: 1.586,
  runtimeOriginOffset: [0, 0.455, 0],
  tileTop: 0.515,
})
const maps = textures(board)
for (const { name, colour, metallic } of [
  { name: 'Pale tiles', colour: [0.11, 0.15, 0.18], metallic: 0.15 },
  { name: 'Dark tiles', colour: [0.029, 0.046, 0.064], metallic: 0.15 },
  { name: 'Board plinth', colour: [0.018, 0.031, 0.044], metallic: 0.65 },
])
  board.gltf.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [...colour, 1],
      metallicFactor: metallic,
      roughnessFactor: 0.65,
      baseColorTexture: { index: maps.colour },
      metallicRoughnessTexture: { index: maps.orm },
    },
    normalTexture: { index: maps.normal, scale: 0.16 },
  })
const squares = [[], []]
for (let rank = 0; rank < 8; rank++)
  for (let file = 0; file < 8; file++)
    squares[(file + rank) % 2].push(
      ...boxVertices(1.586, 0.14, 1.586, [
        (file - 3.5) * 1.6,
        0.445,
        (3.5 - rank) * 1.6,
      ]),
    )
for (let material = 0; material < 2; material++)
  board.primitive({ ...attributes(squares[material], 8), material })
board.primitive({
  ...attributes(boxVertices(13.26, 0.38, 13.26, [0, 0.19, 0]), 8),
  material: 2,
})
await save('fractal-pawn-board.glb', board, {
  layout: '8x8',
  tileSpacingMetres: 1.6,
  tileTopMetres: 0.515,
  baseSizeMetres: [13.26, 0.38, 13.26],
})

const sources = [
  'packages/app/src/flame/chess/pawnFlame.ts',
  'packages/app/src/flame/chess/structuralPawnFlame.ts',
  'packages/app/src/flame/chess/pawnCloud.ts',
  'packages/app/src/flame/chess/pawnBoardGeometry.ts',
  'packages/core/src/schema/walkGroups.ts',
  'packages/app/scripts/export-pawn-board-assets.mjs',
  'packages/app/scripts/pawn-board-glb.mjs',
]
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sources.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(resolve(repository, path)))
        .digest('hex'),
    ]),
  ),
)
await writeFile(
  resolve(assets, 'pawn-board-manifest.json'),
  `${JSON.stringify({ format: 'lumen-pawn-board-assets', version: 1, units: 'metres', nativeSourceHashes: sourceHashes, assets: reports, limitations: ['Native cores are glTF POINTS, not reconstructed triangle surfaces. Point size and point-material support depend on the importer.', 'Optical glass requires KHR_materials_transmission, ior and volume support. A named alpha fallback is bundled for manual substitution.', 'GLBs contain intact pawns; the app generates and animates closed glass shards at runtime.', 'The live board renderer uses a Fresnel transparency approximation; it does not evaluate these full PBR transmission materials.'] }, null, 2)}\n`,
)
console.log(
  JSON.stringify(
    reports.map(({ file, bytes, points, triangles, embeddedTextures }) => ({
      file,
      bytes,
      points,
      triangles,
      embeddedTextures,
    })),
    null,
    2,
  ),
)
