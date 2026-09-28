// Pins what opening a kept flame hands the workspace: the flame alone when
// that is all it was kept with, otherwise an animation load carrying the
// timeline, the tracks and the audio wiring.
import { describe, expect, it } from 'vitest'
import { examples } from '@/flame/examples'
import { flameLoadOf } from './flameLoad'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type { RecentFlame } from '@/utils/recentFlames'

const audio: AudioMapping = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'bass',
      target: { kind: 'renderSetting', param: 'vibrancy' },
      sensitivity: 1,
      range: [0.5, 1.5],
    },
  ],
}

const entry = (extra: Partial<RecentFlame> = {}): RecentFlame => ({
  id: 'kept',
  name: 'Kept',
  savedAt: 1,
  flame: examples.example1,
  ...extra,
})

describe('flameLoadOf', () => {
  it('is the bare flame when the entry kept nothing else', () => {
    expect(flameLoadOf(entry())).toEqual(examples.example1)
  })

  it('carries the audio wiring, even for an entry with no animation', () => {
    expect(flameLoadOf(entry({ audio }))).toEqual({
      flame: examples.example1,
      tracks: [],
      audio,
    })
  })

  it('hands over copies, never the shared stored entry', () => {
    const kept = entry({ audio })
    const load = flameLoadOf(kept)
    expect('flame' in load && load.flame).not.toBe(kept.flame)
    expect('audio' in load && load.audio).not.toBe(kept.audio)
  })
})
