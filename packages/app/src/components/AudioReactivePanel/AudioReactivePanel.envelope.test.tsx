// Pins what a mapping row in the audio panel says about its envelope: the
// attack and release it runs at, including one it inherits from the other.
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioReactivePanel } from './AudioReactivePanel'
import type { AudioMapping } from './AudioReactivePanel'

vi.mock('@/utils/storage', () => ({
  safeGetItem: () => null,
  safeSetItem: () => true,
  safeRemoveItem: () => undefined,
}))

function renderPanel(mapping: AudioMapping) {
  const none = () => undefined
  const ignore = () => undefined
  render(() => (
    <AudioReactivePanel
      onClose={ignore}
      audioBuffer={none}
      onAudioChange={ignore}
      audioMapping={() => mapping}
      onMappingChange={ignore}
      audioEnabled={() => true}
      onEnabledChange={ignore}
      audioSource={() => 'file'}
      onSourceChange={ignore}
      onLiveAnalyzerChange={ignore}
      liveAnalyzer={none}
      playbackPaused={() => true}
      onPausedChange={ignore}
      playbackTime={() => 0}
      onSeek={ignore}
      fileAnalyzer={none}
      analysisProgress={() => null}
      keepPlayingWhenClosed={() => false}
      onKeepPlayingChange={ignore}
      transforms={[]}
    />
  ))
}

describe('AudioReactivePanel envelope readout', () => {
  afterEach(() => {
    cleanup()
  })

  it('names the attack and release each row runs at', () => {
    renderPanel({
      preset: 'custom',
      mappings: [
        {
          audioFeature: 'rms',
          target: { kind: 'renderSetting', param: 'exposure' },
          sensitivity: 1,
          range: [0.5, 1.5],
          attackMs: 1500,
          releaseMs: 1800,
        },
        {
          audioFeature: 'beat',
          target: { kind: 'renderSetting', param: 'palettePhase' },
          sensitivity: 1,
          range: [0, 0.12],
          releaseMs: 900,
        },
      ],
    })
    expect(screen.getByText('Attack 1500 ms · Release 1800 ms')).toBeTruthy()
    expect(screen.getByText('Attack 900 ms · Release 900 ms')).toBeTruthy()
  })
})
