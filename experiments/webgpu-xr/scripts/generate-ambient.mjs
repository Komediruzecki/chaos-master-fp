// Reproduce the original, sample-free 48-second Arrival score and its seamless loop.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../public/audio/', import.meta.url))
const sampleRate = 32000
const duration = 48
const count = sampleRate * duration
const tau = Math.PI * 2
const channels = [new Float64Array(count), new Float64Array(count)]
const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12)
// Every oscillator completes an integer number of cycles in the loop.
const frequency = (hz) => Math.round(hz * duration) / duration
const chords = [
  [50, 53, 57, 64],
  [46, 53, 57, 60],
  [48, 55, 62, 64],
  [50, 57, 60, 67],
]
const melody = [74, 77, 81, 79, 72, 77, 81, 84, 76, 79, 86, 84, 81, 79, 77, 72]

for (let index = 0; index < count; index++) {
  const time = index / sampleRate
  let left = 0
  let right = 0
  for (let chord = 0; chord < chords.length; chord++) {
    const swell =
      (0.5 + 0.5 * Math.cos((tau * (time - chord * 12)) / duration)) ** 4
    for (let note = 0; note < 4; note++) {
      const hz = frequency(midiHz(chords[chord][note]))
      const phase = tau * hz * time + note * 0.7
      const warm =
        Math.sin(phase) +
        0.19 * Math.sin(2 * phase) +
        0.055 * Math.sin(3 * phase)
      const shimmer = Math.sin(tau * frequency(hz * 1.003) * time + chord)
      const pan = ((note % 3) - 1) * 0.35
      const value = swell * (warm * 0.047 + shimmer * 0.012)
      left += value * Math.sqrt((1 - pan) / 2)
      right += value * Math.sqrt((1 + pan) / 2)
    }
  }
  const bass =
    0.022 *
    Math.sin(tau * frequency(midiHz(38)) * time) *
    (0.7 + 0.3 * Math.cos((tau * time) / 12))
  left += bass
  right += bass
  for (let note = 0; note < melody.length; note++) {
    const age = (time - note * 3 + duration) % duration
    if (age >= 12) continue
    const envelope =
      (1 - Math.exp(-age / 0.045)) *
      Math.exp(-age / 2.2) *
      Math.min(1, (12 - age) / 2) ** 2
    const hz = midiHz(melody[note])
    const glass =
      Math.sin(tau * frequency(hz) * time) +
      0.22 * Math.sin(tau * frequency(hz * 2.001) * time) +
      0.055 * Math.sin(tau * frequency(hz * 3.997) * time)
    const pan = Math.sin(note * 2.3) * 0.7
    const value = glass * envelope * 0.07
    left += value * Math.sqrt((1 - pan) / 2)
    right += value * Math.sqrt((1 + pan) / 2)
  }
  channels[0][index] = left
  channels[1][index] = right
}

// Circular cross-channel delays preserve the loop boundary without silence or a crossfade seam.
const wet = channels.map((channel, side) => {
  const result = new Float64Array(count)
  const taps = [
    [0.293, 0.21],
    [0.431, 0.16],
    [0.719, 0.11],
    [1.127, 0.065],
    [1.733, 0.035],
  ]
  for (let index = 0; index < count; index++) {
    let value = channel[index]
    for (let tap = 0; tap < taps.length; tap++) {
      const [seconds, gain] = taps[tap]
      const source = channels[(side + tap + 1) % 2]
      value +=
        source[(index - Math.round(seconds * sampleRate) + count) % count] *
        gain
    }
    result[index] = value
  }
  return result
})
let peak = 0
for (const channel of wet)
  for (const value of channel) peak = Math.max(peak, Math.abs(value))
const scale = 0.55 / peak
const wav = Buffer.alloc(44 + count * 4)
wav.write('RIFF', 0)
wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(2, 22)
wav.writeUInt32LE(sampleRate, 24)
wav.writeUInt32LE(sampleRate * 4, 28)
wav.writeUInt16LE(4, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(count * 4, 40)
let squares = 0
for (let index = 0; index < count; index++) {
  for (let side = 0; side < 2; side++) {
    const value = wet[side][index] * scale
    squares += value * value
    wav.writeInt16LE(Math.round(value * 32767), 44 + index * 4 + side * 2)
  }
}
mkdirSync(directory, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), 'lumen-arrival-'))
try {
  const source = join(temporary, 'arrival.wav')
  const target = join(directory, 'irchiinnuss-arrival.ogg')
  writeFileSync(source, wav)
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-metadata',
    'title=Irchiinnuss - Arrival',
    '-metadata',
    'artist=Lumen Apeiron',
    target,
  ])
  if (process.argv[2]) {
    mkdirSync(dirname(process.argv[2]), { recursive: true })
    writeFileSync(process.argv[2], wav)
  }
  console.info(
    JSON.stringify(
      {
        duration,
        sampleRate,
        channels: 2,
        pcmPeak: 0.55,
        pcmRms: Math.sqrt(squares / (count * 2)),
        bytes: readFileSync(target).length,
        pcmSha256: createHash('sha256').update(wav).digest('hex'),
        assetSha256: createHash('sha256')
          .update(readFileSync(target))
          .digest('hex'),
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
