/**
 * Headless-Chrome flame renderer (PROOF OF CONCEPT).
 *
 * Renders a flame with the app's REAL built pipeline inside headless Chrome
 * (Dawn) instead of Deno's WebGPU. Motivation: Deno refuses any single GPU
 * buffer above ~36-126MB (machine dependent) even with gigabytes of VRAM free,
 * which caps server renders below 4K. Chrome on the same GPU allocates 1GB
 * buffers, so 4K/8K "just work".
 *
 * Bonus: it loads the production bundle (built by unplugin-typegpu), so there
 * is no runtime WGSL extraction and no client/server shader drift — the class
 * of bug that produced the $uses, GOLDEN_ANGLE and zoom regressions.
 *
 * Usage (from repo root, after `pnpm --filter chaos-master build`):
 *   node workers/render-worker/tools/chrome-render.mjs \
 *     --flame path/to/flame.json --out out.png \
 *     [--width 3840] [--height 2160] [--quality 0.95] \
 *     [--timeout 180] [--serve-port 4180] [--dist path/to/dist] [--headed]
 *
 * Exit codes: 0 render written, 1 render failed, 2 watchdog timeout.
 */

import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) {
      const next = arr[i + 1]
      acc.push([cur.slice(2), next?.startsWith('--') ? 'true' : next])
    }
    return acc
  }, []),
)

const FLAME = args.flame
const OUT = args.out ?? 'chrome-render.png'
const WIDTH = Number(args.width ?? 1280)
const HEIGHT = Number(args.height ?? 720)
const QUALITY = Number(args.quality ?? 0.9)
const PORT = Number(args['serve-port'] ?? 4180)
const HEADED = args.headed === 'true'
// The built app to serve. Defaults to the repo layout; the container passes
// --dist explicitly because its cwd is the worker directory, not the repo root.
const DIST = resolve(args.dist ?? join(process.cwd(), 'packages/app/dist'))
// Seconds on the CLI, milliseconds internally. Deliberately modest by default:
// an unconverged render should surface as a failure fast, not hold the GPU.
const TIMEOUT_MS = Number(args.timeout ?? 180) * 1000

if (!FLAME) {
  console.error('--flame <path/to/flame.json> is required')
  process.exit(1)
}

// Hard watchdog. Playwright's own timeouts do not cover a hung GPU process or a
// wedged Chrome; this guarantees the tool always releases the GPU and exits.
const watchdog = setTimeout(() => {
  console.error(
    `[chrome-render] WATCHDOG: no result after ${TIMEOUT_MS / 1000}s — killing chrome`,
  )
  process.exit(2)
}, TIMEOUT_MS + 30_000)

// WebGPU needs a SECURE context: file:// and about:blank are opaque origins
// where navigator.gpu is undefined. http://localhost counts as secure, so a
// tiny static server over the built dist is the simplest correct host.
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    // normalize + prefix check: the served tree is the build output only.
    const file = normalize(join(DIST, path === '/' ? 'index.html' : path))
    if (!file.startsWith(DIST)) throw new Error('traversal')
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(PORT, r))

const flame = JSON.parse(await readFile(resolve(FLAME), 'utf8'))

// --enable-features=Vulkan + --use-angle=vulkan are REQUIRED for hardware
// WebGPU in headless Chrome on Linux; without them requestAdapter() returns
// null. The backgrounding flags stop Chrome throttling an offscreen tab, which
// would otherwise stall the present pump behind the render loop.
const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // Containers default /dev/shm to 64MB, which a large canvas overruns —
    // Chrome then dies mid-render with a bare "Target closed".
    '--disable-dev-shm-usage',
  ],
})

