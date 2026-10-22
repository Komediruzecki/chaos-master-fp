// Bounded hardware-browser proof and production-graph listening samples for world ambience.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { ALMANAC_WORLDS } from '../src/almanac/catalog'
import { createJourneyStore, JOURNEY_STORAGE_KEY, } from '../src/journey/progress'
import type { BrowserContext, Page } from 'playwright'
import type { ObservatoryView } from '../src/observatory/scene'

interface ProofContext {
  state: AudioContextState
  created: number
  started: number
  ended: number
  live: number
  connectedVoices: number
  scheduledVoices: number
  teachingRms: number[]
  rms: number
}
interface AudioProof {
  holdResumes: boolean
  releaseResumes(): void
  sample(): ProofContext[]
}
declare global {
  interface Window {
    __soundscapeProof: AudioProof
  }
}

const admitted = process.env.VERIFY_OUT_DIR
assert.ok(admitted, 'Set VERIFY_OUT_DIR to an admitted run evidence directory')
const builtUi = process.env.VERIFY_BUILT_UI === '1'
const out = path.join(admitted, builtUi ? 'soundscapes-built' : 'soundscapes')
const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5192'
const errors: string[] = []
const captures: unknown[] = []
const report: Record<string, unknown> = {
  testedAt: new Date().toISOString(),
  base,
  status: 'running',
  errors,
  captures,
  nativeHeadsetTested: false,
  emittedProductionUi: builtUi,
  scope: builtUi
    ? 'Real controls in the emitted production build exercise gesture unlock, master volume, two world switches, keyboard mute and responsive header layouts without the development API. A passive audio observer measures signal and source lifecycle. This is desktop browser proof, not native visibility or headset acceptance.'
    : 'Real desktop controls and keyboard/touch events exercise the production audio graph. A passive output analyser and oscillator lifecycle observer measure signal and layer counts. Synthetic blur/hidden and held resume diagnostics are labelled. WAVs render the same production ambience graph offline; they are review samples, not subjective listening, native visibility, microphone, speaker or headset acceptance.',
  observer:
    'Immediate source bounds count oscillator connections, with scheduled start/stop diagnostics. Ended callback delivery can lag a synchronous disconnect. Settled checks still require exactly seven unfinished source lifecycles; muted checks require zero.',
  fixture:
    'Onboarding and both earned pages are seeded with the progress-store API for art/navigation inspection only. No genuine encounter completion or page earning is claimed.',
}
const store = createJourneyStore({ worlds: ALMANAC_WORLDS })
store.completeOnboarding()
store.completeWorld('glasswake')
store.completeWorld('tideweave')
const fixture = store.read().progress
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
const audio = (page: Page) =>
  page.evaluate(() => window.__observatory!.audio.snapshot())
const probe = (page: Page) =>
  page.evaluate(() => window.__soundscapeProof.sample())
const state = (page: Page) =>
  page.evaluate(() => window.__observatory!.runtime.snapshot())
let currentPage: Page | undefined

function desktop() {
  const active = JSON.parse(
    execFileSync('hyprctl', ['-j', 'activewindow'], { encoding: 'utf8' }),
  ) as { address?: string }
  const workspace = JSON.parse(
    execFileSync('hyprctl', ['-j', 'activeworkspace'], { encoding: 'utf8' }),
  ) as { id: number }
  const monitors = JSON.parse(
    execFileSync('hyprctl', ['-j', 'monitors'], { encoding: 'utf8' }),
  ) as { id: number; specialWorkspace: { name: string } }[]
  return {
    active: active.address,
    workspace: workspace.id,
    special: monitors.map((entry) => [entry.id, entry.specialWorkspace.name]),
  }
}
const foreground = process.env.HYPRLAND_INSTANCE_SIGNATURE
  ? desktop()
  : undefined
const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
  args: [
    '--class=agent-browser',
    ...(process.env.VERIFY_WAYLAND === '1' ? ['--ozone-platform=wayland'] : []),
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})

