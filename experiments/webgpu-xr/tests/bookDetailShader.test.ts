// Compile the actual Vite-transformed shader: TypeScript alone cannot validate GPU handle aliases.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tgpu } from 'typegpu'
import typegpu from 'unplugin-typegpu/vite'
import { createServer } from 'vite'
import type * as BookDetailShader from '../src/almanac/bookDetailShader'
import type * as BookShaders from '../src/almanac/bookShaders'

await test('book material variants resolve through the production GPU transform without leaking texture work', async () => {
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
  } finally {
    await server.close()
  }
})
