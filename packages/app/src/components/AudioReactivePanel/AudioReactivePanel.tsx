import { createEffect, createMemo, createSignal, For, onCleanup, Show, } from 'solid-js'
import { Cross } from '@/icons'
import {
  createAudioAnalyzer,
  createLiveAnalyzer,
  decodeAudioFile
} from '@/utils/audioAnalysis'
import ui from './AudioReactivePanel.module.css'
import type {LiveAudioAnalyzer} from '@/utils/audioAnalysis';

// --- Types ---

export type AudioFeature =
  | 'subBass'
  | 'bass'
  | 'lowMid'
  | 'mid'
  | 'hiMid'
  | 'presence'
  | 'brilliance'
  | 'fullSpectrum'
  | 'rms'
  | 'centroid'
  | 'flatness'
  | 'beat'
  | 'onset'

export type FlameParam =
  | 'vibrancy'
  | 'exposure'
  | 'palettePhase'
  | 'paletteSpeed'
  | 'contrast'
  | 'gamma'
  | 'highlightPower'
  | 'lightPower'
  | 'depthColorPower'
  | 'zoom'
  | 'skipIters'

export type ParamMapping = {
  audioFeature: AudioFeature
  flameParam: FlameParam
  sensitivity: number
  range: [number, number]
}

export type AudioMapping = {
  preset: AudioPreset
  mappings: ParamMapping[]
}

export type AudioPreset = 'pulse' | 'groove' | 'ambient' | 'chaos' | 'warmth' | 'custom'

type AudioReactivePanelProps = {
  onClose: () => void
  audioBuffer: (() => AudioBuffer | undefined) | AudioBuffer | undefined
  onAudioChange: (buffer: AudioBuffer | undefined) => void
  audioMapping: (() => AudioMapping) | AudioMapping
  onMappingChange: (mapping: AudioMapping) => void
  audioEnabled: () => boolean
  onEnabledChange: (enabled: boolean) => void
  audioSource: (() => 'file' | 'mic') | 'file' | 'mic'
  onSourceChange: (source: 'file' | 'mic') => void
  onLiveAnalyzerChange: (analyzer: LiveAudioAnalyzer | undefined) => void
  liveAnalyzer: (() => LiveAudioAnalyzer | undefined) | LiveAudioAnalyzer | undefined
}

// --- Feature / param labels ---

const AUDIO_FEATURE_LABELS: Record<AudioFeature, string> = {
  subBass: 'Sub-Bass',
  bass: 'Bass',
  lowMid: 'Low-Mid',
  mid: 'Mid',
  hiMid: 'Hi-Mid',
  presence: 'Presence',
  brilliance: 'Brilliance',
  fullSpectrum: 'Full Spectrum',
  rms: 'RMS',
  centroid: 'Centroid',
  flatness: 'Flatness',
  beat: 'Beat',
  onset: 'Onset',
}

const FLAME_PARAM_LABELS: Record<FlameParam, string> = {
  vibrancy: 'Vibrancy',
  exposure: 'Exposure',
  palettePhase: 'Palette Phase',
  paletteSpeed: 'Palette Speed',
  contrast: 'Contrast',
  gamma: 'Gamma',
  highlightPower: 'Highlight Power',
  lightPower: 'Light Power',
  depthColorPower: 'Depth Color',
  zoom: 'Zoom',
  skipIters: 'Skip Iters',
}

// --- Presets ---