async function makeContext(touch = false) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: touch ? 390 : 1440, height: touch ? 844 : 950 },
    hasTouch: touch,
  })
  context.setDefaultTimeout(30000)
  await context.addInitScript(
    ({ key, progress }) => {
      localStorage.setItem(key, JSON.stringify(progress))
    },
    { key: JOURNEY_STORAGE_KEY, progress: fixture },
  )
  await context.addInitScript(() => {
    const Native = window.AudioContext
    const nativeConnect = Reflect.get(AudioNode.prototype, 'connect')
    const rows: {
      context: AudioContext
      observer: AnalyserNode
      created: number
      started: number
      ended: number
      live: Set<OscillatorNode>
      scheduled: Map<
        OscillatorNode,
        { start: number; stop: number; connected: boolean }
      >
      analysers: AnalyserNode[]
      taps: WeakSet<AudioNode>
    }[] = []
    const releases: (() => void)[] = []
    window.__soundscapeProof = {
      holdResumes: false,
      releaseResumes() {
        this.holdResumes = false
        while (releases.length) releases.shift()!()
      },
      sample() {
        return rows.map((row) => {
          const waveform = new Float32Array(row.observer.fftSize)
          row.observer.getFloatTimeDomainData(waveform)
          return {
            state: row.context.state,
            created: row.created,
            started: row.started,
            ended: row.ended,
            live: row.live.size,
            connectedVoices: Array.from(row.scheduled.values()).filter(
              (voice) => voice.connected && voice.start !== Infinity,
            ).length,
            scheduledVoices: Array.from(row.scheduled.values()).filter(
              (voice) =>
                voice.stop > row.context.currentTime &&
                voice.stop > voice.start,
            ).length,
            teachingRms: row.analysers.map((analyser) => {
              const values = new Float32Array(analyser.fftSize)
              analyser.getFloatTimeDomainData(values)
              return Math.sqrt(
                values.reduce((sum, value) => sum + value * value, 0) /
                  values.length,
              )
            }),
            rms: Math.sqrt(
              waveform.reduce((sum, value) => sum + value * value, 0) /
                waveform.length,
            ),
          }
        })
      },
    }
    Object.defineProperty(AudioNode.prototype, 'connect', {
      configurable: true,
      writable: true,
      value(...args: [AudioNode | AudioParam, number?, number?]) {
        const result = Reflect.apply(nativeConnect, this, args)
        const row = rows.find((entry) => entry.context === this.context)
        if (row && args[0] === row.context.destination && !row.taps.has(this)) {
          row.taps.add(this)
          Reflect.apply(nativeConnect, this, [row.observer])
        }
        return result
      },
    })
    window.AudioContext = new Proxy(Native, {
      construct(target, args) {
        const context = Reflect.construct(target, args) as AudioContext
        const observer = context.createAnalyser()
        observer.fftSize = 2048
        const row = {
          context,
          observer,
          created: 0,
          started: 0,
          ended: 0,
          live: new Set<OscillatorNode>(),
          scheduled: new Map<
            OscillatorNode,
            { start: number; stop: number; connected: boolean }
          >(),
          analysers: [] as AnalyserNode[],
          taps: new WeakSet<AudioNode>(),
        }
        rows.push(row)
        const createAnalyser = context.createAnalyser.bind(context)
        Object.defineProperty(context, 'createAnalyser', {
          value() {
            const analyser = createAnalyser()
            row.analysers.push(analyser)
            return analyser
          },
        })
        const createOscillator = context.createOscillator.bind(context)
        Object.defineProperty(context, 'createOscillator', {
          value() {
            const oscillator = Reflect.apply(createOscillator, context, [])
            row.created++
            const start = oscillator.start.bind(oscillator)
            const stop = oscillator.stop.bind(oscillator)
            const timing = { start: Infinity, stop: Infinity, connected: false }
            row.scheduled.set(oscillator, timing)
            const connect = oscillator.connect.bind(oscillator)
            const disconnect = oscillator.disconnect.bind(oscillator)
            Object.defineProperty(oscillator, 'connect', {
              value(
                ...connectArgs: [AudioNode | AudioParam, number?, number?]
              ) {
                timing.connected = true
                return Reflect.apply(connect, oscillator, connectArgs)
              },
            })
            Object.defineProperty(oscillator, 'disconnect', {
              value(...disconnectArgs: unknown[]) {
                if (!disconnectArgs.length) timing.connected = false
                Reflect.apply(disconnect, oscillator, disconnectArgs)
              },
            })
            Object.defineProperty(oscillator, 'start', {
              value(...startArgs: Parameters<OscillatorNode['start']>) {
                row.started++
                row.live.add(oscillator)
                timing.start = startArgs[0] ?? 0
                Reflect.apply(start, oscillator, startArgs)
              },
            })
            Object.defineProperty(oscillator, 'stop', {
              value(...stopArgs: Parameters<OscillatorNode['stop']>) {
                timing.stop = stopArgs[0] ?? 0
                Reflect.apply(stop, oscillator, stopArgs)
              },
            })
            oscillator.addEventListener('ended', () => {
              row.ended++
              row.live.delete(oscillator)
              row.scheduled.delete(oscillator)
            })
            return oscillator
          },
        })
        const resume = context.resume.bind(context)
        Object.defineProperty(context, 'resume', {
          value() {
            const resumed = Reflect.apply(resume, context, [])
            return resumed.then(() =>
              window.__soundscapeProof.holdResumes
                ? new Promise<void>((resolve) => releases.push(resolve))
                : undefined,
            )
          },
        })
        return context
      },
    })
  })
  return context
}

