import { createEffect, createMemo, createSignal, For, onCleanup, Show, } from 'solid-js'
import { Cross } from '@/icons'
import { createLiveAnalyzer, decodeAudioFile, flameTargetKey, } from '@/utils/audioAnalysis'
import { AudioWiringModal } from '../AudioWiringModal/AudioWiringModal'
import ui from './AudioReactivePanel.module.css'
import type { AffineKey, AudioAnalyzer, AudioFeature, FlameTarget, LiveAudioAnalyzer, RenderSettingKey, TransformInfo, TransformPropertyKey, } from '@/utils/audioAnalysis'

// Re-export for consumers (MainWorkspace etc.)
export type { AudioFeature, FlameTarget, TransformInfo }

// --- Types ---

export type ParamMapping = {
  audioFeature: AudioFeature
  target: FlameTarget
  sensitivity: number
  range: [number, number]
  /** Attack time in ms — how fast the value rises (0 = instant). */
  attackMs?: number
  /** Release time in ms — how fast the value falls (0 = instant). */
  releaseMs?: number
}

export type AudioMapping = {
  preset: AudioPreset
  mappings: ParamMapping[]
}

export type AudioPreset =
  | 'pulse'
  | 'groove'
  | 'ambient'
  | 'chaos'
  | 'warmth'
  | 'custom'

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
  liveAnalyzer:
    | (() => LiveAudioAnalyzer | undefined)
    | LiveAudioAnalyzer
    | undefined
  playbackPaused: () => boolean
  onPausedChange: (paused: boolean) => void
  playbackTime: () => number
  onSeek: (seconds: number) => void
  fileAnalyzer: (() => AudioAnalyzer | undefined) | AudioAnalyzer | undefined
  /** Available transforms (id+label) for per-transform target selectors. */
  transforms: TransformInfo[]
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

