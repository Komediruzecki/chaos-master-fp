/** Export new nonlinear native recipes and coloured POINTS without rewriting prior assets. */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFlameFigurineGlb, validateFlameFigurineGlb, } from './flame-figurine-glb.mjs'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(app, '../..')
const assets = resolve(repository, 'assets')
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export { FLAME_FIGURINES, buildFlameFigurine } from './src/flame/chess/flameFigurines'; export { sampleFlameFigurineCloud, FLAME_FIGURINE_EXPORT_LIGHTNESS } from './src/flame/chess/flameFigurineCloud';",
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
const temporary = await mkdtemp(resolve(tmpdir(), 'lumen-flame-figurines-'))
let native
try {
  const compiled = resolve(temporary, 'flames.cjs')
  await writeFile(compiled, bundle.outputFiles[0].text)
  native = require(compiled)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const seed = 0x666c616d
const reports = []
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const colorPolicy = {
  source:
    'Native transform OkLab a/b recurrence, including colorSpeed and authored vibrancy.',
  fixedLightness: native.FLAME_FIGURINE_EXPORT_LIGHTNESS,
  conversion:
    '@typegpu/color oklabToLinearRgb; clamp linear channels into [0,1].',
  encoding:
    'FLOAT32 linear RGBA COLOR_0, alpha=1; white KHR_materials_unlit material.',
  difference:
    'Live GPU grading averages colors per pixel and derives lightness from sample density, exposure and tone mapping. Export colors are structural fixed-lightness previews, not pixel matches.',
}
await mkdir(assets, { recursive: true })
for (const study of native.FLAME_FIGURINES) {
  for (const side of ['light', 'dark']) {
    const flame = native.buildFlameFigurine(study.id, side)
    const palette = side === 'light' ? 'authored' : 'alternate'
    const stem = `fractal-flame-${study.id}-${palette}`
    const cloud = native.sampleFlameFigurineCloud(flame, {
      count: 48_000,
      seed,
    })
    const positions = new Float32Array(cloud.count * 3)
    for (let index = 0; index < cloud.count; index++)
      for (let axis = 0; axis < 3; axis++)
        positions[index * 3 + axis] = cloud.points[index * 4 + axis]
    const bytes = createFlameFigurineGlb({
      name: `${study.name} / ${palette}`,
      positions,
      colors: cloud.colors,
      extras: {
        kind: 'nonlinear-fractal-flame-figurine',
        studyId: study.id,
        side,
        units: 'metres',
        yUp: true,
        nativeFlame: flame,
        pointCloud: {
          count: cloud.count,
          seed,
          burnIn: flame.renderSettings.skipIters,
          reconstructedSurface: false,
        },
        colorPolicy: {
          ...colorPolicy,
          vibrancy: flame.renderSettings.vibrancy,
        },
        fracture: {
          embeddedAnimation: false,
          suggestedStructure: study.fractureHint,
        },
      },
    })
    const checked = validateFlameFigurineGlb(bytes)
    const recipe = `${JSON.stringify({ format: 'lumen-fractal-figurine-study', version: 1, studyId: study.id, side, flame }, null, 2)}\n`
    await writeFile(resolve(assets, `${stem}.glb`), bytes)
    await writeFile(resolve(assets, `${stem}.json`), recipe)
    const componentCounts = cloud.components.map(() => 0)
    for (const component of cloud.componentIds) componentCounts[component]++
    reports.push({
      file: `${stem}.glb`,
      recipeFile: `${stem}.json`,
      studyId: study.id,
      side,
      palette,
      sha256: hash(bytes),
      recipeSha256: hash(recipe),
      bytes: bytes.length,
      points: checked.points,
      coloredPoints: checked.coloredPoints,
      triangles: checked.triangles,
      bounds: cloud.bounds,
      colorBounds: checked.colorBounds,
      seed,
      burnIn: flame.renderSettings.skipIters,
      components: cloud.components.map((name, index) => ({
        name,
        points: componentCounts[index],
      })),
    })
  }
}
const sources = [
  'packages/app/src/flame/chess/flameFigurines.ts',
  'packages/app/src/flame/chess/flameFigurineCloud.ts',
  'packages/app/scripts/export-flame-figurines.mjs',
  'packages/app/scripts/flame-figurine-glb.mjs',
  'packages/app/scripts/pawn-board-glb.mjs',
  'packages/app/src/flame/variations/simple3D/index.ts',
  'packages/app/src/flame/constants.ts',
  'packages/app/src/flame/clashTeams.ts',
  'packages/app/src/flame/randomSource.ts',
  'packages/core/src/math/affineTransform3D.ts',
  'packages/core/src/schema/walkGroups.ts',
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
  resolve(assets, 'flame-figurines-manifest.json'),
  `${JSON.stringify(
    {
      format: 'lumen-fractal-flame-figurines',
      version: 1,
      sourceHashes,
      colorPolicy,
      assets: reports,
      limitations: [
        'Finite deterministic CPU samples of the selected native nonlinear maps are glTF POINTS, not reconstructed triangle surfaces. Importers choose point size; Blender imports loose vertices.',
        'CPU sampling follows native pre-affine, externally weighted variation sum, post-affine and colour recurrence, with independent walkGroup components. CPU trigonometry and GPU Float32 arithmetic are not bit-identical.',
        'The live /figurines preview uses the accumulating native renderer and descriptors, not the sampled GLBs. Exported fixed-lightness vertex colours do not reproduce density-dependent GPU grading.',
        'No glass shell, normals, collision solid or fracture animation is embedded. These are nonlinear visual attractor studies; PBR surface materials require a chosen finite-thickness surface.',
      ],
    },
    null,
    2,
  )}\n`,
)
console.log(
  JSON.stringify(
    reports.map(({ file, points, coloredPoints, bytes }) => ({
      file,
      points,
      coloredPoints,
      bytes,
    })),
    null,
    2,
  ),
)
