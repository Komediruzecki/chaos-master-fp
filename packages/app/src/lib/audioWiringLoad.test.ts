// Pins what loading a flame does to the audio wiring: the rows it carries come
// back, audio that was off stays off, and a flame without wiring leaves the
// current wiring alone.
import '@/commands/builtins'
import { describe, expect, it } from 'vitest'
import { restoreLoadedAudioWiring } from './audioWiringLoad'
import type { CommandContext } from '@/commands/types'
import type { AudioMapping, AudioWiringSnapshot, } from '@/flame/schema/audioWiring'

const loaded: AudioMapping = {
  preset: 'swarm',
  mappings: [
    {
      audioFeature: 'mid',
      target: { kind: 'renderSetting', param: 'exposure' },
      sensitivity: 1,
      range: [0.8, 1.2],
    },
  ],
}

function workspace(enabled: boolean) {
  let current: AudioWiringSnapshot = {
    mapping: { preset: 'pulse', mappings: [] },
    enabled,
    source: 'mic',
  }
  const ctx = {
    audio: {
      snapshot: () => current,
      canEnable: () => true,
      setMapping: (mapping: AudioMapping) => {
        current = { ...current, mapping }
      },
      setEnabled: (on: boolean) => {
        current = { ...current, enabled: on }
      },
      setSource: (source: AudioWiringSnapshot['source']) => {
        current = { ...current, source }
      },
    },
  } as unknown as CommandContext
  return { ctx, current: () => current }
}

describe('restoreLoadedAudioWiring', () => {
  it('puts the rows back and leaves audio off', () => {
    const target = workspace(false)
    restoreLoadedAudioWiring(target.ctx, loaded)
    expect(target.current().mapping).toEqual(loaded)
    expect(target.current().enabled).toBe(false)
  })

  it('keeps audio running when it was on', () => {
    const target = workspace(true)
    restoreLoadedAudioWiring(target.ctx, loaded)
    expect(target.current().mapping).toEqual(loaded)
    expect(target.current().enabled).toBe(true)
  })

  it('leaves the wiring alone when the flame carries none', () => {
    const target = workspace(false)
    restoreLoadedAudioWiring(target.ctx, undefined)
    expect(target.current().mapping).toEqual({ preset: 'pulse', mappings: [] })
  })
})
