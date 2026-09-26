// Measure the original score through Chromium's actual offline analyser, without playing audio.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type * as Analysis from '../src/audioAnalysis'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5190/'
const output = path.resolve(
  process.env.AUDIO_MEASUREMENT_OUT ?? 'artifacts/audio-response.json',
)
const browser = await chromium.launch({
  headless: false,
  args: ['--class=agent-browser'],
})
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true })
  assert.equal(
    (await page.goto(new URL('/audio/README.md', base).href))?.status(),
    200,
  )
  const measured = await page.evaluate(async () => {
    const modulePath = '/src/audioAnalysis.ts'
    const { MusicAnalysis } = (await import(modulePath)) as typeof Analysis
    const sampleRate = 48000
    const duration = 48
    const context = new OfflineAudioContext(
      2,
      sampleRate * duration,
      sampleRate,
    )
    const encoded = await (
      await fetch('/audio/irchiinnuss-arrival.ogg')
    ).arrayBuffer()
    const buffer = await context.decodeAudioData(encoded)
    const source = context.createBufferSource()
    source.buffer = buffer
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
    analyser.connect(context.destination)
    const waveform = new Float32Array(analyser.fftSize)
    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const analysis = new MusicAnalysis()
    const frames: Array<{
      time: number
      raw: Omit<Analysis.MusicFrame, 'time'>
      mapped: Analysis.MusicFrame
    }> = []
    let previous = 0
    const pending = []
    for (let step = 1; step < duration * 60; step++) {
      pending.push(
        context.suspend(step / 60).then(() => {
          const time = context.currentTime
          analyser.getFloatTimeDomainData(waveform)
          analyser.getFloatFrequencyData(spectrum)
          let power = 0
          for (const value of waveform) power += value * value
          const bands = { low: 0, mid: 0, high: 0 }
          for (let bin = 0; bin < spectrum.length; bin++) {
            const hz = (bin * sampleRate) / analyser.fftSize
            if (hz < 40 || hz >= 8000) continue
            const key = hz < 250 ? 'low' : hz < 2000 ? 'mid' : 'high'
            bands[key] += 10 ** (spectrum[bin] / 10)
          }
          frames.push({
            time,
            raw: {
              energy: Math.sqrt(power / waveform.length),
              low: Math.sqrt(bands.low),
              mid: Math.sqrt(bands.mid),
              high: Math.sqrt(bands.high),
            },
            mapped: {
              ...analysis.update(
                waveform,
                spectrum,
                sampleRate,
                time,
                time - previous,
              ),
            },
          })
          previous = time
          void context.resume()
        }),
      )
    }
    source.start()
    await context.startRendering()
    await Promise.all(pending)
    return {
      sampleRate,
      duration,
      decodedDuration: buffer.duration,
      fftSize: analyser.fftSize,
      frames,
    }
  })
  assert.equal(measured.frames.length, 2879)
  const summarize = (type: 'raw' | 'mapped') =>
    Object.fromEntries(
      (['energy', 'low', 'mid', 'high'] as const).map((key) => {
        const values = measured.frames
          .map((frame) => frame[type][key])
          .sort((a, b) => a - b)
        const quantile = (fraction: number) =>
          values[Math.floor((values.length - 1) * fraction)]
        return [
          key,
          {
            min: values[0],
            p10: quantile(0.1),
            p50: quantile(0.5),
            p90: quantile(0.9),
            p99: quantile(0.99),
            max: values.at(-1),
            mean: values.reduce((sum, value) => sum + value, 0) / values.length,
            fractionAbove95Percent:
              values.filter((value) => value >= 0.95).length / values.length,
          },
        ]
      }),
    )
  const summary = { raw: summarize('raw'), mapped: summarize('mapped') }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        method:
          'Chromium OfflineAudioContext, actual AnalyserNode, 60 Hz suspended sampling, stereo downmix',
        browser: browser.version(),
        ...summary,
        ...measured,
      },
      null,
      2,
    ),
  )
  console.info(JSON.stringify({ output, ...summary }, null, 2))
} finally {
  await browser.close()
}
