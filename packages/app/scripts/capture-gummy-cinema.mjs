#!/usr/bin/env node
/** Capture the real gummy cinema on a fixed frame grid with a hardware WebGPU browser. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { reserveCaptureDirectory, verifyBrowserIsolation, verifyCaptureMedia, verifySurfaceCapacity, } from './gummy-cinema-capture-checks.mjs'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://localhost:5199/gummy' },
    shot: { type: 'string', default: 'pawn-knight' },
    out: { type: 'string' },
    config: { type: 'string' },
    width: { type: 'string', default: '1920' },
    height: { type: 'string', default: '1080' },
    fps: { type: 'string', default: '60' },
    seconds: { type: 'string' },
    stills: { type: 'string' },
    diagnostics: { type: 'boolean', default: false },
    bitrate: { type: 'string', default: '30000000' },
    timeout: { type: 'string', default: '180' },
    help: { type: 'boolean', default: false },
  },
})
if (values.help) {
  console.info(
    'Run under video-kit/scripts/gpu-guard. Options: --url --shot --out DIR [--config JSON] [--width 1920 --height 1080 --fps 60 --seconds N --bitrate 30000000 --timeout 180] [--stills 0,180,360,480 --diagnostics]. Stills saves exact canvas PNGs instead of a video. Diagnostics saves particle snapshots at each still for tear-timing comparisons. Requires the dev cinema API; video requires WebCodecs with no real-time fallback.',
  )
  process.exit(0)
}
assert.ok(values.out, '--out is required')
const width = Number(values.width),
  height = Number(values.height),
  fps = Number(values.fps)
const timeout = Number(values.timeout),
  bitrate = Number(values.bitrate)
assert.ok(
  Number.isInteger(width) && width >= 320 && width <= 3840 && width % 2 === 0,
)
assert.ok(
  Number.isInteger(height) &&
    height >= 320 &&
    height <= 3840 &&
    height % 2 === 0,
)
assert.ok([30, 60].includes(fps), 'Capture supports 30 or 60 fps')
assert.ok(Number.isFinite(timeout) && timeout >= 30 && timeout <= 900)
assert.ok(
  Number.isFinite(bitrate) && bitrate >= 1_000_000 && bitrate <= 100_000_000,
)
const requestedSeconds =
  values.seconds === undefined ? undefined : Number(values.seconds)
assert.ok(
  requestedSeconds === undefined ||
    (Number.isFinite(requestedSeconds) &&
      requestedSeconds > 0 &&
      requestedSeconds <= 60),
)
const stillFrames = values.stills?.split(',').map(Number)
assert.ok(
  !stillFrames ||
    (stillFrames.length > 0 &&
      stillFrames.every(
        (frame) => Number.isInteger(frame) && frame >= 0 && frame <= 60 * fps,
      )),
  'Still frames must be non-negative integers',
)
const output = path.resolve(values.out)
reserveCaptureDirectory(output)
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = createRequire(path.join(appRoot, 'package.json'))(
  'playwright',
)
const shot = values.config
  ? JSON.parse(readFileSync(path.resolve(values.config), 'utf8'))
  : undefined
const url = new URL(values.url)
url.searchParams.set('view', 'cinema')
url.searchParams.set('shot', values.shot)
url.searchParams.set('clean', '1')
const report = {
  url: url.href,
  width,
  height,
  fps,
  bitrate,
  requestedSeconds,
  stillFrames,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: appRoot,
    encoding: 'utf8',
  }).trim(),
  workspaceDirty:
    execFileSync('git', ['status', '--porcelain'], {
      cwd: appRoot,
      encoding: 'utf8',
    }).trim().length > 0,
  startedAt: new Date().toISOString(),
  errors: [],
  warnings: [],
  encodedFrames: 0,
  physicalIOSTested: false,
  stage: 'starting',
}
const reportPath = path.join(output, 'capture.json')
const save = () => {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}
const hypr = (command) =>
  JSON.parse(execFileSync('hyprctl', ['-j', command], { encoding: 'utf8' }))
const desktopBefore = {
  activeWindow: hypr('activewindow').address,
  activeWorkspace: hypr('activeworkspace').id,
}
const clientsBefore = new Set(hypr('clients').map((client) => client.address))
let browser, page, timer
try {
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
    args: [
      '--class=agent-browser',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  timer = setTimeout(() => {
    report.failure = `Capture exceeded ${timeout} seconds`
    save()
    void browser.close()
  }, timeout * 1000)
  page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width, height },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  })
  page.setDefaultTimeout(15_000)
  await page.addInitScript(() => {
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu)
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args)
      if (adapter)
        window.__gummyCaptureAdapter = {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
          fallback: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter,
        }
      return adapter
    }
  })
  page.on('pageerror', (error) => {
    report.errors.push(String(error))
    save()
  })
  page.on('console', (message) => {
    const harmlessFavicon =
      message.text().includes('404') &&
      message.location().url.endsWith('/favicon.ico')
    if (message.type() === 'error' && !harmlessFavicon)
      report.errors.push(message.text())
    if (message.type() === 'warning') report.warnings.push(message.text())
    save()
  })
  await page.exposeFunction('__gummyCaptureProgress', (progress) => {
    Object.assign(report, progress)
    save()
  })
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  const ready = async () => {
    await page.waitForFunction(
      () => {
        const info = window.__gummyCinema?.info()
        return info?.ready || info?.error
      },
      null,
      { polling: 100, timeout: 60_000 },
    )
    const info = await page.evaluate(() => window.__gummyCinema.info())
    assert.ok(!info.error, info.error)
  }
  await ready()
  if (shot) {
    await page.evaluate(async (config) => {
      await window.__gummyCinema.configure(config)
    }, shot)
    await ready()
  }
  // Renderer creation can finish before the first ResizeObserver delivery.
  await page.waitForFunction(
    ({ width, height }) => {
      const canvas = document.querySelector('canvas')
      return canvas?.width === width && canvas?.height === height
    },
    { width, height },
    { polling: 100, timeout: 15_000 },
  )
  const clients = hypr('clients').filter(
    (client) => !clientsBefore.has(client.address),
  )
  const activeWindow = hypr('activewindow')
  const activeWorkspace = hypr('activeworkspace')
  report.desktopIsolation = {
    before: desktopBefore,
    after: {
      activeWindow: activeWindow.address,
      activeWindowClass: activeWindow.class,
      activeWorkspace: activeWorkspace.id,
      activeWorkspaceName: activeWorkspace.name,
    },
    browserWindows: clients.map((client) => ({
      address: client.address,
      class: client.class,
      workspace: client.workspace.name,
    })),
  }
  report.foregroundChanged = verifyBrowserIsolation({
    before: desktopBefore,
    ownedWindows: clients,
    activeWindow,
    activeWorkspace,
    monitors: hypr('monitors'),
  })
  report.adapter = await page.evaluate(() => window.__gummyCaptureAdapter)
  assert.ok(
    report.adapter &&
      !report.adapter.fallback &&
      !/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)),
    'A hardware WebGPU adapter is required',
  )
  report.initial = await page.evaluate(() => window.__gummyCinema.info())
  report.recipe = await page.evaluate(() => window.__gummyCinema.recipe())
  writeFileSync(
    path.join(output, 'recipe.json'),
    `${JSON.stringify(report.recipe, null, 2)}\n`,
  )
  if (stillFrames) {
    report.stage = 'stills'
    report.stills = []
    await page.evaluate(() => window.__gummyCinema.resetPaused())
    for (const frame of stillFrames) {
      assert.ok(
        frame / fps <= report.initial.displayDuration,
        'Still frame is beyond the shot duration',
      )
      const snapshot = await page.evaluate(
        async ({ frame, fps, width, height }) => {
          const api = window.__gummyCinema
          await api.seekFrame(frame, fps)
          await api.render()
          const canvas = document.querySelector('canvas')
          if (!canvas || canvas.width !== width || canvas.height !== height)
            throw new Error('Unexpected canvas size')
          return {
            png: canvas.toDataURL('image/png').split(',')[1],
            info: api.info(),
          }
        },
        { frame, fps, width, height },
      )
      const filename = `frame-${String(frame).padStart(5, '0')}.png`
      writeFileSync(
        path.join(output, filename),
        Buffer.from(snapshot.png, 'base64'),
      )
      report.stills.push({ frame, filename, info: snapshot.info })
      if (values.diagnostics) {
        const state = await page.evaluate(async () => {
          const current = await window.__gummyCinema.readState()
          return Object.fromEntries(
            Object.entries(current).map(([key, value]) => [
              key,
              ArrayBuffer.isView(value) ? Array.from(value) : value,
            ]),
          )
        })
        const stateFile = `state-${String(frame).padStart(5, '0')}.json`
        writeFileSync(path.join(output, stateFile), JSON.stringify(state))
        report.stills.at(-1).stateFile = stateFile
      }
      save()
    }
  } else {
    report.stage = 'encoding'
    save()
    const downloadPromise = page.waitForEvent('download', {
      timeout: timeout * 1000,
    })
    // Attach a handler immediately so an encoding error cannot leave an unhandled timeout.
    void downloadPromise.catch(() => {})
    report.encoding = await page.evaluate(
      async (options) => {
        const api = window.__gummyCinema
        const { createVideoEncoder } =
          await import('/src/utils/videoEncoder.ts')
        const canvas = document.querySelector('canvas')
        if (!canvas || document.querySelectorAll('canvas').length !== 1)
          throw new Error('Clean cinema must own one canvas')
        await api.resetPaused()
        await api.seekFrame(0, options.fps)
        await api.render()
        if (canvas.width !== options.width || canvas.height !== options.height)
          throw new Error(
            `Expected ${options.width}x${options.height}, got ${canvas.width}x${canvas.height}`,
          )
        const info = api.info()
        const seconds =
          options.seconds ??
          info.displayDuration ??
          info.config.displayDuration ??
          info.config.duration
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60)
          throw new Error('Missing valid display duration')
        const count = Math.round(seconds * options.fps)
        const encoder = await createVideoEncoder({
          codec: 'avc',
          width: options.width,
          height: options.height,
          fps: options.fps,
          bitrate: options.bitrate,
        })
        if (encoder.usedFallback) {
          encoder.cancel()
          throw new Error(
            'Deterministic capture needs WebCodecs; MediaRecorder fallback is disabled',
          )
        }
        if (encoder.codec !== 'avc') {
          encoder.cancel()
          throw new Error(
            `Native capture requires AVC/H.264; encoder selected ${encoder.codec}`,
          )
        }
        try {
          for (let frame = 0; frame < count; frame++) {
            await api.seekFrame(frame, options.fps)
            await api.render()
            await encoder.encodeFrame(
              await window.createImageBitmap(canvas),
              frame,
            )
            if (frame % 30 === 0 || frame + 1 === count)
              await window.__gummyCaptureProgress({
                encodedFrames: frame + 1,
                totalFrames: count,
                lastFrame: api.info(),
              })
          }
          const result = await encoder.finalize()
          const blobURL = URL.createObjectURL(result.blob)
          const link = document.createElement('a')
          link.href = blobURL
          link.download = 'capture.mp4'
          link.click()
          window.setTimeout(() => {
            URL.revokeObjectURL(blobURL)
          }, 10_000)
          return {
            frames: count,
            seconds: count / options.fps,
            bytes: result.blob.size,
            codec: encoder.codec,
            mimeType: result.mimeType,
            usedFallback: result.usedFallback,
            final: api.info(),
          }
        } catch (error) {
          encoder.cancel()
          throw error
        }
      },
      { width, height, fps, bitrate, seconds: requestedSeconds },
    )
    const download = await downloadPromise
    const videoPath = path.join(output, 'capture.mp4')
    await download.saveAs(videoPath)
    assert.ok(statSync(videoPath).size > 1000)
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-count_frames',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          videoPath,
        ],
        {
          env: { ...process.env, LC_ALL: 'C' },
          encoding: 'utf8',
          timeout: 30_000,
        },
      ),
    )
    report.probe = verifyCaptureMedia(probe, {
      width,
      height,
      fps,
      frames: report.encoding.frames,
      seconds: report.encoding.seconds,
    })
  }
  report.surface = await page.evaluate(() =>
    window.__gummyCinema.readSurfaceStats(),
  )
  verifySurfaceCapacity(report.surface)
  report.renderStats = await page.evaluate(() =>
    window.__gummyCinema.readRenderStats(),
  )
  report.physics = await page.evaluate(async () => {
    const api = window.__gummyCinema
    const state = await api.readState()
    const fields = [
      'positions',
      'velocities',
      'deformation',
      'damage',
      'plasticStrain',
      'volumetricOpening',
      'J',
    ]
    const finite = fields.every((key) =>
      Array.from(state[key]).every(Number.isFinite),
    )
    return {
      finite,
      particles: state.positions.length / 4,
      guardActivations: state.guardActivations,
      domainContacts: state.domainContacts,
      maxPlasticStrain: state.maxPlasticStrain,
      maxVolumetricOpening: state.maxVolumetricOpening,
      error: api.info().error,
    }
  })
  assert.ok(
    report.physics.finite,
    'The captured simulation has non-finite state',
  )
  assert.ok(!report.physics.error, report.physics.error)
  assert.deepEqual(report.errors, [], 'Browser reported errors during capture')
  report.stage = 'complete'
  report.passed = true
} catch (error) {
  report.failure ??= String(error)
  if (String(error).includes('This shot has been replaced'))
    report.retryNote =
      'The source or recipe changed during capture. Wait for source changes to finish, then run again into a new output directory.'
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(output, 'failure.png'), timeout: 3000 })
      .catch(() => {})
  throw error
} finally {
  clearTimeout(timer)
  await browser?.close()
  report.closedAt = new Date().toISOString()
  save()
  console.info(reportPath)
}