async function open(context: BrowserContext) {
  const page = await context.newPage()
  currentPage = page
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside|GPU validation|device lost/i.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await page.waitForFunction(
    () => {
      const value = window.__observatory?.runtime.snapshot()
      return (
        value?.error ||
        (value?.ready &&
          value.assets.every((entry) => entry.status === 'ready') &&
          value.bookDetail.status === 'ready' &&
          value.sceneDetail.status === 'ready' &&
          value.frame.submissions > 3)
      )
    },
    undefined,
    { timeout: 60000 },
  )
  const snapshot = await state(page)
  assert.ok(snapshot.ready, snapshot.error)
  assert.deepEqual(snapshot.errors, [])
  assert.ok(!/swiftshader|llvmpipe/i.test(snapshot.adapter), snapshot.adapter)
  await settled(page, 'overview')
  assert.deepEqual(
    await probe(page),
    [],
    'Fresh page must not create AudioContext before a sound gesture',
  )
  assert.equal((await audio(page)).ambience.enabled, false)
  assert.equal(
    await button(page, 'Enable ambience').getAttribute('aria-pressed'),
    'false',
  )
  return page
}

async function placement() {
  if (!foreground) return
  const cdp = await browser.newBrowserCDPSession()
  const processes = await cdp.send('SystemInfo.getProcessInfo')
  const pid = processes.processInfo.find(
    (entry) => entry.type === 'browser',
  )?.id
  await cdp.detach()
  assert.ok(pid)
  const clients = JSON.parse(
    execFileSync('hyprctl', ['-j', 'clients'], { encoding: 'utf8' }),
  ) as {
    pid: number
    address: string
    class: string
    workspace: { name: string }
  }[]
  const owned = clients.filter((client) => client.pid === pid)
  assert.ok(
    owned.length &&
      owned.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
    JSON.stringify(owned),
  )
  const current = desktop()
  assert.deepEqual(current.special, foreground.special)
  assert.ok(!owned.some((client) => client.address === current.active))
  report.placement = {
    hiddenAgentWorkspace: true,
    foregroundUnchanged: JSON.stringify(current) === JSON.stringify(foreground),
    note: 'User foreground changes are recorded. Owned browser windows must stay hidden and unfocused; CDP focus emulation is not native visibility proof.',
    pid,
  }
}

async function settled(page: Page, view: ObservatoryView) {
  await page.waitForFunction((expected) => {
    const value = window.__observatory!.runtime.snapshot()
    return (
      value.view === expected &&
      !value.passage.active &&
      value.passage.scene.view === expected
    )
  }, view)
}

async function ambient(page: Page, enabled: boolean) {
  await page.waitForFunction((expected) => {
    const value = window.__observatory!.audio.snapshot().ambience
    return (
      value.enabled === expected && !value.pending && value.active === expected
    )
  }, enabled)
}