const RENDER_SETTING_LABELS: Record<RenderSettingKey, string> = {
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

const AFFINE_KEY_LABELS: Record<AffineKey, string> = {
  a: 'a',
  b: 'b',
  c: 'c',
  d: 'd',
  e: 'e',
  f: 'f',
}

const TRANSFORM_PROP_LABELS: Record<TransformPropertyKey, string> = {
  probability: 'Probability',
  colorX: 'Color X',
  colorY: 'Color Y',
  colorSpeed: 'Color Speed',
}

// --- Presets ---

const PRESET_MAPPINGS: Record<AudioPreset, ParamMapping[]> = {
  pulse: [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.3, 1.5],
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 1,
      range: [0, 3.14],
    },
  ],
  groove: [
    {
      audioFeature: 'mid',
      target: { kind: 'renderSetting', param: 'zoom' },
      sensitivity: 1,
      range: [0.85, 1.15],
    },
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.5, 1.5],
    },
    {
      audioFeature: 'centroid',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 1,
      range: [0, 3.14],
    },
  ],
  ambient: [
    {
      audioFeature: 'rms',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 1,
      range: [0.8, 1.2],
    },
    {
      audioFeature: 'hiMid',
      target: { kind: 'renderSetting', param: 'paletteSpeed' },
      sensitivity: 1,
      range: [0.5, 2],
    },
    {
      audioFeature: 'centroid',
      target: { kind: 'renderSetting', param: 'gamma' },
      sensitivity: 1,
      range: [0.6, 1.4],
    },
  ],
  chaos: [
    {
      audioFeature: 'flatness',
      target: { kind: 'renderSetting', param: 'contrast' },
      sensitivity: 1,
      range: [0.5, 2],
    },
    {
      audioFeature: 'fullSpectrum',
      target: { kind: 'renderSetting', param: 'skipIters' },
      sensitivity: 1,
      range: [0.8, 1.2],
    },
    {
      audioFeature: 'beat',
      target: { kind: 'renderSetting', param: 'highlightPower' },
      sensitivity: 1,
      range: [0, 3],
    },
    {
      audioFeature: 'onset',
      target: { kind: 'renderSetting', param: 'contrast' },
      sensitivity: 1,
      range: [0.8, 1.6],
    },
  ],
  warmth: [
    {
      audioFeature: 'centroid',
      target: { kind: 'renderSetting', param: 'palettePhase' },
      sensitivity: 1,
      range: [0, 3.14],
    },
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.4, 1.6],
    },
    {
      audioFeature: 'brilliance',
      target: { kind: 'renderSetting', param: 'contrast' },
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

const ALL_RENDER_PARAMS: RenderSettingKey[] = [
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

const ALL_AFFINE_KEYS: AffineKey[] = ['a', 'b', 'c', 'd', 'e', 'f']

const ALL_TRANSFORM_PROPS: TransformPropertyKey[] = [
  'probability',
  'colorX',
  'colorY',
  'colorSpeed',
]

type TargetCategory = FlameTarget['kind']
const TARGET_CATEGORIES: TargetCategory[] = [
  'renderSetting',
  'transformAffine',
  'transformProperty',
  'variationWeight',
  'finalAffine',
]
const TARGET_CATEGORY_LABELS: Record<TargetCategory, string> = {
  renderSetting: 'Render',
  transformAffine: 'Affine',
  transformProperty: 'Prop',
  variationWeight: 'Var Wt',
  finalAffine: 'Final',
}

/** Build a default target for a given category. */
function defaultTarget(
  category: TargetCategory,
  transformIdx?: number,
): FlameTarget {
  switch (category) {
    case 'renderSetting':
      return { kind: 'renderSetting', param: 'vibrancy' }
    case 'transformAffine':
      return {
        kind: 'transformAffine',
        transformIdx: transformIdx ?? 0,
        matrix: 'postAffine',
        param: 'a',
      }
    case 'transformProperty':
      return {
        kind: 'transformProperty',
        transformIdx: transformIdx ?? 0,
        property: 'probability',
      }
    case 'variationWeight':
      return {
        kind: 'variationWeight',
        transformIdx: transformIdx ?? 0,
        variationType: '',
      }
    case 'finalAffine':
      return { kind: 'finalAffine', param: 'a' }
  }
}

const SUPPORTED_AUDIO =
  '.mp3,.wav,.ogg,.flac,audio/mpeg,audio/wav,audio/ogg,audio/flac'

function resolve<T>(v: (() => T) | T): T {
  return typeof v === 'function' ? (v as () => T)() : v
}

// --- Variation weight pill picker ---

function VariationWeightPills(props: {
  mapping: ParamMapping
  transforms: TransformInfo[]
  onSelect: (variationType: string) => void
}) {
  const txIdx =
    props.mapping.target.kind === 'variationWeight'
      ? props.mapping.target.transformIdx
      : 0
  const info = props.transforms.find((t) => t.index === txIdx)
  const vars = info?.variations ?? []

  return (
    <div class={ui.variationPillsRow}>
      {vars.length === 0 ? (
        <span class={ui.noVariations}>No variations</span>
      ) : (
        vars.map((v) => (
          <button
            type="button"
            class={ui.variationPill}
            classList={{
              [ui.variationPillActive as string]:
                props.mapping.target.kind === 'variationWeight' &&
                props.mapping.target.variationType === v.type,
            }}
            title={v.type}
            onClick={() => props.onSelect(v.type)}
          >
            {v.type}
          </button>
        ))
      )}
    </div>
  )
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
  analyzer: AudioAnalyzer,
  onProgress?: (current: number, total: number) => void,
): { beatFrames: Set<number>; totalFrames: number } {
  const beats = new Set<number>()
  for (let i = 0; i < analyzer.totalFrames; i++) {
    if (analyzer.getFrameData(i).isBeat) beats.add(i)
    onProgress?.(i, analyzer.totalFrames)
  }
  return { beatFrames: beats, totalFrames: analyzer.totalFrames }
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  beats: Set<number>,
  totalFrames: number,
  playheadX?: number,
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

  // Playhead line
  if (playheadX !== undefined && playheadX >= 0 && playheadX <= width) {
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, height)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

// --- Component ---

export function AudioReactivePanel(props: AudioReactivePanelProps) {
  const [dragOver, setDragOver] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [beatProgress, setBeatProgress] = createSignal(0)
  const [audioFileName, setAudioFileName] = createSignal<string | null>(null)
  const [micError, setMicError] = createSignal<string | null>(null)
  const [micConnecting, setMicConnecting] = createSignal(false)
  const [showWiringModal, setShowWiringModal] = createSignal(false)

  let waveformCanvas!: HTMLCanvasElement
  let fileInput!: HTMLInputElement

  const [scrubbing, setScrubbing] = createSignal(false)

  const audioBuffer = () => resolve(props.audioBuffer)
  const audioMapping = () => resolve(props.audioMapping)
  const audioSource = () => resolve(props.audioSource)
  const liveAnalyzer = () => resolve(props.liveAnalyzer)
  const playbackPaused = () => resolve(props.playbackPaused)
  const playbackTime = () => resolve(props.playbackTime)
  const fileAnalyzer = () => resolve(props.fileAnalyzer)

  // Derived: true while the shared analyzer is being built (FFT pass)
  const isAnalyzing = createMemo(() => {
    const buf = audioBuffer()
    return buf != null && fileAnalyzer() == null
  })

  function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function seekFromEvent(e: MouseEvent) {
    const rect = waveformCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, x / rect.width))
    const duration = audioBuffer()?.duration ?? 0
    props.onSeek(percent * duration)
  }

  function handleWaveformClick(e: MouseEvent) {
    seekFromEvent(e)
  }

  function handleScrubStart(e: MouseEvent) {
    setScrubbing(true)
    seekFromEvent(e)
    e.preventDefault()
  }

  // Draw waveform when shared analyzer is ready
  createEffect(() => {
    const buffer = audioBuffer()
    const analyzer = fileAnalyzer()
    const canvas = waveformCanvas
    if (!buffer || !analyzer || !canvas) return

    setBeatProgress(0)
    // Yield so UI paints the progress state before scanning beat frames
    setTimeout(() => {
      const { beatFrames, totalFrames } = computeBeatFrames(
        analyzer,
        (current, total) => {
          setBeatProgress(Math.round((current / total) * 100))
        },
      )
      cachedBeatFrames = beatFrames
      cachedTotalFrames = totalFrames
      drawWaveform(canvas, buffer, beatFrames, totalFrames, 0)
      setBeatProgress(0)
    }, 30)
  })

  // Cache beat analysis for playhead redraws
  let cachedBeatFrames: Set<number> = new Set()
  let cachedTotalFrames = 0

  // Scrubbing: window-level mousemove/mouseup while dragging
  let scrubMoveHandler: ((e: MouseEvent) => void) | undefined
  let scrubUpHandler: (() => void) | undefined

  createEffect(() => {
    if (!scrubbing()) return
    scrubMoveHandler = (e: MouseEvent) => seekFromEvent(e)
    scrubUpHandler = () => setScrubbing(false)
    window.addEventListener('mousemove', scrubMoveHandler)
    window.addEventListener('mouseup', scrubUpHandler)
    onCleanup(() => {
      if (scrubMoveHandler)
        window.removeEventListener('mousemove', scrubMoveHandler)
      if (scrubUpHandler) window.removeEventListener('mouseup', scrubUpHandler)
    })
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
          target: { kind: 'renderSetting', param: 'vibrancy' },
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
        <button
          class={ui.closeBtn}
          onClick={() => {
            handleKey({ key: 'Escape' } as KeyboardEvent)
          }}
          title="Close (Esc)"
        >
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
                    <span class={`${ui.micDot} ${ui.micDotPulse}`} />
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

                {/* Playback controls */}
                <div class={ui.playbackRow}>
                  <button
                    class={ui.playPauseBtn}
                    onClick={() => {
                      props.onPausedChange(!playbackPaused())
                    }}
                    title={playbackPaused() ? 'Play' : 'Pause'}
                  >
                    {playbackPaused() ? '▶' : '⏸'}
                  </button>
                  <span class={ui.timeText}>
                    {formatTime(playbackTime())}
                    {' / '}
                    {formatTime(audioBuffer()!.duration)}
                  </span>
                </div>

                {/* Waveform */}
                <div class={ui.waveformWrap}>
                  <Show when={isAnalyzing() || beatProgress() > 0}>
                    <div class={ui.analyzeOverlay}>
                      <span class={ui.analyzeLabel}>
                        {isAnalyzing()
                          ? 'Analyzing audio...'
                          : 'Scanning beats...'}
                      </span>
                      <div class={ui.progressTrack}>
                        <div
                          class={ui.progressFill}
                          style={{ width: `${beatProgress()}%` }}
                        />
                      </div>
                      <Show when={beatProgress() > 0}>
                        <span class={ui.analyzePercent}>{beatProgress()}%</span>
                      </Show>
                    </div>
                  </Show>
                  <canvas
                    ref={waveformCanvas}
                    class={
                      ui.waveform +
                      (isAnalyzing() ? ` ${ui.waveformHidden}` : '') +
                      (isAnalyzing() ? '' : ` ${ui.waveformInteractive}`)
                    }
                    onClick={handleWaveformClick}
                    onMouseDown={handleScrubStart}
                  />
                  {/* Playhead overlay line */}
                  <Show when={!isAnalyzing()}>
                    <div
                      class={ui.playhead}
                      style={{
                        left: `${((playbackTime() / (audioBuffer()!.duration || 1)) * 100).toFixed(2)}%`,
                      }}
                    />
                  </Show>
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
                {loading()
                  ? 'Loading...'
                  : 'Drop audio file or click to browse'}
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
                  {/* Target category */}
                  <select
                    class={ui.mappingSelect}
                    value={mapping.target.kind}
                    onChange={(e) => {
                      const cat = e.currentTarget.value as TargetCategory
                      updateMapping(index(), {
                        target: defaultTarget(
                          cat,
                          mapping.target.kind === 'renderSetting' ||
                            mapping.target.kind === 'finalAffine'
                            ? 0
                            : 'transformIdx' in mapping.target
                              ? mapping.target.transformIdx
                              : 0,
                        ),
                      })
                    }}
                  >
                    <For each={TARGET_CATEGORIES}>
                      {(c) => (
                        <option value={c}>{TARGET_CATEGORY_LABELS[c]}</option>
                      )}
                    </For>
                  </select>
                  {/* Transform selector (for transform-scoped targets) */}
                  {props.transforms.length > 0 &&
                    mapping.target.kind !== 'renderSetting' &&
                    mapping.target.kind !== 'finalAffine' && (
                      <select
                        class={ui.mappingSelect}
                        value={
                          'transformIdx' in mapping.target
                            ? mapping.target.transformIdx
                            : 0
                        }
                        onChange={(e) => {
                          const ti = parseInt(e.currentTarget.value)
                          updateMapping(index(), {
                            target: {
                              ...mapping.target,
                              transformIdx: ti,
                            } as FlameTarget,
                          })
                        }}
                      >
                        <For each={props.transforms}>
                          {(t) => <option value={t.index}>{t.label}</option>}
                        </For>
                      </select>
                    )}
                  {/* Affine matrix selector (pre/post) */}
                  {mapping.target.kind === 'transformAffine' && (
                    <select
                      class={ui.mappingSelect}
                      value={mapping.target.matrix}
                      onChange={(e) => {
                        updateMapping(index(), {
                          target: {
                            ...mapping.target,
                            matrix: e.currentTarget.value as
                              | 'preAffine'
                              | 'postAffine',
                          } as FlameTarget,
                        })
                      }}
                    >
                      <option value="preAffine">Pre</option>
                      <option value="postAffine">Post</option>
                    </select>
                  )}
                  {/* Param picker: dropdown for most targets, pills for variation weight */}
                  {mapping.target.kind === 'variationWeight' ? (
                    <VariationWeightPills
                      mapping={mapping}
                      transforms={props.transforms}
                      onSelect={(variationType) => {
                        updateMapping(index(), {
                          target: {
                            ...mapping.target,
                            variationType,
                          } as FlameTarget,
                        })
                      }}
                    />
                  ) : (
                    <select
                      class={ui.mappingSelect}
                      value={
                        mapping.target.kind === 'renderSetting'
                          ? mapping.target.param
                          : mapping.target.kind === 'transformAffine' ||
                              mapping.target.kind === 'finalAffine'
                            ? mapping.target.param
                            : mapping.target.kind === 'transformProperty'
                              ? mapping.target.property
                              : ''
                      }
                      onChange={(e) => {
                        const val = e.currentTarget.value
                        const t = mapping.target
                        if (t.kind === 'renderSetting') {
                          updateMapping(index(), {
                            target: { ...t, param: val as RenderSettingKey },
                          })
                        } else if (
                          t.kind === 'transformAffine' ||
                          t.kind === 'finalAffine'
                        ) {
                          updateMapping(index(), {
                            target: { ...t, param: val as AffineKey },
                          })
                        } else if (t.kind === 'transformProperty') {
                          updateMapping(index(), {
                            target: {
                              ...t,
                              property: val as TransformPropertyKey,
                            },
                          })
                        }
                      }}
                    >
                      {mapping.target.kind === 'renderSetting' && (
                        <For each={ALL_RENDER_PARAMS}>
                          {(p) => (
                            <option value={p}>
                              {RENDER_SETTING_LABELS[p]}
                            </option>
                          )}
                        </For>
                      )}
                      {(mapping.target.kind === 'transformAffine' ||
                        mapping.target.kind === 'finalAffine') && (
                        <For each={ALL_AFFINE_KEYS}>
                          {(k) => (
                            <option value={k}>{AFFINE_KEY_LABELS[k]}</option>
                          )}
                        </For>
                      )}
                      {mapping.target.kind === 'transformProperty' && (
                        <For each={ALL_TRANSFORM_PROPS}>
                          {(p) => (
                            <option value={p}>
                              {TRANSFORM_PROP_LABELS[p]}
                            </option>
                          )}
                        </For>
                      )}
                    </select>
                  )}
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
          <div class={ui.mappingActions}>
            <button class={ui.addMappingBtn} onClick={addMapping}>
              + Add mapping
            </button>
            <button
              class={ui.wiringBtn}
              onClick={() => setShowWiringModal(true)}
            >
              ⚡ Edit Wiring
            </button>
          </div>
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

      {/* Wiring modal overlay */}
      <Show when={showWiringModal()}>
        <AudioWiringModal
          mappings={audioMapping().mappings}
          transforms={props.transforms}
          presets={PRESET_MAPPINGS}
          onMappingsChange={(mappings) => {
            props.onMappingChange({
              preset: 'custom',
              mappings,
            })
          }}
          onClose={() => setShowWiringModal(false)}
        />
      </Show>
    </div>
  )
}
