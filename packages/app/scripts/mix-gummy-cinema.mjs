// Assemble native gummy captures with transient-aligned foley, a low music bed, and export evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const shots = [
  {
    name: 'pawn-knight',
    title: 'Pawn takes knight',
    move: 'e4 → d5',
    ink: true,
  },
  {
    name: 'bishop-rook',
    title: 'Bishop takes rook',
    move: 'c4 → f7',
    ink: false,
  },
  {
    name: 'queen-rook',
    title: 'Queen takes rook',
    move: 'd3 → d7',
    ink: false,
  },
]
export const effects = {
  contact: {
    stem: 'sticky-contact',
    time: 3.6,
    volumeDb: 0,
    lead: 0.18,
    duration: 0.6,
  },
  stretch: {
    stem: 'elastic-stretch',
    time: 3.9,
    volumeDb: -4,
    lead: 0.2,
    duration: 1.55,
  },
  tear: {
    stem: 'soft-peeling-tear',
    time: 4.5,
    volumeDb: 0,
    lead: 0.45,
    duration: 1.1,
  },
  compression: {
    stem: 'gummy-compression',
    time: 4.9,
    volumeDb: 4,
    lead: 0.2,
    duration: 0.8,
  },
  drops: {
    stem: 'tiny-soft-drops',
    time: 5.3,
    volumeDb: -3,
    lead: 0.28,
    duration: 1.0,
  },
  settle: {
    stem: 'gel-settling',
    time: 6.4,
    volumeDb: 4,
    lead: 0.15,
    duration: 1.1,
  },
}
const fps = 60
const shotSeconds = 8
const number = (value) => Number(value.toFixed(6))
const json = (filename, value) => {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`)
}

function object(value, label, allowed) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`,
  )
  for (const key of Object.keys(value))
    assert.ok(allowed.includes(key), `Unknown ${label} key: ${key}`)
}

function bounded(value, min, max, label) {
  assert.ok(
    typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
    `${label} must be between ${min} and ${max}`,
  )
  return value
}

export function resolveCues(overrides = {}) {
  object(overrides, 'cues', ['music', 'shots'])
  object(overrides.music ?? {}, 'music', ['volumeDb'])
  object(
    overrides.shots ?? {},
    'shots',
    shots.map((shot) => shot.name),
  )
  const resolved = {
    music: {
      volumeDb: bounded(
        overrides.music?.volumeDb ?? -14,
        -60,
        0,
        'music.volumeDb',
      ),
    },
    shots: {},
  }
  for (const shot of shots) {
    const shotOverrides = overrides.shots?.[shot.name] ?? {}
    object(shotOverrides, shot.name, Object.keys(effects))
    resolved.shots[shot.name] = {}
    for (const [name, defaults] of Object.entries(effects)) {
      const value = shotOverrides[name] ?? {}
      object(value, `${shot.name}.${name}`, ['time', 'volumeDb', 'enabled'])
      assert.ok(
        value.enabled === undefined || typeof value.enabled === 'boolean',
        'enabled must be boolean',
      )
      resolved.shots[shot.name][name] = {
        time: bounded(value.time ?? defaults.time, 0, 7.95, `${name}.time`),
        volumeDb: bounded(
          value.volumeDb ?? defaults.volumeDb,
          -60,
          12,
          `${name}.volumeDb`,
        ),
        enabled: value.enabled ?? true,
      }
    }
  }
  return resolved
}

// Align the strongest source transient, cropping pre-roll at time zero and tails at shot boundaries.
export function placeEffect(specification, metadata, cue, shotOffset = 0) {
  const peak = bounded(
    metadata.sourcePeakTimeSeconds,
    0,
    metadata.decodedDurationSeconds,
    'source peak',
  )
  let sourceStart = Math.max(0, peak - specification.lead)
  let anchor = peak - sourceStart
  if (cue.time < anchor) {
    sourceStart += anchor - cue.time
    anchor = cue.time
  }
  const localStart = cue.time - anchor
  const duration = Math.min(
    specification.duration,
    metadata.decodedDurationSeconds - sourceStart,
    shotSeconds - localStart,
  )
  assert.ok(
    duration >= 0.04,
    'Effect does not have enough source audio inside the shot',
  )
  return {
    sourceStart: number(sourceStart),
    duration: number(duration),
    sourceAnchor: number(anchor),
    timelineStart: number(shotOffset + localStart),
    timelinePeak: number(shotOffset + cue.time),
    volumeDb: cue.volumeDb,
  }
}

