// Pins that a replay's starting audio wiring is stored with keys: a session
// saved before targets carried them names transforms by position only, and
// the overlay steps the wiring as stored, so the keys go on as it is loaded.
import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { createMockCommandContext, createTestFlame } from '@/webmcp/testUtils'
import { useWorkspaceReplay } from './useWorkspaceReplay'
import type { UseWorkspaceReplayParams } from './useWorkspaceReplay'
import type { AudioWiringSnapshot } from '@/flame/schema/audioWiring'

describe("a replay's starting audio wiring", () => {
  it('gives a legacy row the keys of the transform at its position', () => {
    const setMapping = vi.fn()
    const params = {
      flameDescriptor: createTestFlame(),
      cmdContext: createMockCommandContext(),
      audio: {
        setMapping,
        setEnabled: vi.fn(),
        setSource: vi.fn(),
        trackName: () => undefined,
        hasFileBuffer: () => false,
        hasLiveAnalyzer: () => false,
      },
      sonification: { loadSnapshot: vi.fn() },
    } as unknown as UseWorkspaceReplayParams
    const { replayTarget } = createRoot(() => useWorkspaceReplay(params))

    const initialAudio: AudioWiringSnapshot = {
      mapping: {
        preset: 'custom',
        mappings: [
          {
            audioFeature: 'bass',
            target: {
              kind: 'variationWeight',
              transformIdx: 1,
              variationType: 'sinusoidalVar',
            },
            sensitivity: 1,
            range: [0, 1],
          },
        ],
      },
      enabled: false,
      source: 'file',
    }
    replayTarget.loadAudio?.(initialAudio)

    expect(setMapping).toHaveBeenCalledOnce()
    expect(setMapping.mock.calls[0]![0].mappings[0].target).toEqual({
      kind: 'variationWeight',
      transformIdx: 1,
      transformId: 't2',
      variationType: 'sinusoidalVar',
      variationId: 'v2',
    })
  })
})
