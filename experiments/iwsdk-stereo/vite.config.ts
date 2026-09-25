// Keep the SDK renderer/emulator isolated from the production Solid app.
import { iwsdkDev } from '@iwsdk/vite-plugin-dev'
import { fileURLToPath } from 'node:url'
import typegpu from 'unplugin-typegpu/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [typegpu(), solid(), iwsdkDev()],
  server: {
    host: '0.0.0.0',
    port: 5187,
    strictPort: true,
    open: false,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  preview: { host: '0.0.0.0', port: 5188, strictPort: true },
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      'typegpu',
      '@typegpu/noise',
      'valibot',
      'solid-js',
    ],
    alias: {
      '@': fileURLToPath(new URL('../../packages/app/src', import.meta.url)),
      '@chaos-master/core': fileURLToPath(
        new URL(
          '../../packages/core/src/math/affineTransform3D.ts',
          import.meta.url,
        ),
      ),
    },
  },
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  build: { target: 'esnext' },
  base: './',
})
