// Compile the actual Vite-transformed shader: TypeScript alone cannot validate GPU handle aliases.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tgpu } from 'typegpu'
import typegpu from 'unplugin-typegpu/vite'
import { createServer } from 'vite'
import type * as BookDetailShader from '../src/almanac/bookDetailShader'
import type * as BookShaders from '../src/almanac/bookShaders'
import type * as SceneSurface from '../src/observatory/sceneSurface'
import type * as ModelShaders from '../src/observatory/shaders'
import type * as TempleMaterial from '../src/observatory/templeMaterial'

await test('book and architectural materials resolve through the production GPU transform without leaking unrelated detail', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const server = await createServer({
    configFile: false,
    envDir: false,
    root,
    plugins: [typegpu()],
    resolve: {
      dedupe: ['typegpu', '@typegpu/noise', 'valibot'],
      alias: {
        '@': fileURLToPath(
          new URL('../../../packages/app/src', import.meta.url),
        ),
        '@chaos-master/core': fileURLToPath(
          new URL(
            '../../../packages/core/src/math/affineTransform3D.ts',
            import.meta.url,
          ),
        ),
      },
    },
    optimizeDeps: { noDiscovery: true },
    // No HTTP port, browser, GPU, file watcher or dependency cache is needed.
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const shaders = (await server.ssrLoadModule(
      '/src/almanac/bookShaders.ts',
    )) as typeof BookShaders
    const details = (await server.ssrLoadModule(
      '/src/almanac/bookDetailShader.ts',
    )) as typeof BookDetailShader
    const scene = (await server.ssrLoadModule(
      '/src/observatory/sceneSurface.ts',
    )) as typeof SceneSurface
    const models = (await server.ssrLoadModule(
      '/src/observatory/shaders.ts',
    )) as typeof ModelShaders
    const temple = (await server.ssrLoadModule(
      '/src/observatory/templeMaterial.ts',
    )) as typeof TempleMaterial
    const plain = tgpu.resolve([shaders.bookVertex, shaders.bookFragment])
    const textured = tgpu.resolve([shaders.bookVertex, shaders.bookFragment], {
      config: (config) =>
        config
          .with(details.bookDetailSlot, details.texturedBookSurface)
          .with(details.bookDetailedSlot, true),
    })
    assert.match(
      plain,
      /@fragment/,
      'the test must resolve the actual entry point',
    )
    assert.doesNotMatch(plain, /textureSampleGrad|texture_2d_array/)
    assert.equal((textured.match(/textureSampleGrad\(/g) ?? []).length, 3)
    assert.match(textured, /texture_2d_array<f32>/)
    const legacyGrain = /\b(?:fibers|bands|pebbles|burnish)\b/
    assert.match(
      plain,
      legacyGrain,
      'unrelated model materials keep their established shader',
    )
    assert.doesNotMatch(
      textured,
      legacyGrain,
      'the authored maps must replace the old sine grain',
    )
    const bindingGutter = /smoothstep\(0f, 0\.03f, abs\(local\.x\)\)/
    assert.match(textured, bindingGutter, 'the book retains its binding shadow')
    for (const [name, fragment, finish] of [
      ['observatory', shaders.bookFragment, scene.OBSERVATORY_FINISH],
      ['temple', temple.templeFragment, scene.TEMPLE_FINISH],
    ] as const) {
      const resolved = tgpu.resolve([models.modelVertex, fragment], {
        config: (config) =>
          config
            .with(details.bookDetailSlot, details.texturedBookSurface)
            .with(details.bookDetailedSlot, true)
            .with(details.surfaceKindSlot, scene.sceneSurfaceKind)
            .with(details.surfaceFinishSlot, finish)
            .with(details.bookBindingSlot, false),
      })
      assert.match(
        resolved,
        /@vertex/,
        `${name} uses the real model entry point`,
      )
      assert.match(
        resolved,
        /@fragment/,
        `${name} uses the real material entry point`,
      )
      assert.equal(
        (resolved.match(/textureSampleGrad\(/g) ?? []).length,
        3,
        name,
      )
      assert.match(resolved, /texture_2d_array<f32>/, name)
      assert.match(resolved, /fn sceneSurfaceKind\(/, name)
      assert.doesNotMatch(resolved, /fn bookSurfaceKind\(/, name)
      assert.doesNotMatch(resolved, legacyGrain, name)
      assert.doesNotMatch(
        resolved,
        /\b(?:grainCoordinates|veinCoordinate)\b/,
        name,
      )
      assert.doesNotMatch(
        resolved,
        bindingGutter,
        'architecture must not acquire a book spine',
      )
    }
    const plainTemple = tgpu.resolve([
      models.modelVertex,
      temple.templeFragment,
    ])
    assert.doesNotMatch(plainTemple, /textureSampleGrad|texture_2d_array/)
    assert.match(
      plainTemple,
      /\bgrainCoordinates\b/,
      'the optional untextured temple keeps its fallback finish',
    )
  } finally {
    await server.close()
  }
})
