/** Reproducible native IFS recipes and point-cloud GLBs for the figurine comparison. */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGlbBuilder, validatePawnBoardGlb } from './pawn-board-glb.mjs'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(app, '../..')
const assets = resolve(repository, 'assets')
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export { FIGURINE_STUDIES, buildFigurineStudy } from './src/flame/chess/figurineStudies'; export { samplePawnCloud } from './src/flame/chess/pawnCloud';",
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
const temporary = await mkdtemp(resolve(tmpdir(), 'lumen-figurine-studies-'))
let native
try {
  const compiled = resolve(temporary, 'studies.cjs')
  await writeFile(compiled, bundle.outputFiles[0].text)
  native = require(compiled)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const seed = 0x73747564
const reports = []
await mkdir(assets, { recursive: true })
for (const study of native.FIGURINE_STUDIES) {
  if (study.id === 'lattice-pawn') continue
  for (const side of ['light', 'dark']) {
    const flame = native.buildFigurineStudy(study.id, side)
    const colour = side === 'light' ? 'frost' : 'ember'
    const stem = `fractal-study-${study.id}-${colour}`
    const cloud = native.samplePawnCloud(flame, { count: 48_000, seed })
    const positions = new Float32Array(cloud.count * 3)
    for (let index = 0; index < cloud.count; index++)
      for (let axis = 0; axis < 3; axis++)
        positions[index * 3 + axis] = cloud.points[index * 4 + axis]
    const builder = createGlbBuilder(`${study.name} / ${colour}`, {
      kind: 'fractal-figurine-study',
      studyId: study.id,
      units: 'metres',
      yUp: true,
      nativeFlame: flame,
      pointCloud: { count: cloud.count, seed, reconstructedSurface: false },
      fracture: {
        embeddedAnimation: false,
        suggestedStructure: study.fractureHint,
      },
    })
    builder.gltf.extensionsUsed = ['KHR_materials_unlit']
    const tint = side === 'light' ? [0.3, 0.82, 0.92] : [1, 0.34, 0.09]
    builder.gltf.materials.push({
      name: `${study.name} native IFS points / ${colour}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...tint, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      emissiveFactor: tint,
      extensions: { KHR_materials_unlit: {} },
      extras: {
        pointSize:
          'Importer-dependent. No surface normals or optical shell are implied.',
      },
    })
    builder.primitive({ positions, material: 0, mode: 0 })
    const bytes = builder.finish()
    const checked = validatePawnBoardGlb(bytes)
    await writeFile(resolve(assets, `${stem}.glb`), bytes)
    await writeFile(
      resolve(assets, `${stem}.json`),
      `${JSON.stringify({ format: 'lumen-fractal-figurine-study', version: 1, studyId: study.id, side, flame }, null, 2)}\n`,
    )
    reports.push({
      file: `${stem}.glb`,
      recipeFile: `${stem}.json`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      points: checked.points,
      triangles: checked.triangles,
      bounds: cloud.bounds,
    })
  }
}
const sources = [
  'packages/app/src/flame/chess/figurineStudies.ts',
  'packages/app/src/flame/chess/pawnCloud.ts',
  'packages/app/scripts/export-figurine-studies.mjs',
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
  resolve(assets, 'figurine-studies-manifest.json'),
  `${JSON.stringify({ format: 'lumen-fractal-figurine-studies', version: 1, sourceHashes, assets: reports, limitations: ['These comparison assets contain finite samples of native IFS attractors as glTF POINTS. Importers choose point size; Blender imports them as loose vertices.', 'The live comparison uses the native accumulating IFS renderer, not these sampled GLBs.', 'These studies have no glass envelope, triangle surface, collision body or fracture animation. PBR surface textures require a chosen finite-thickness surface; the existing pawn PBR assets remain available.'] }, null, 2)}\n`,
)
console.log(
  JSON.stringify(
    reports.map(({ file, points, bytes }) => ({ file, points, bytes })),
    null,
    2,
  ),
)