async function quiet(page: Page) {
  await ambient(page, false)
  await delay(1000)
  const value = await probe(page)
  assert.ok(
    value.every(
      (entry) =>
        entry.live === 0 &&
        entry.connectedVoices === 0 &&
        entry.scheduledVoices === 0 &&
        entry.rms < 0.00001,
    ),
    JSON.stringify(value),
  )
}

async function capture(page: Page, name: string) {
  const layout = await page.evaluate(() => {
    const header = document
      .querySelector('.observatory-header')
      ?.getBoundingClientRect()
    const control = document
      .querySelector('.observatory-ambience')!
      .getBoundingClientRect()
    const controls = Array.from(
      document.querySelectorAll(
        '.observatory-header a, .observatory-header button',
      ),
      (element) => {
        const box = element.getBoundingClientRect()
        return {
          name:
            element.getAttribute('aria-label') ?? element.textContent?.trim(),
          x: box.x,
          right: box.right,
          y: box.y,
          bottom: box.bottom,
        }
      },
    )
    const overlaps = controls.some((first, index) =>
      controls.some(
        (second, other) =>
          other > index &&
          Math.min(first.right, second.right) - Math.max(first.x, second.x) >
            1 &&
          Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y) >
            1,
      ),
    )
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      control: {
        x: control.x,
        right: control.right,
        y: control.y,
        bottom: control.bottom,
        width: control.width,
        height: control.height,
      },
      header: header ? { x: header.x, right: header.right } : null,
      controls,
      overlaps,
    }
  })
  assert.equal(layout.overflow, false)
  assert.equal(layout.overlaps, false, JSON.stringify(layout.controls))
  assert.ok(
    layout.control.x >= 0 &&
      layout.control.right <= layout.width &&
      layout.control.y >= 0 &&
      layout.control.bottom <= layout.height,
  )
  assert.ok(layout.control.width >= 40 && layout.control.height >= 40)
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 15000 })
  captures.push({
    name,
    layout,
    audio: builtUi ? undefined : await audio(page),
    probe: await probe(page),
  })
}

async function controlsAndLayers(page: Page) {
  await button(page, 'Enable ambience').focus()
  await page.keyboard.press('Enter')
  await ambient(page, true)
  assert.equal(
    await button(page, 'Mute ambience').getAttribute('aria-pressed'),
    'true',
  )
  await delay(1100)
  const initial = await probe(page)
  assert.equal(initial.length, 1)
  assert.equal(initial[0].scheduledVoices, 7)
  assert.equal(initial[0].live, 7)
  assert.ok(initial[0].rms > 0.00001, JSON.stringify(initial))
  assert.equal(initial[0].teachingRms.length, 1)
  assert.ok(
    initial[0].teachingRms[0] < 0.00001,
    'The actual production teaching analyser must exclude ambience',
  )
  assert.equal(
    (await audio(page)).level,
    0,
    'Ambience alone must not pollute the teaching analyser',
  )
  assert.equal((await audio(page)).activeNote, null)
  const volume = page.getByRole('slider', { name: 'Volume', exact: true })
  await volume.focus()
  await page.keyboard.press('Home')
  await delay(350)
  assert.equal((await audio(page)).volume, 0)
  assert.ok(
    (await probe(page))[0].rms < 0.00001,
    'Master volume must mute ambience as well as the instrument',
  )
  await page.keyboard.press('End')
  await delay(350)
  assert.equal((await audio(page)).volume, 1)
  assert.ok((await probe(page))[0].rms > 0.00001)
  for (const id of [
    'Tideweave',
    'Glasswake',
    'Tideweave',
    'Glasswake',
    'Tideweave',
    'Glasswake',
  ]) {
    await button(page, id).click()
    assert.ok(
      (await probe(page))[0].connectedVoices <= 13,
      'Seven bank voices plus three cue and three briefly retiring cue voices must stay bounded',
    )
  }
  await delay(1100)
  assert.equal((await audio(page)).ambience.worldId, 'glasswake')
  const final = await probe(page)
  assert.equal(final.length, 1)
  assert.equal(final[0].scheduledVoices, 7)
  assert.equal(final[0].live, 7)
  await button(page, 'Inspect orb').click()
  await settled(page, 'inspect')
  assert.equal((await audio(page)).ambience.enabled, true)
  await page.keyboard.press('Escape')
  await settled(page, 'overview')
  await button(page, 'Hear this world').click()
  await page.waitForFunction(
    () =>
      window.__observatory!.audio.snapshot().playing &&
      window.__observatory!.audio.snapshot().ambience.ducked,
  )
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().level > 0,
  )
  await button(page, 'Stop motif').click()
  await page.waitForFunction(
    () => !window.__observatory!.audio.snapshot().ambience.ducked,
  )
  await delay(800)
  assert.equal((await audio(page)).ambience.active, true)
  assert.equal((await audio(page)).level, 0)
  assert.equal((await probe(page))[0].scheduledVoices, 7)
  assert.equal((await probe(page))[0].live, 7)
  await button(page, 'Mute ambience').focus()
  await page.keyboard.press('Enter')
  await quiet(page)
  report.controls = {
    initial,
    final,
    keyboardEnableAndMute: true,
    masterVolume: true,
    retainedOneBankAcrossSixRealWorldSelections: true,
    instrumentDucksAndRestoresAmbience: true,
    teachingAnalyserIsolated: true,
  }
}

