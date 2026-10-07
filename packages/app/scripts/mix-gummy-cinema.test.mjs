// Check cue placement, source preservation, and export evidence without encoding media.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildAudioPlan, buildCaptionPlan, buildVideoFilter, effects, makeOutputDirectory, parseLoudness, placeEffect, resolveCues, shots, verifyProbe, } from './mix-gummy-cinema.mjs'

const validation = {
  stems: [
    { name: 'warm-ambient', decodedDurationSeconds: 28 },
    {
      name: 'sticky-contact',
      decodedDurationSeconds: 2,
      sourcePeakTimeSeconds: 1.58,
    },
    {
      name: 'elastic-stretch',
      decodedDurationSeconds: 6,
      sourcePeakTimeSeconds: 2.56,
    },
    {
      name: 'soft-peeling-tear',
      decodedDurationSeconds: 4,
      sourcePeakTimeSeconds: 3.45,
    },
    {
      name: 'gummy-compression',
      decodedDurationSeconds: 3,
      sourcePeakTimeSeconds: 1.56,
    },
    {
      name: 'tiny-soft-drops',
      decodedDurationSeconds: 4,
      sourcePeakTimeSeconds: 3.32,
    },
    {
      name: 'gel-settling',
      decodedDurationSeconds: 4,
      sourcePeakTimeSeconds: 0.89,
    },
  ],
}

await describe('gummy cue placement', async () => {
  await it('changes only the named event and preserves zero and false overrides', () => {
    const cues = resolveCues({
      music: { volumeDb: -18 },
      shots: {
        'bishop-rook': { tear: { time: 0, volumeDb: 0, enabled: false } },
      },
    })
    assert.deepEqual(cues.shots['bishop-rook'].tear, {
      time: 0,
      volumeDb: 0,
      enabled: false,
    })
    assert.deepEqual(cues.shots['pawn-knight'].tear, {
      time: 4.5,
      volumeDb: 0,
      enabled: true,
    })
    assert.equal(cues.music.volumeDb, -18)
  })

  await it('rejects mistyped effects, invalid times and unsafe gain values', () => {
    assert.throws(
      () => resolveCues({ shots: { 'pawn-knight': { contacts: {} } } }),
      /Unknown/,
    )
    assert.throws(
      () => resolveCues({ shots: { 'pawn-knight': { contact: { time: 8 } } } }),
      /between/,
    )
    assert.throws(() => resolveCues({ music: { volumeDb: 20 } }), /between/)
    assert.throws(
      () =>
        resolveCues({
          shots: { 'pawn-knight': { contact: { volumeDb: '2;bad' } } },
        }),
      /between/,
    )
  })

  await it('aligns the source transient rather than placing its leading silence at the contact time', () => {
    assert.deepEqual(
      placeEffect(
        effects.contact,
        validation.stems[1],
        { time: 3.6, volumeDb: 0 },
        8,
      ),
      {
        sourceStart: 1.4,
        duration: 0.6,
        sourceAnchor: 0.18,
        timelineStart: 11.42,
        timelinePeak: 11.6,
        volumeDb: 0,
      },
    )
  })

  await it('trims pre-roll and a late tail to stay within the shot', () => {
    const early = placeEffect(effects.contact, validation.stems[1], {
      time: 0.04,
      volumeDb: 0,
    })
    assert.equal(early.timelineStart, 0)
    assert.equal(early.sourceStart, 1.54)
    assert.equal(early.timelinePeak, 0.04)
    const late = placeEffect(effects.contact, validation.stems[1], {
      time: 7.9,
      volumeDb: 0,
    })
    assert.equal(late.duration, 0.28)
    assert.equal(late.timelineStart, 7.72)
  })

  await it('offsets all three shots and avoids automatic mix/limiter gain changes', () => {
    const plan = buildAudioPlan(shots, '/audio', resolveCues(), validation)
    assert.deepEqual(
      plan.placements
        .filter((item) => item.effect === 'contact')
        .map((item) => item.timelinePeak),
      [3.6, 11.6, 19.6],
    )
    assert.equal(plan.duration, 24)
    assert.equal(plan.inputs.length, 7)
    assert.equal(
      plan.placements.find(
        (item) => item.shot === 'pawn-knight' && item.effect === 'stretch',
      ).timelineStart,
      3.7,
    )
    assert.match(
      plan.filters,
      /asplit=3\[contactSource0\]\[contactSource1\]\[contactSource2\]/,
    )
    assert.match(plan.filters, /adelay=164160S:all=1/)
    assert.match(plan.filters, /amix=inputs=19:duration=longest:normalize=0/)
    assert.match(plan.filters, /alimiter=limit=0.7:level=0:latency=1/)
  })

  await it('removes disabled cues and refuses a music bed shorter than the film', () => {
    const cues = resolveCues({
      shots: { 'pawn-knight': { drops: { enabled: false } } },
    })
    const plan = buildAudioPlan([shots[0]], '/audio', cues, validation)
    assert.equal(plan.placements.length, 5)
    assert.equal(plan.inputs.length, 6)
    assert.ok(!plan.filters.includes('dropsSource'))
    const shortBed = {
      stems: validation.stems.map((stem) =>
        stem.name === 'warm-ambient'
          ? { ...stem, decodedDurationSeconds: 20 }
          : stem,
      ),
    }
    assert.throws(
      () => buildAudioPlan(shots, '/audio', resolveCues(), shortBed),
      /shorter/,
    )
  })
})

