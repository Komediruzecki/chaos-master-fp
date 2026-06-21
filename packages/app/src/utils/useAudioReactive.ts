import { createEffect, onCleanup } from 'solid-js'
import { applyAudioMappingsToFlame, createAudioAnalyzer  } from './audioAnalysis'
import type { Accessor } from 'solid-js'
import type {LiveAudioAnalyzer} from './audioAnalysis';
import type { AudioMapping } from '@/components/AudioReactivePanel/AudioReactivePanel'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

type SetFlameDescriptor = (fn: (draft: FlameDescriptor) => void) => void

/**
 * Audio-reactive effect hook: plays audio through AudioContext and drives
 * flame renderSettings at 30fps synced to playback time.
 *
 * Supports two modes:
 * - File mode: when `audioBuffer` is set, decodes and plays the file.
 * - Mic mode: when `liveAnalyzer` is set, reads frames from the mic.
 *
 * Extracted from MainWorkspace to keep the component manageable.
 */
export function useAudioReactive(
  audioEnabled: Accessor<boolean>,
  audioBuffer: Accessor<AudioBuffer | undefined>,
  audioMapping: Accessor<AudioMapping>,
  setFlameDescriptor: SetFlameDescriptor,
  liveAnalyzer: Accessor<LiveAudioAnalyzer | undefined>,
  audioSource: Accessor<'file' | 'mic'>,
): void {
  createEffect(() => {
    const enabled = audioEnabled()
    if (!enabled) return

    const source = audioSource()
    const buffer = audioBuffer()
    const mic = liveAnalyzer()
    if (source === 'file' && !buffer) return
    if (source === 'mic' && !mic) return

    // --- File mode ---
    if (source === 'file' && buffer) {
      const analyzer = createAudioAnalyzer(buffer, 30)

      let audioCtx: AudioContext | undefined
      let sourceNode: AudioBufferSourceNode | undefined

      try {
        audioCtx = new AudioContext()
        sourceNode = audioCtx.createBufferSource()
        sourceNode.buffer = buffer
        sourceNode.loop = true
        sourceNode.connect(audioCtx.destination)
        sourceNode.start()
      } catch {
        // Autoplay blocked — run blind frame counter without audio.
        void audioCtx?.close()
        audioCtx = undefined
      }

      let lastFrame = -1
      const tickMs = 1000 / 30

      const interval = setInterval(() => {
        const mappings = audioMapping().mappings
        const frame = audioCtx
          ? Math.floor(audioCtx.currentTime * 30) % analyzer.totalFrames
          : lastFrame + 1
        if (frame !== lastFrame && mappings.length > 0) {
          const frameData = analyzer.getFrameData(frame % analyzer.totalFrames)
          setFlameDescriptor((draft) => {
            applyAudioMappingsToFlame(draft, frameData, mappings)
          })
          lastFrame = frame
        } else if (frame !== lastFrame) {
          lastFrame = frame
        }
      }, tickMs)

      onCleanup(() => {
        clearInterval(interval)
        try {
          sourceNode?.stop()
        } catch {
          /* already stopped */
        }
        sourceNode?.disconnect()
        void audioCtx?.close()
      })
      return
    }

    // --- Mic mode ---
    if (source === 'mic' && mic) {
      const tickMs = 1000 / 30
      const interval = setInterval(() => {
        const mappings = audioMapping().mappings
        if (mappings.length === 0) return
        const frameData = mic.getFrameData()
        setFlameDescriptor((draft) => {
          applyAudioMappingsToFlame(draft, frameData, mappings)
        })
      }, tickMs)

      onCleanup(() => {
        clearInterval(interval)
      })
    }
  })
}