async function cancellations(page: Page) {
  await button(page, 'Enable ambience').click()
  await ambient(page, true)
  await button(page, 'Tideweave').click()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await quiet(page)
  await button(page, 'Enable ambience').click()
  await ambient(page, true)
  await button(page, 'Glasswake').click()
  await page.evaluate(() => {
    Object.defineProperty(document, '__soundscapeHiddenDescriptor', {
      configurable: true,
      value: Object.getOwnPropertyDescriptor(document, 'hidden'),
    })
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  try {
    await quiet(page)
  } finally {
    await page.evaluate(() => {
      const descriptor = Reflect.get(
        document,
        '__soundscapeHiddenDescriptor',
      ) as PropertyDescriptor | undefined
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor)
      else Reflect.deleteProperty(document, 'hidden')
      Reflect.deleteProperty(document, '__soundscapeHiddenDescriptor')
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  await quiet(page)
  await page.evaluate(() => {
    window.__soundscapeProof.holdResumes = true
  })
  await button(page, 'Enable ambience').click()
  await page.waitForFunction(
    () => window.__observatory!.audio.snapshot().ambience.pending,
  )
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.evaluate(() => {
    window.__soundscapeProof.releaseResumes()
  })
  await quiet(page)
  await button(page, 'Enable ambience').click()
  await ambient(page, true)
  await button(page, 'Guide').click()
  await page.locator('dialog[data-panel="intro"][open]').waitFor()
  await quiet(page)
  assert.equal(await button(page, 'Enable ambience').isDisabled(), true)
  await page.keyboard.press('Escape')
  await button(page, 'Enable ambience').click()
  await ambient(page, true)
  await button(page, 'Open temple signal').click()
  await settled(page, 'temple')
  await quiet(page)
  const ending = await audio(page)
  assert.equal(ending.playing, false)
  assert.equal(await button(page, 'Enable ambience').isDisabled(), true)
  await button(page, 'Return to worlds').click()
  await settled(page, 'overview')
  await quiet(page)
  report.cancellations = {
    note: 'Synthetic window blur/document.hidden and an instrumentation-held native resume Promise exercise cancellation, not OS visibility acceptance. All enables and navigation use real controls.',
    noRestartAfterRestore: true,
    canceledResumeCannotStartLate: true,
    modalClearsAmbience: true,
    templeArrivalSilent: true,
    returnRequiresFreshEnable: true,
  }
}

async function offlineSamples(page: Page) {
  const samples: Record<string, unknown> = {}
  for (const world of ['glasswake', 'tideweave']) {
    const sample = await page.evaluate(async (id) => {
      const moduleUrl = '/src/almanac/worldAmbience.ts'
      const graphModule = await import(moduleUrl)
      const context = new OfflineAudioContext(2, 24000 * 6, 24000)
      const gain = context.createGain()
      gain.gain.value = 0.55
      gain.connect(context.destination)
      const graph = graphModule.createWorldAmbience(context, gain, id)
      const rendered = await context.startRendering()
      const channels = [rendered.getChannelData(0), rendered.getChannelData(1)]
      let energy = 0
      let peak = 0
      let crossings = 0
      for (let index = 0; index < rendered.length; index++) {
        const value = (channels[0][index] + channels[1][index]) * 0.5
        energy += value * value
        peak = Math.max(peak, Math.abs(value))
        if (
          index > 0 &&
          value >= 0 &&
          channels[0][index - 1] + channels[1][index - 1] < 0
        )
          crossings++
      }
      const bands = Array.from({ length: 256 }, (_, bin) => {
        let real = 0
        let imaginary = 0
        for (let index = 0; index < 4096; index++) {
          const value = channels[0][rendered.length - 4096 + index]
          const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / 4095)
          real += value * window * Math.cos((2 * Math.PI * bin * index) / 4096)
          imaginary -=
            value * window * Math.sin((2 * Math.PI * bin * index) / 4096)
        }
        return real * real + imaginary * imaginary
      })
      const total = bands.reduce((sum, value) => sum + value, 0)
      const centroid =
        bands.reduce(
          (sum, value, index) => sum + (value * index * 24000) / 4096,
          0,
        ) / total
      const dominantHz = (bands.indexOf(Math.max(...bands)) * 24000) / 4096
      const bytes = new Uint8Array(44 + rendered.length * 4)
      const view = new DataView(bytes.buffer)
      bytes.set([82, 73, 70, 70], 0)
      view.setUint32(4, bytes.length - 8, true)
      bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8)
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 2, true)
      view.setUint32(24, 24000, true)
      view.setUint32(28, 96000, true)
      view.setUint16(32, 4, true)
      view.setUint16(34, 16, true)
      bytes.set([100, 97, 116, 97], 36)
      view.setUint32(40, bytes.length - 44, true)
      for (let frame = 0; frame < rendered.length; frame++)
        for (let channel = 0; channel < 2; channel++)
          view.setInt16(
            44 + frame * 4 + channel * 2,
            Math.round(
              Math.max(-1, Math.min(1, channels[channel][frame])) * 32767,
            ),
            true,
          )
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      graph.dispose()
      return {
        wav: btoa(binary),
        rms: Math.sqrt(energy / rendered.length),
        peak,
        crossingsHz: crossings / 6,
        centroidHz: centroid,
        dominantHz,
        seconds: 6,
        sampleRate: 24000,
        channels: 2,
      }
    }, world)
    const bytes = Buffer.from(sample.wav, 'base64')
    const { wav: omitted, ...metrics } = sample
    assert.ok(omitted.length > 0)
    assert.ok(metrics.rms > 0.00001)
    assert.ok(
      metrics.peak < 1,
      'Production graph sample must not clip at review volume',
    )
    await writeFile(path.join(out, `${world}-production-ambience.wav`), bytes)
    samples[world] = {
      ...metrics,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  const glass = samples.glasswake as { centroidHz: number; dominantHz: number }
  const tide = samples.tideweave as { centroidHz: number; dominantHz: number }
  assert.ok(
    Math.abs(glass.centroidHz - tide.centroidHz) > 1 ||
      Math.abs(glass.dominantHz - tide.dominantHz) > 1,
    'World production graphs should have measurably different spectra',
  )
  report.productionGraphSamples = {
    note: 'Six-second stereo 24 kHz offline renders of the exact production builder at master volume 0.55. Spectral difference proves distinct signal; the owner should listen for quality and hardware audibility.',
    samples,
  }
}

async function verifyBuiltUi() {
  const context = await makeContext()
  const page = await context.newPage()
  currentPage = page
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /computations created outside|GPU validation|device lost/i.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.detach()
  assert.equal((await page.goto(`${base}/observatory`))?.status(), 200)
  await page.waitForFunction(
    () => {
      const control = document.querySelector<HTMLButtonElement>(
        '.observatory-ambience',
      )
      return (
        control &&
        !control.disabled &&
        !document.querySelector('.observatory-loading')
      )
    },
    undefined,
    { timeout: 60000 },
  )
  assert.equal(
    await page.evaluate(() => window.__observatory === undefined),
    true,
    'Emitted production proof must not rely on the development API',
  )
  assert.deepEqual(await probe(page), [])
  await placement()
  report.step = 'emitted-ui-gesture-and-volume'
  await button(page, 'Enable ambience').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () =>
      document
        .querySelector('.observatory-ambience')
        ?.getAttribute('aria-pressed') === 'true',
  )
  await delay(1100)
  const initial = await probe(page)
  assert.equal(initial.length, 1)
  assert.equal(initial[0].live, 7)
  assert.ok(initial[0].rms > 0.00001)
  assert.deepEqual(initial[0].teachingRms, [0])
  const volume = page.getByRole('slider', { name: 'Volume', exact: true })
  await volume.focus()
  await page.keyboard.press('Home')
  await delay(350)
  assert.ok((await probe(page))[0].rms < 0.00001)
  await page.keyboard.press('End')
  await delay(350)
  assert.ok((await probe(page))[0].rms > 0.00001)
  report.step = 'emitted-ui-world-navigation'
  await button(page, 'Tideweave').click()
  assert.ok((await probe(page))[0].connectedVoices <= 13)
  await button(page, 'Glasswake').click()
  assert.ok((await probe(page))[0].connectedVoices <= 13)
  await delay(1100)
  assert.equal((await probe(page))[0].live, 7)
  report.step = 'emitted-ui-responsive-header'
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 950 })
    await capture(page, `built-ambience-header-${width}`)
  }
  await button(page, 'Mute ambience').focus()
  await page.keyboard.press('Enter')
  await delay(1000)
  const muted = await probe(page)
  assert.ok(
    muted.every(
      (entry) =>
        entry.live === 0 &&
        entry.connectedVoices === 0 &&
        entry.scheduledVoices === 0 &&
        entry.rms < 0.00001,
    ),
  )
  assert.equal(
    await button(page, 'Enable ambience').getAttribute('aria-pressed'),
    'false',
  )
  report.emittedUi = {
    noDevelopmentApi: true,
    noContextBeforeGesture: true,
    keyboardEnableAndMute: true,
    masterVolume: true,
    realWorldSelections: true,
    headerWidths: [1440, 820, 390],
    initial,
    muted,
  }
  await placement()
  await page.close()
  await context.close()
}