await describe('assembly and output evidence', async () => {
  await it('labels independent moves and leaves contact, tearing and settling unobstructed', () => {
    const plan = buildCaptionPlan(shots, false)
    assert.deepEqual(
      plan.labels.map(({ title, subtitle, start, duration }) => ({
        title,
        subtitle,
        start,
        duration,
      })),
      [
        {
          title: 'Pawn takes knight',
          subtitle: 'e4 → d5',
          start: 0,
          duration: 1.9,
        },
        {
          title: 'Bishop takes rook',
          subtitle: 'c4 → f7',
          start: 8,
          duration: 1.9,
        },
        {
          title: 'Queen takes rook',
          subtitle: 'd3 → d7',
          start: 16,
          duration: 1.9,
        },
        {
          title: 'Gummy chess',
          subtitle: 'Lumen Apeiron',
          start: 23,
          duration: 1,
        },
      ],
    )
    for (const offset of [0, 8, 16]) {
      assert.ok(
        plan.labels.every(
          (label) =>
            label.start + label.duration <= offset + 3 ||
            label.start >= offset + 6.8,
        ),
      )
    }
    const portrait = buildCaptionPlan([shots[0]], true)
    assert.equal(portrait.labels.at(-1).start, 7)
    assert.equal(portrait.labels.at(-1).ink, true)
    assert.equal(buildCaptionPlan([shots[1]], true).labels.at(-1).ink, false)
    assert.throws(() => buildCaptionPlan([], false), /at least one/)
  })

  await it('downsamples before drawing portrait and landscape captions without retiming', () => {
    const landscape = buildVideoFilter(shots, false)
    const portrait = buildVideoFilter([shots[1]], true)
    assert.match(landscape, /concat=n=3:v=1:a=0/)
    assert.match(landscape, /scale=w=1920:h=1080:flags=lanczos/)
    assert.match(portrait, /scale=w=1080:h=1920:flags=lanczos/)
    assert.match(landscape, /setpts=PTS-STARTPTS\+23\/TB\[label3\]/)
    assert.match(portrait, /text='Bishop takes rook'/)
    assert.match(portrait, /text='c4 → f7'/)
    assert.match(portrait, /setpts=PTS-STARTPTS\+7\/TB\[label1\]/)
    assert.match(portrait, /overlay=x=72:y=168/)
    assert.ok(!portrait.includes('Pawn takes knight'))
  })

  await it('accepts 1080p and 4K captures in the matching orientation, never upscaling smaller sources', () => {
    const source = {
      streams: [
        { codec_type: 'video', avg_frame_rate: '60/1', nb_read_frames: '480' },
      ],
      format: { duration: '8.000' },
    }
    for (const portrait of [false, true]) {
      for (const scale of [1, 2]) {
        const probe = globalThis.structuredClone(source)
        Object.assign(probe.streams[0], {
          width: (portrait ? 1080 : 1920) * scale,
          height: (portrait ? 1920 : 1080) * scale,
        })
        verifyProbe(probe, { duration: 8, portrait })
        assert.throws(() => {
          verifyProbe(probe, { duration: 8, portrait: !portrait })
        }, /orientation/)
      }
    }
    for (const [width, height] of [
      [1280, 720],
      [4096, 2160],
      [1920, 1920],
    ]) {
      const probe = globalThis.structuredClone(source)
      Object.assign(probe.streams[0], { width, height })
      assert.throws(() => {
        verifyProbe(probe, { duration: 8, portrait: false })
      }, /1080p or 4K/)
    }
    const largeFinal = globalThis.structuredClone(source)
    Object.assign(largeFinal.streams[0], { width: 3840, height: 2160 })
    assert.throws(() => {
      verifyProbe(largeFinal, { duration: 8, portrait: false, final: true })
    }, /Final video/)
  })

  await it('reads actual input loudness and rejects silence or unsafe peaks', () => {
    const log =
      'FFmpeg diagnostics\n{"input_i":"-30.2","input_tp":"-5.4","input_lra":"3.1","output_i":"-23.0"}\n'
    assert.deepEqual(parseLoudness(log), {
      integratedLufs: -30.2,
      truePeakDbtp: -5.4,
      loudnessRangeLu: 3.1,
      passed: true,
    })
    assert.equal(parseLoudness(log.replace('-5.4', '-0.5')).passed, false)
    assert.throws(() => parseLoudness(log.replace('-30.2', '-inf')), /silent/)
    assert.throws(() => parseLoudness('no meter output'), /no loudness/)
  })

  await it('requires the exact output dimensions, frame count, codec and audio format', () => {
    const probe = {
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          avg_frame_rate: '60/1',
          nb_read_frames: '1440',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '48000',
          channels: 2,
        },
      ],
      format: { duration: '24.000' },
    }
    verifyProbe(probe, { duration: 24, portrait: false, final: true })
    for (const [key, value] of [
      ['nb_read_frames', '1439'],
      ['avg_frame_rate', '30/1'],
      ['pix_fmt', 'yuv444p'],
      ['width', 1080],
    ]) {
      const broken = globalThis.structuredClone(probe)
      broken.streams[0][key] = value
      assert.throws(() => {
        verifyProbe(broken, { duration: 24, portrait: false, final: true })
      })
    }
    assert.throws(() => {
      verifyProbe(
        { ...probe, streams: [probe.streams[0]] },
        { duration: 24, portrait: false, final: true },
      )
    })
  })

  await it('refuses existing output directories without touching their contents', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gummy-mix-test-'))
    try {
      const sentinel = path.join(directory, 'capture.mp4')
      writeFileSync(sentinel, 'preserved raw')
      assert.throws(() => {
        makeOutputDirectory(directory)
      }, /will not be overwritten/)
      assert.equal(readFileSync(sentinel, 'utf8'), 'preserved raw')
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})