export function buildAudioPlan(
  selectedShots,
  audioDirectory,
  cues,
  validation,
) {
  const duration = selectedShots.length * shotSeconds
  const inputs = [path.join(audioDirectory, 'warm-ambient.wav')]
  const music = validation.stems.find((stem) => stem.name === 'warm-ambient')
  assert.ok(
    music?.decodedDurationSeconds >= duration,
    'Ambient stem is shorter than the output',
  )
  const filters = [
    `[0:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,volume=${cues.music.volumeDb}dB,afade=t=in:d=0.25,afade=t=out:st=${duration - 0.75}:d=0.75[music]`,
  ]
  const labels = ['[music]']
  const placements = []
  for (const [name, specification] of Object.entries(effects)) {
    const instances = selectedShots
      .map((shot, index) => ({ shot, index, cue: cues.shots[shot.name][name] }))
      .filter((item) => item.cue.enabled)
    if (!instances.length) continue
    const metadata = validation.stems.find(
      (stem) => stem.name === specification.stem,
    )
    assert.ok(metadata, `Missing validation for ${specification.stem}`)
    const input = inputs.length
    inputs.push(path.join(audioDirectory, `${specification.stem}.wav`))
    const splitLabels = instances.map((_, index) => `[${name}Source${index}]`)
    filters.push(
      `[${input}:a]asplit=${instances.length}${splitLabels.join('')}`,
    )
    for (const [index, instance] of instances.entries()) {
      const placement = placeEffect(
        specification,
        metadata,
        instance.cue,
        instance.index * shotSeconds,
      )
      placements.push({
        shot: instance.shot.name,
        effect: name,
        source: inputs[input],
        ...placement,
      })
      const label = `${name}${index}`
      filters.push(
        `${splitLabels[index]}atrim=start=${placement.sourceStart}:duration=${placement.duration},asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:d=0.012,afade=t=out:st=${number(placement.duration - 0.04)}:d=0.04,volume=${placement.volumeDb}dB,adelay=${Math.round(placement.timelineStart * 48000)}S:all=1[${label}]`,
      )
      labels.push(`[${label}]`)
    }
  }
  // Disable the limiter's makeup gain so it cannot raise the background level.
  filters.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.7:level=0:latency=1,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[mix]`,
  )
  return { duration, inputs, filters: filters.join(';\n'), placements }
}

/** Independent capture labels clear the contact window; the identity follows the last settling cue. */
export function buildCaptionPlan(selectedShots, portrait) {
  assert.ok(selectedShots.length, 'Choose at least one capture')
  const last = selectedShots.at(-1)
  const labelSeconds = 1.9
  return {
    x: portrait ? 72 : 64,
    y: portrait ? 168 : 56,
    width: portrait ? 580 : 740,
    height: portrait ? 118 : 140,
    titleSize: portrait ? 50 : 64,
    subtitleSize: portrait ? 30 : 42,
    subtitleY: portrait ? 68 : 84,
    labels: [
      ...selectedShots.map((shot, index) => ({
        title: shot.title,
        subtitle: shot.move,
        ink: shot.ink,
        start: index * shotSeconds,
        duration: labelSeconds,
        fadeOut: 0.3,
      })),
      {
        title: 'Gummy chess',
        subtitle: 'Lumen Apeiron',
        ink: last.ink,
        start: selectedShots.length * shotSeconds - 1,
        duration: 1,
        fadeOut: 0,
      },
    ],
  }
}

export function buildVideoFilter(selectedShots, portrait) {
  const width = portrait ? 1080 : 1920
  const height = portrait ? 1920 : 1080
  const captions = buildCaptionPlan(selectedShots, portrait)
  const filters = selectedShots.map(
    (_, index) =>
      `[${index}:v]trim=duration=8,setpts=PTS-STARTPTS,scale=w=${width}:h=${height}:flags=lanczos,setsar=1[v${index}]`,
  )
  filters.push(
    `${selectedShots.map((_, index) => `[v${index}]`).join('')}concat=n=${selectedShots.length}:v=1:a=0[base]`,
  )
  let previous = 'base'
  const font = 'fontfile=assets/Outfit-Medium.ttf'
  for (const [index, label] of captions.labels.entries()) {
    const foreground = label.ink ? '0x182b30' : '0xf8faf6'
    const secondary = label.ink ? '0x3c5055' : '0xd2e3e6'
    const shadow = label.ink ? 'black@0' : 'black@0.55'
    const fadeOut = label.fadeOut
      ? `,fade=t=out:st=${number(label.duration - label.fadeOut)}:d=${label.fadeOut}:alpha=1`
      : ''
    filters.push(
      `color=c=black@0:s=${captions.width}x${captions.height}:r=60:d=${label.duration},format=rgba,drawtext=${font}:text='${label.title}':fontsize=${captions.titleSize}:fontcolor=${foreground}:shadowcolor=${shadow}:shadowx=0:shadowy=2:x=0:y=0,drawtext=${font}:text='${label.subtitle}':fontsize=${captions.subtitleSize}:fontcolor=${secondary}:shadowcolor=${shadow}:shadowx=0:shadowy=1:x=0:y=${captions.subtitleY},fade=t=in:st=0:d=0.12:alpha=1${fadeOut},setpts=PTS-STARTPTS+${label.start}/TB[label${index}]`,
    )
    filters.push(
      `[${previous}][label${index}]overlay=x=${captions.x}:y=${captions.y}:eof_action=pass:repeatlast=0:enable='gte(t,${label.start})*lt(t,${label.start + label.duration})'[stage${index}]`,
    )
    previous = `stage${index}`
  }
  filters.push(`[${previous}]format=yuv420p[film]`)
  return filters.join(';\n')
}

export function parseLoudness(log) {
  const blocks = log.match(/\{[^{}]*"input_i"[^{}]*\}/g)
  assert.ok(blocks?.length, 'FFmpeg returned no loudness measurements')
  const measured = JSON.parse(blocks.at(-1))
  const result = {
    integratedLufs: Number(measured.input_i),
    truePeakDbtp: Number(measured.input_tp),
    loudnessRangeLu: Number(measured.input_lra),
  }
  assert.ok(
    Object.values(result).every(Number.isFinite),
    'Audio is silent or its loudness is not measurable',
  )
  result.passed =
    result.truePeakDbtp <= -1 &&
    result.integratedLufs <= -16 &&
    result.integratedLufs >= -48
  return result
}

export function verifyProbe(probe, { duration, portrait, final = false }) {
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio')
  assert.ok(video, 'Missing video stream')
  const width = portrait ? 1080 : 1920
  const height = portrait ? 1920 : 1080
  assert.ok(
    (video.width === width && video.height === height) ||
      (!final && video.width === width * 2 && video.height === height * 2),
    final
      ? 'Final video must have the selected 1080p orientation'
      : 'Source must be 1080p or 4K in the selected orientation',
  )
  assert.equal(video.avg_frame_rate, '60/1')
  const count = Number(video.nb_read_frames)
  assert.ok(
    final ? count === duration * fps : count >= duration * fps,
    'Unexpected frame count',
  )
  const actualDuration = Number(probe.format.duration)
  assert.ok(
    Number.isFinite(actualDuration) &&
      (final
        ? Math.abs(actualDuration - duration) <= 0.05
        : actualDuration >= duration - 1 / fps),
    'Unexpected duration',
  )
  if (final) {
    assert.equal(video.codec_name, 'h264')
    assert.equal(video.pix_fmt, 'yuv420p')
    assert.equal(audio?.codec_name, 'aac')
    assert.equal(audio.sample_rate, '48000')
    assert.equal(audio.channels, 2)
  }
}

export function makeOutputDirectory(output) {
  assert.ok(
    !existsSync(output),
    'Use a new output directory; existing files will not be overwritten',
  )
  mkdirSync(path.dirname(output), { recursive: true })
  mkdirSync(output)
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      takes: { type: 'string' },
      audio: { type: 'string' },
      out: { type: 'string' },
      cues: { type: 'string' },
      font: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.info(
      'Usage: node mix-gummy-cinema.mjs --takes DIR --audio DIR --out NEW_DIR [--cues FILE.json] [--font Outfit-Medium.ttf]\nRequires three {pawn-knight,bishop-rook,queen-rook}-{landscape,portrait}/capture.mp4 pairs, each at least 8s at 60fps, at 1080p or 4K in the matching orientation. Saves a 24s landscape promo and three 8s portrait clips at 1080p60, separate WAV mixes, captions, commands, probes and loudness reports. 4K captures are downsampled with Lanczos before captions in a single video encode.\nCue JSON: {"music":{"volumeDb":-14},"shots":{"pawn-knight":{"contact":{"time":3.6,"volumeDb":0,"enabled":true}}}}\nCue times align the measured source transient. Other effects: stretch, tear, compression, drops, settle. Captures are trimmed to 8s without retiming. Existing output directories are refused. Each FFmpeg render has a 15-minute deadline.',
    )
    return
  }
  for (const name of ['takes', 'audio', 'out'])
    assert.ok(values[name], `--${name} is required`)
  const takes = path.resolve(values.takes)
  const audio = path.resolve(values.audio)
  const output = path.resolve(values.out)
  const font = path.resolve(
    values.font ??
      path.join(audio, '../edit-landscape/assets/fonts/Outfit-Medium.ttf'),
  )
  const cues = resolveCues(
    values.cues
      ? JSON.parse(readFileSync(path.resolve(values.cues), 'utf8'))
      : {},
  )
  const validation = JSON.parse(
    readFileSync(path.join(audio, 'validation.json'), 'utf8'),
  )
  const products = [
    { name: 'gummy-chess-promo-1080p60', selected: shots, portrait: false },
    ...shots.map((shot) => ({
      name: `${shot.name}-vertical-1080p60`,
      selected: [shot],
      portrait: true,
    })),
  ].map((product) => ({
    ...product,
    plan: buildAudioPlan(product.selected, audio, cues, validation),
  }))
  const sources = shots.flatMap((shot) =>
    ['landscape', 'portrait'].map((orientation) =>
      path.join(takes, `${shot.name}-${orientation}`, 'capture.mp4'),
    ),
  )
  for (const input of [...sources, ...products[0].plan.inputs, font])
    assert.ok(existsSync(input), `Missing input: ${input}`)
  makeOutputDirectory(output)
  mkdirSync(path.join(output, 'assets'))
  copyFileSync(
    font,
    path.join(output, 'assets/Outfit-Medium.ttf'),
    constants.COPYFILE_EXCL,
  )
  const licence = path.join(path.dirname(font), 'OFL.txt')
  if (existsSync(licence))
    copyFileSync(
      licence,
      path.join(output, 'assets/OFL.txt'),
      constants.COPYFILE_EXCL,
    )
  json(path.join(output, 'cues.json'), cues)
  const commands = []
  const report = {
    startedAt: new Date().toISOString(),
    passed: false,
    sources: [],
    products: [],
    listeningReview:
      'Not performed; automated checks measure timing, codecs, levels and peaks only.',
  }
  const run = (program, args, label, timeout = 900_000) => {
    commands.push({ program, args, cwd: output, timeoutMs: timeout })
    json(path.join(output, 'commands.json'), commands)
    const result = spawnSync(program, args, {
      cwd: output,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    writeFileSync(
      path.join(output, `${label}.log`),
      `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`,
      { flag: 'wx' },
    )
    assert.equal(
      result.status,
      0,
      `${label} failed; see ${label}.log (${result.error?.message ?? result.signal ?? result.status})`,
    )
    return result
  }
  const probe = (filename, label) =>
    JSON.parse(
      run(
        'ffprobe',
        [
          '-v',
          'error',
          '-count_frames',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          filename,
        ],
        label,
        60_000,
      ).stdout,
    )
  const loudness = (filename, label) => {
    // loudnorm's diagnostic JSON is on stderr; keep it in the command log without a shell.
    const args = [
      '-hide_banner',
      '-nostdin',
      '-i',
      filename,
      '-vn',
      '-af',
      'loudnorm=I=-23:TP=-1:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ]
    const result = run('ffmpeg', args, label, 60_000)
    const measurement = parseLoudness(`${result.stdout}\n${result.stderr}`)
    json(path.join(output, `${label}.json`), measurement)
    assert.ok(
      measurement.passed,
      `Loudness check failed for ${label}; inspect the saved measurements`,
    )
    return measurement
  }
  try {
    for (const [index, source] of sources.entries()) {
      const measured = probe(source, `source-${index}-probe`)
      verifyProbe(measured, {
        duration: shotSeconds,
        portrait: source.includes('-portrait/'),
      })
      report.sources.push({ path: source, probe: measured })
    }
    for (const product of products) {
      const { name, selected, portrait, plan } = product
      const mix = path.join(output, `${name}.wav`)
      const film = path.join(output, `${name}.mp4`)
      writeFileSync(
        path.join(output, `${name}.audio.ffmpeg`),
        `${plan.filters}\n`,
        { flag: 'wx' },
      )
      json(path.join(output, `${name}.placements.json`), plan.placements)
      const common = [
        '-hide_banner',
        '-nostdin',
        '-n',
        '-loglevel',
        'warning',
        '-filter_complex_threads',
        '2',
      ]
      run(
        'ffmpeg',
        [
          ...common,
          ...plan.inputs.flatMap((input) => ['-i', input]),
          '-filter_complex',
          plan.filters,
          '-map',
          '[mix]',
          '-c:a',
          'pcm_s24le',
          '-ar',
          '48000',
          '-ac',
          '2',
          mix,
        ],
        `${name}.audio`,
      )
      const mixProbe = probe(mix, `${name}.audio-probe`)
      assert.equal(mixProbe.streams[0].codec_name, 'pcm_s24le')
      assert.equal(mixProbe.streams[0].sample_rate, '48000')
      assert.equal(mixProbe.streams[0].channels, 2)
      assert.ok(
        Math.abs(Number(mixProbe.format.duration) - plan.duration) < 1 / 48000,
      )
      const mixLoudness = loudness(mix, `${name}.audio-loudness`)
      const videoFilter = buildVideoFilter(selected, portrait)
      json(
        path.join(output, `${name}.captions.json`),
        buildCaptionPlan(selected, portrait),
      )
      writeFileSync(
        path.join(output, `${name}.video.ffmpeg`),
        `${videoFilter}\n`,
        { flag: 'wx' },
      )
      const videoInputs = selected.map((shot) =>
        path.join(
          takes,
          `${shot.name}-${portrait ? 'portrait' : 'landscape'}`,
          'capture.mp4',
        ),
      )
      run(
        'ffmpeg',
        [
          ...common,
          ...videoInputs.flatMap((input) => ['-i', input]),
          '-i',
          mix,
          '-filter_complex',
          videoFilter,
          '-map',
          '[film]',
          '-map',
          `${selected.length}:a:0`,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          '17',
          '-threads',
          '4',
          '-r',
          '60',
          '-fps_mode',
          'cfr',
          '-frames:v',
          String(plan.duration * fps),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-t',
          String(plan.duration),
          '-movflags',
          '+faststart',
          film,
        ],
        `${name}.video`,
      )
      const measured = probe(film, `${name}.video-probe`)
      verifyProbe(measured, { duration: plan.duration, portrait, final: true })
      const filmLoudness = loudness(film, `${name}.video-loudness`)
      report.products.push({
        file: film,
        audioMix: mix,
        duration: plan.duration,
        probe: measured,
        mixProbe,
        mixLoudness,
        filmLoudness,
      })
      json(path.join(output, 'assembly.json'), report)
      console.info(
        `Verified ${name}: ${plan.duration}s, 60fps, ${filmLoudness.integratedLufs} LUFS, ${filmLoudness.truePeakDbtp} dBTP`,
      )
    }
    report.passed = true
  } catch (error) {
    report.error = String(error)
    throw error
  } finally {
    report.finishedAt = new Date().toISOString()
    json(path.join(output, 'assembly.json'), report)
  }
}

// Importing this module for unit tests never runs media processes.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