try {
  await mkdir(out, { recursive: true })
  report.browserVersion = browser.version()
  if (builtUi) await verifyBuiltUi()
  else {
    const context = await makeContext()
    const page = await open(context)
    await placement()
    report.step = 'gesture-controls-volume-single-bank-and-instrument-isolation'
    await controlsAndLayers(page)
    report.step = 'cancellation-and-silent-temple'
    await cancellations(page)
    report.step = 'host-layouts'
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 })
      await button(page, 'Enable ambience').click()
      await ambient(page, true)
      await capture(page, `ambience-header-${width}`)
      await button(page, 'Mute ambience').click()
      await quiet(page)
    }
    report.step = 'production-offline-review-samples'
    await offlineSamples(page)
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      JOURNEY_STORAGE_KEY,
    )
    assert.deepEqual(
      saved.worlds.glasswake.completion,
      fixture.worlds.glasswake.completion,
    )
    assert.deepEqual(
      saved.worlds.tideweave.completion,
      fixture.worlds.tideweave.completion,
    )
    report.fixtureCompletionsUnchanged = true
    await page.close()
    await context.close()
    report.step = 'fresh-touch-context'
    const touchContext = await makeContext(true)
    const touch = await open(touchContext)
    await button(touch, 'Enable ambience').tap()
    await ambient(touch, true)
    await capture(touch, 'ambience-header-390-touch')
    await button(touch, 'Mute ambience').tap()
    await quiet(touch)
    report.touch = {
      freshContext: true,
      noContextBeforeGesture: true,
      trustedTapEnableAndMute: true,
      width: 390,
    }
    await placement()
    await touch.close()
    await touchContext.close()
  }
  assert.deepEqual(errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  report.failureStack = error instanceof Error ? error.stack : undefined
  if (currentPage && !currentPage.isClosed()) {
    if (!builtUi)
      report.lastAudio = await audio(currentPage).catch(() => undefined)
    report.lastProbe = await probe(currentPage).catch(() => undefined)
    await currentPage
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch(() => undefined)
  }
  process.exitCode = 1
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(
    path.join(out, 'soundscapes.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
