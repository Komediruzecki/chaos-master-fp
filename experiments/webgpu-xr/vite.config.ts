// HTTPS lab with native XR only; imported app math uses this pinned compiler.
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'
import typegpu from 'unplugin-typegpu/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [basicSsl(), typegpu(), solid()],
  resolve: {
    dedupe: ['typegpu', '@typegpu/noise', 'valibot', 'solid-js'],
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
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
})
