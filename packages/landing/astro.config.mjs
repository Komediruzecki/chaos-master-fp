import solid from '@astrojs/solid-js'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'
import typegpu from 'unplugin-typegpu/vite'
import { qrcode } from 'vite-plugin-qrcode'

// The live GPU flame islands import the real renderer out of `packages/app`
// (Root / AutoCanvas / Camera2D / Flam3). Those modules use the app's own `@/`
// alias and are transformed at build time by `unplugin-typegpu` + the Solid
// compiler — so we mirror that here. The `@` alias only matches `@/…` (not
// `@typegpu/*` / `@astrojs/*`), so it's safe to point at the app's src.
const appSrc = fileURLToPath(new URL('../app/src', import.meta.url))
const stub = (p) =>
  fileURLToPath(new URL(`./src/flame/stubs/${p}`, import.meta.url))

// Static marketing site. Output goes to `dist/` (matches the repo .gitignore and
// the Cloudflare static-assets deploy in wrangler.jsonc). The app itself lives in
// packages/app and is deployed separately to the root domain.
export default defineConfig({
  site: 'https://about.chaos-master.com',
  output: 'static',
  build: {
    format: 'directory',
  },
  // Expose the dev server on the LAN so phones/tablets can reach it; the qrcode
  // Vite plugin then prints a scannable QR of the Network URL on `pnpm start`
  // (same setup as the chaos-master app).
  server: {
    host: true,
  },
  integrations: [solid()],
  vite: {
    plugins: [typegpu({}), qrcode()],
    resolve: {
      // Array form so the specific stub entries win over the general `@` prefix
      // (first match wins). `@` only matches `@/…`, never `@typegpu/*` etc.
      alias: [
        // Mock editor-only modules the live render path doesn't need — keeps the
        // @/icons barrel, ConsoleLog and version banner out of the bundle, and
        // lets the hero poster show as the non-WebGPU fallback.
        {
          find: '@/components/ErrorHandling/ErrorHandling',
          replacement: stub('ErrorHandling.tsx'),
        },
        { find: '@', replacement: appSrc },
      ],
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
    // The app's renderer (and solid-js) use modern syntax; downleveling to an
    // older target makes esbuild choke ("Transforming destructuring … not
    // supported"). Pin every esbuild pass to esnext — this is a WebGPU-only page
    // shipped to evergreen browsers anyway.
    build: {
      target: 'esnext',
    },
    esbuild: {
      target: 'esnext',
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
    },
  },
})
