import { defineConfig } from 'astro/config'

// Static marketing site. Output goes to `dist/` (matches the repo .gitignore and
// the Cloudflare static-assets deploy in wrangler.jsonc). The app itself lives in
// packages/app and is deployed separately to the root domain.
export default defineConfig({
  site: 'https://www.chaos-master.com',
  output: 'static',
  build: {
    format: 'directory',
  },
})