const PRESET_MAPPINGS: Record<AudioPreset, ParamMapping[]> = {
  pulse: [
    {
      audioFeature: 'bass',
      flameParam: 'vibrancy',
      sensitivity: 1,
      range: [0.3, 1.5],
    },
    {
      audioFeature: 'beat',
      flameParam: 'palettePhase',
      sensitivity: 1,
      range: [0, 3.14],
    },
  ],
  groove: [
    {
      audioFeature: 'mid',
      flameParam: 'zoom',
      sensitivity: 1,
      range: [0.85, 1.15],
    },
    {
      audioFeature: 'bass',
      flameParam: 'vibrancy',
      sensitivity: 1,
      range: [0.5, 1.5],
    },
    {
      audioFeature: 'centroid',
      flameParam: 'palettePhase',
      sensitivity: 1,
      range: [0, 3.14],
    },
  ],
  ambient: [
    {
      audioFeature: 'rms',
      flameParam: 'exposure',
      sensitivity: 1,
      range: [0.8, 1.2],
    },
    {
      audioFeature: 'hiMid',
      flameParam: 'paletteSpeed',
      sensitivity: 1,
      range: [0.5, 2],
    },
    {
      audioFeature: 'centroid',
      flameParam: 'gamma',
      sensitivity: 1,
      range: [0.6, 1.4],
    },
  ],
  chaos: [
    {
      audioFeature: 'flatness',
      flameParam: 'contrast',
      sensitivity: 1,
      range: [0.5, 2],
    },
    {
      audioFeature: 'fullSpectrum',
      flameParam: 'skipIters',
      sensitivity: 1,
      range: [0.8, 1.2],
    },
    {
      audioFeature: 'beat',
      flameParam: 'highlightPower',
      sensitivity: 1,
      range: [0, 3],
    },
    {
      audioFeature: 'onset',
      flameParam: 'contrast',
      sensitivity: 1,
      range: [0.8, 1.6],
    },
  ],
  warmth: [
    {
      audioFeature: 'centroid',
      flameParam: 'palettePhase',
      sensitivity: 1,
      range: [0, 3.14],
    },
    {
      audioFeature: 'bass',
      flameParam: 'vibrancy',
      sensitivity: 1,
      range: [0.4, 1.6],
    },
    {
      audioFeature: 'brilliance',
      flameParam: 'contrast',
      sensitivity: 1,
      range: [0.7, 1.3],
    },
  ],
  custom: [],
}

const PRESET_LABELS: Record<AudioPreset, string> = {
  pulse: 'Pulse',
  groove: 'Groove',
  ambient: 'Ambient',
  chaos: 'Chaos',
  warmth: 'Warmth',
  custom: 'Custom',
}

const ALL_FEATURES: AudioFeature[] = [
  'subBass',
  'bass',
  'lowMid',
  'mid',
  'hiMid',
  'presence',
  'brilliance',
  'fullSpectrum',
  'rms',
  'centroid',
  'flatness',
  'beat',
  'onset',
]

const ALL_PARAMS: FlameParam[] = [
  'vibrancy',
  'exposure',
  'palettePhase',
  'paletteSpeed',
  'contrast',
  'gamma',
  'highlightPower',
  'lightPower',
  'depthColorPower',
  'zoom',
  'skipIters',
]

const SUPPORTED_AUDIO =
  '.mp3,.wav,.ogg,.flac,audio/mpeg,audio/wav,audio/ogg,audio/flac'

function resolve<T>(v: (() => T) | T): T {
  return typeof v === 'function' ? (v as () => T)() : v
}

// --- Waveform helpers ---

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0)
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i]! += data[i]!
    }
  }
  for (let i = 0; i < length; i++) {
    mono[i] = mono[i]! / buffer.numberOfChannels
  }
  return mono
}

