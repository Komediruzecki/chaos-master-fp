/**
 * Generate static flame posters for the landing's poster fallback.
 *
 * Renders each flame from the REAL Flam3 renderer (via the dev-only
 * /poster-capture page) and screenshots the converged canvas to
 * public/posters/<name>.jpg. Headless has no WebGPU on this box, so it drives a
 * HEADED Chromium (see [[webgpu-verify-headed-playwright]]).
 *
 * Run:
 *   pnpm --filter @chaos-master/landing dev        # in one terminal
 *   node packages/landing/scripts/capture-posters.mjs [baseURL]
 *
 * baseURL defaults to http://localhost:4321 (astro dev). The flame names must
 * match the keys of LANDING_FLAMES in src/lib/flame.ts.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/posters')
const BASE = process.argv[2] ?? 'http://localhost:4321'
const SIZE = 1280
const QUALITY_TARGET = 0.97
const NAMES = [
  'example1',
  'example29',
  'example33',
  'example40',
  'example45',
  'rose',
  'earth',
]

mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
})
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('error') || t.includes('Error') || t.includes('WebGPU')) {
    console.log(`  [page] ${t}`)
  }
})

let failures = 0
for (const name of NAMES) {
  const url = `${BASE}/poster-capture?name=${name}&size=${SIZE}`
  process.stdout.write(`capturing ${name} ... `)
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForSelector('canvas', { timeout: 30000 })
    // Astro's dev toolbar is fixed at the bottom-center and would bleed into the
    // canvas screenshot (locator.screenshot clips the composited page). Hide it.
    await page.addStyleTag({
      content: 'astro-dev-toolbar{display:none!important}',
    })
    // Wait for the flame to actually converge (quality getter exposed by the
    // capture island), not just the first frame.
    await page.waitForFunction(
      (target) => {
        const w = /** @type {any} */ (window)
        if (w.__captureError) throw new Error(w.__captureError)
        return (
          typeof w.__captureQuality === 'function' &&
          w.__captureQuality() >= target
        )
      },
      QUALITY_TARGET,
      { timeout: 60000, polling: 250 },
    )
    // Small settle so the last accumulation/postprocess frame is presented.
    await page.waitForTimeout(600)
    const out = resolve(OUT_DIR, `${name}.jpg`)
    await page
      .locator('canvas')
      .screenshot({ path: out, type: 'jpeg', quality: 92 })
    console.log(`ok -> ${out}`)
  } catch (err) {
    failures += 1
    console.log(`FAILED: ${err.message}`)
  }
}

await browser.close()
console.log(
  failures ? `\n${failures} poster(s) failed.` : '\nAll posters captured.',
)
process.exit(failures ? 1 : 0)
