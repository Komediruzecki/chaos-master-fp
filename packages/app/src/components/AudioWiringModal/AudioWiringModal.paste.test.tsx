// Pins pasting copied wiring onto another transform: the pasted targets name
// the transform they land on by key, not the one they were copied from.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioWiringModal } from './AudioWiringModal'
import type { AudioMappingEntry, FlameTarget, TransformInfo, } from '@/utils/audioAnalysis'

const transforms: TransformInfo[] = [
  {
    id: 't_first',
    index: 0,
    label: 'Tx 0: first',
    variations: [{ id: 'v_a', type: 'linearVar' }],
  },
  {
    id: 't_second',
    index: 1,
    label: 'Tx 1: second',
    variations: [{ id: 'v_b', type: 'linearVar' }],
  },
]

const copied: FlameTarget = {
  kind: 'variationWeight',
  transformIdx: 0,
  transformId: 't_first',
  variationType: 'linearVar',
  variationId: 'v_a',
}

describe('AudioWiringModal paste', () => {
  beforeEach(() => {
    // The modal remembers its view mode in localStorage, which the test
    // environment does not provide.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('names the transform the wiring is pasted onto', () => {
    const changes: AudioMappingEntry[][] = []
    render(() => (
      <AudioWiringModal
        mappings={[
          {
            audioFeature: 'bass',
            target: copied,
            sensitivity: 1,
            range: [0, 1],
          },
        ]}
        transforms={transforms}
        onMappingsChange={(next) => changes.push(next)}
        onClose={() => undefined}
      />
    ))
    fireEvent.click(screen.getAllByTitle('Copy wiring from this transform')[0]!)
    fireEvent.click(screen.getAllByTitle('Paste wiring to this transform')[1]!)
    expect(changes.at(-1)?.map((mapping) => mapping.target)).toEqual([
      copied,
      {
        kind: 'variationWeight',
        transformIdx: 1,
        transformId: 't_second',
        variationType: 'linearVar',
        variationId: 'v_b',
      },
    ])
  })
})