function computeBeatFrames(
  audioBuffer: AudioBuffer,
  onProgress?: (current: number, total: number) => void,
): {
  beatFrames: Set<number>
  totalFrames: number
} {
  const analyzer = createAudioAnalyzer(audioBuffer, 30, onProgress)
  const beats = new Set<number>()
  for (let i = 0; i < analyzer.totalFrames; i++) {
    if (analyzer.getFrameData(i).isBeat) beats.add(i)
  }
  return { beatFrames: beats, totalFrames: analyzer.totalFrames }
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  beats: Set<number>,
  totalFrames: number,
): void {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Pre-compute downsampled peaks
  const mono = mixToMono(audioBuffer)
  const peaks = new Float32Array(width)
  const step = Math.ceil(mono.length / width)
  for (let x = 0; x < width; x++) {
    const start = x * step
    const end = Math.min(start + step, mono.length)
    let peak = 0
    for (let i = start; i < end; i++) {
      const abs = Math.abs(mono[i]!)
      if (abs > peak) peak = abs
    }
    peaks[x] = peak
  }

  // Waveform fill
  const midY = height / 2
  ctx.beginPath()
  for (let x = 0; x < width; x++) {
    const y = peaks[x]! * midY
    ctx.moveTo(x, midY - y)
    ctx.lineTo(x, midY + y)
  }
  ctx.strokeStyle = 'rgba(180, 160, 255, 0.75)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Beat markers
  if (totalFrames > 0) {
    for (const frame of beats) {
      const x = (frame / totalFrames) * width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.strokeStyle = 'rgba(255, 120, 80, 0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

// --- Component ---

export function AudioReactivePanel(props: AudioReactivePanelProps) {
  const [dragOver, setDragOver] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [analyzing, setAnalyzing] = createSignal(false)
  const [analyzeProgress, setAnalyzeProgress] = createSignal(0)
  const [audioFileName, setAudioFileName] = createSignal<string | null>(null)
  const [micError, setMicError] = createSignal<string | null>(null)
  const [micConnecting, setMicConnecting] = createSignal(false)

  let waveformCanvas!: HTMLCanvasElement
  let fileInput!: HTMLInputElement

  const audioBuffer = () => resolve(props.audioBuffer)
  const audioMapping = () => resolve(props.audioMapping)
  const audioSource = () => resolve(props.audioSource)
  const liveAnalyzer = () => resolve(props.liveAnalyzer)

  // Draw waveform when buffer changes
  createEffect(() => {
    const buffer = audioBuffer()
    if (!buffer) return
    const canvas = waveformCanvas
    if (!canvas) return

    setAnalyzing(true)
    setAnalyzeProgress(0)
    // Yield so the UI paints "Analyzing audio..." before we block on FFT.
    setTimeout(() => {
      const { beatFrames, totalFrames } = computeBeatFrames(
        buffer,
        (current, total) => {
          setAnalyzeProgress(Math.round((current / total) * 100))
        },
      )
      drawWaveform(canvas, buffer, beatFrames, totalFrames)
      setAnalyzing(false)
    }, 30)
  })

  function handleFile(file: File) {
    if (!file) return
    setError(null)
    setLoading(true)
    setAudioFileName(file.name)
    decodeAudioFile(file)
      .then((buffer) => {
        props.onAudioChange(buffer)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to decode audio')
        setLoading(false)
        setAudioFileName(null)
      })
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleFile(file)
    input.value = ''
  }

  function enableMic() {
    setMicError(null)
    setMicConnecting(true)
    createLiveAnalyzer(30)
      .then((analyzer) => {
        setMicConnecting(false)
        props.onLiveAnalyzerChange(analyzer)
        props.onSourceChange('mic')
      })
      .catch((e: unknown) => {
        setMicConnecting(false)
        setMicError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Microphone access denied. Check browser permissions.'
            : e instanceof Error
              ? e.message
              : 'Failed to access microphone',
        )
      })
  }

  function disableMic() {
    const a = liveAnalyzer()
    if (a) {
      a.dispose()
      props.onLiveAnalyzerChange(undefined)
    }
    props.onSourceChange('file')
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Clean up mic if active when closing
      const a = liveAnalyzer()
      if (a) {
        a.dispose()
        props.onLiveAnalyzerChange(undefined)
      }
      props.onClose()
    }
  }

  function applyPreset(preset: AudioPreset) {
    props.onMappingChange({
      preset,
      mappings: PRESET_MAPPINGS[preset].map((m) => ({ ...m })),
    })
  }

  function updateMapping(index: number, updates: Partial<ParamMapping>) {
    const current = audioMapping()
    const next = current.mappings.map((m, i) =>
      i === index ? { ...m, ...updates } : m,
    )
    // Switch to custom when user modifies a preset
    const preset = current.preset !== 'custom' ? 'custom' : current.preset
    props.onMappingChange({ preset, mappings: next })
  }

  function removeMapping(index: number) {
    const current = audioMapping()
    const next = current.mappings.filter((_, i) => i !== index)
    props.onMappingChange({ preset: 'custom', mappings: next })
  }

  function addMapping() {
    const current = audioMapping()
    props.onMappingChange({
      preset: 'custom',
      mappings: [
        ...current.mappings,
        {
          audioFeature: 'bass',
          flameParam: 'vibrancy',
          sensitivity: 1,
          range: [0.5, 1.5],
        },
      ],
    })
  }

  window.addEventListener('keydown', handleKey)
  onCleanup(() => {
    window.removeEventListener('keydown', handleKey)
  })

  const fileName = createMemo(() => {
    return audioFileName() ?? 'Audio Track'
  })

  return (
    <div class={ui.container}>
      <div class={ui.header}>
        <span class={ui.title}>Audio Reactive</span>
        <div class={ui.sourceToggle}>
          <button
            class={
              ui.sourceBtn +
              (audioSource() === 'file' ? ` ${ui.sourceBtnActive}` : '')
            }
            onClick={() => {
              disableMic()
            }}
          >
            File
          </button>
          <button
            class={
              ui.sourceBtn +
              (audioSource() === 'mic' ? ` ${ui.sourceBtnActive}` : '')
            }
            onClick={() => {
              if (audioSource() !== 'mic') enableMic()
            }}
          >
            Mic
          </button>
        </div>
        <button class={ui.closeBtn} onClick={() => { handleKey({ key: 'Escape' } as KeyboardEvent); }} title="Close (Esc)">
          <Cross />
        </button>
      </div>

      <div class={ui.body}>
        {/* Mic mode */}
        <Show when={audioSource() === 'mic'}>
          <div class={ui.micSection}>
            <Show
              when={!micConnecting() && !micError() && liveAnalyzer()}
              fallback={
                <Show when={micConnecting()}>
                  <div class={ui.micStatus}>
                    <span class={`${ui.micDot  } ${  ui.micDotPulse}`} />
                    Requesting microphone access...
                  </div>
                </Show>
              }
            >
              <div class={ui.micStatus}>
                <span class={ui.micDot} />
                Live — fractal reacts to ambient sound
              </div>
            </Show>
            <Show when={micError()}>
              <div class={ui.micError}>{micError()}</div>
            </Show>
          </div>
        </Show>

        {/* File mode: drop zone or waveform */}
        <Show when={audioSource() === 'file'}>
          <Show
            when={!audioBuffer()}
            fallback={
            <>
              {/* Audio loaded state */}
              <div class={ui.audioInfo}>
                <span class={ui.audioFileName}>{fileName()}</span>
                <span class={ui.audioDuration}>
                  {audioBuffer()!.duration.toFixed(1)}s
                </span>
                <button
                  class={ui.clearAudioBtn}
                  onClick={() => {
                    props.onAudioChange(undefined)
                    setAudioFileName(null)
                  }}
                >
                  Clear
                </button>
              </div>

              {/* Waveform */}
              <div class={ui.waveformWrap}>
                <Show when={analyzing()}>
                  <div class={ui.analyzeOverlay}>
                    <span class={ui.analyzeLabel}>Analyzing audio...</span>
                    <div class={ui.progressTrack}>
                      <div
                        class={ui.progressFill}
                        style={{ width: `${analyzeProgress()}%` }}
                      />
                    </div>
                    <span class={ui.analyzePercent}>{analyzeProgress()}%</span>
                  </div>
                </Show>
                <canvas
                  ref={waveformCanvas}
                  class={
                    ui.waveform + (analyzing() ? ` ${ui.waveformHidden}` : '')
                  }
                />
              </div>
            </>
          }
        >
          <div
            class={ui.dropZone + (dragOver() ? ` ${ui.dropZoneActive}` : '')}
            onClick={() => {
              fileInput.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div class={ui.dropIcon}>🎵</div>
            <div class={ui.dropLabel}>
              {loading() ? 'Loading...' : 'Drop audio file or click to browse'}
            </div>
            <div class={ui.dropFormats}>MP3, WAV, OGG, FLAC</div>
            <Show when={error()}>
              <div style="color: #ff5a5a; font-size: 12px; margin-top: 8px;">
                {error()!}
              </div>
            </Show>
          </div>
          <input
            ref={(el) => {
              fileInput = el
            }}
            type="file"
            accept={SUPPORTED_AUDIO}
            style="display:none"
            onChange={handleFileInput}
          />
        </Show>
        </Show>

        {/* Presets */}
        <div>
          <div class={ui.sectionLabel}>Preset</div>
          <div class={ui.presetRow}>
            <For each={Object.keys(PRESET_LABELS) as AudioPreset[]}>
              {(preset) => (
                <button
                  class={
                    ui.presetBtn +
                    (audioMapping().preset === preset
                      ? ` ${ui.presetBtnActive}`
                      : '')
                  }
                  onClick={() => {
                    applyPreset(preset)
                  }}
                >
                  {PRESET_LABELS[preset]}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Mappings */}
        <div>
          <div class={ui.sectionLabel}>Mappings</div>
          <div class={ui.mappingsList}>
            <For each={audioMapping().mappings}>
              {(mapping, index) => (
                <div class={ui.mappingRow}>
                  <select
                    class={ui.mappingSelect}
                    value={mapping.audioFeature}
                    onChange={(e) => {
                      updateMapping(index(), {
                        audioFeature: e.currentTarget.value as AudioFeature,
                      })
                    }}
                  >
                    <For each={ALL_FEATURES}>
                      {(f) => (
                        <option value={f}>{AUDIO_FEATURE_LABELS[f]}</option>
                      )}
                    </For>
                  </select>
                  <span class={ui.arrow}>→</span>
                  <select
                    class={ui.mappingSelect}
                    value={mapping.flameParam}
                    onChange={(e) => {
                      updateMapping(index(), {
                        flameParam: e.currentTarget.value as FlameParam,
                      })
                    }}
                  >
                    <For each={ALL_PARAMS}>
                      {(p) => (
                        <option value={p}>{FLAME_PARAM_LABELS[p]}</option>
                      )}
                    </For>
                  </select>
                  <span class={ui.sensitivityLabel}>
                    {mapping.sensitivity.toFixed(1)}x
                  </span>
                  <input
                    type="range"
                    class={ui.sensitivitySlider}
                    min="0.1"
                    max="2"
                    step="0.1"
                    value={mapping.sensitivity}
                    onInput={(e) => {
                      updateMapping(index(), {
                        sensitivity: parseFloat(e.currentTarget.value),
                      })
                    }}
                  />
                  <button
                    class={ui.removeMappingBtn}
                    onClick={() => {
                      removeMapping(index())
                    }}
                    title="Remove mapping"
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
          <button class={ui.addMappingBtn} onClick={addMapping}>
            + Add mapping
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div class={ui.bottomBar}>
        <label class={ui.enableToggle}>
          <button
            class={
              ui.toggleSwitch +
              (props.audioEnabled() ? ` ${ui.toggleSwitchOn}` : '')
            }
            onClick={() => {
              props.onEnabledChange(!props.audioEnabled())
            }}
            aria-label="Toggle audio reactive preview"
          >
            <span class={ui.toggleKnob} />
          </button>
          Live Preview
        </label>
      </div>
    </div>
  )
}