const started = Date.now()
let exitCode = 0
try {
  // The viewport is deliberately NOT the render size. The canvas is sized by
  // `fixedResolution`, so a 4K render works behind a small window — and we read
  // pixels off the canvas itself rather than screenshotting the composited page
  // (Playwright's element screenshot clips at the viewport, which silently
  // capped any capture larger than the window).
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  })

  const pageErrors = []
  page.on('console', (m) => {
    const t = m.text()
    if (/error|webgpu|adapter|device/i.test(t)) console.error(`  [page] ${t}`)
  })
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('crash', () => pageErrors.push('renderer process crashed'))

  await page.goto(`http://localhost:${PORT}/headless.html`, {
    waitUntil: 'load',
    timeout: 30_000,
  })

  // Report the device actually in use, so a silent software fallback cannot
  // masquerade as a GPU render.
  const gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) return { error: 'no adapter' }
    return {
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      maxBufferSize: adapter.limits.maxBufferSize,
    }
  })
  console.error(`[chrome-render] gpu: ${JSON.stringify(gpu)}`)
  if (gpu.error) {
    throw new Error(`no WebGPU adapter in this chrome: ${gpu.error}`)
  }

  await page.evaluate(
    (job) => {
      window.__renderJob = job
    },
    { flame, width: WIDTH, height: HEIGHT, quality: QUALITY },
  )

  await page.waitForSelector('canvas', { timeout: 30_000 })

  // Poll manually rather than page.waitForFunction: a converging flame should
  // be OBSERVABLE while it runs. A stall then reads as "stuck at 12% of the
  // point budget", not as an anonymous timeout.
  const deadline = Date.now() + TIMEOUT_MS
  let points = 0
  let limit = 0
  let lastLog = 0
  for (;;) {
    const state = await page.evaluate(() => ({
      error: window.__renderError,
      gpu: window.__gpuStatus,
      points: window.__renderPoints ?? 0,
      limit:
        typeof window.__renderLimit === 'function' ? window.__renderLimit() : 0,
    }))
    if (state.error) throw new Error(`page: ${state.error}`)
    if (pageErrors.length) throw new Error(`page: ${pageErrors[0]}`)
    ;({ points, limit } = state)
    // The render loop stops once the accumulated points pass the budget for the
    // requested quality — the same test, so we finish exactly when it does.
    if (limit > 0 && points >= limit) break
    if (Date.now() > deadline) {
      throw new Error(
        `did not converge in ${TIMEOUT_MS / 1000}s ` +
          `(${points} of ${Math.round(limit)} points, gpu=${state.gpu})`,
      )
    }
    if (Date.now() - lastLog > 5_000) {
      lastLog = Date.now()
      const pct = limit > 0 ? ((points / limit) * 100).toFixed(1) : '0.0'
      console.error(
        `  [chrome-render] ${pct}% (${points}/${Math.round(limit)} points)` +
          ` t=${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
    }
    await page.waitForTimeout(400)
  }
  const convergedMs = Date.now() - started

  // Let the final post-process frame land before reading the canvas back.
  await page.waitForTimeout(400)

  // Read the canvas's own pixel buffer — the same `toBlob` path the in-app PNG
  // export uses (ExportJobHost.finalize), so a server render is byte-identical
  // to the client render at the same settings.
  const shot = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('canvas disappeared before capture')
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png', 1))
    if (!blob) throw new Error('canvas.toBlob returned null')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return { data: btoa(binary), width: canvas.width, height: canvas.height }
  })

  const png = Buffer.from(shot.data, 'base64')
  await writeFile(resolve(OUT), png)
  console.error(
    `[chrome-render] ${shot.width}x${shot.height} q=${QUALITY} -> ${OUT} ` +
      `(${(png.length / 1e6).toFixed(2)}MB, ${points} points, ` +
      `converged ${(convergedMs / 1000).toFixed(1)}s,` +
      ` total ${((Date.now() - started) / 1000).toFixed(1)}s)`,
  )
  if (shot.width !== WIDTH || shot.height !== HEIGHT) {
    console.error(
      `[chrome-render] WARNING: asked for ${WIDTH}x${HEIGHT}, canvas is ${shot.width}x${shot.height}`,
    )
  }
} catch (err) {
  exitCode = 1
  console.error(
    `[chrome-render] FAILED after ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}`,
  )
} finally {
  await browser.close().catch(() => {})
  server.close()
  clearTimeout(watchdog)
}
process.exit(exitCode)
