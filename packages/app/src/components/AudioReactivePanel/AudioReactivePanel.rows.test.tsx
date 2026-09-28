// Pins the panel's mapping rows against targets that carry ids: a row whose
// transform was deleted says so, moving a row to another transform names that
// transform, and a variation pill picks one variation even when another in
// the same transform has the same type.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioReactivePanel } from './AudioReactivePanel'
import type { AudioMapping } from './AudioReactivePanel'
import type { FlameTarget, TransformInfo } from '@/utils/audioAnalysis'

vi.mock('@/utils/storage', () => ({
  safeGetItem: () => null,
  safeSetItem: () => true,
  safeRemoveItem: () => undefined,
}))

const transforms: TransformInfo[] = [
  {
    id: 't_first',
    index: 0,
    label: 'Tx 0: t',
    variations: [
      { id: 'v_a', type: 'linearVar' },
      { id: 'v_b', type: 'linearVar' },
    ],
  },
  {
    id: 't_second',
    index: 1,
    label: 'Tx 1: t',
    variations: [{ id: 'v_c', type: 'linearVar' }],
  },
]

function renderPanel(target: FlameTarget): () => FlameTarget {
  const [mapping, setMapping] = createSignal<AudioMapping>({
    preset: 'custom',
    mappings: [{ audioFeature: 'bass', target, sensitivity: 1, range: [0, 1] }],
  })
  const none = () => undefined
  const ignore = () => undefined
  render(() => (
    <AudioReactivePanel
      onClose={ignore}
      audioBuffer={none}
      onAudioChange={ignore}
      audioMapping={mapping}
      onMappingChange={(next) => setMapping(next)}
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
      transforms={transforms}
    />
  ))
  return () => mapping().mappings[0]!.target
}

describe('AudioReactivePanel mapping rows', () => {
  afterEach(() => {
    cleanup()
  })

  it('says so when the transform a row drives was deleted', () => {
    renderPanel({
      kind: 'transformProperty',
      transformIdx: 0,
      transformId: 't_deleted',
      property: 'probability',
    })
    const select = screen.getByLabelText<HTMLSelectElement>('Transform')
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('Deleted transform')
  })

  it('names the transform a row is moved to', () => {
    const target = renderPanel({
      kind: 'variationWeight',
      transformIdx: 0,
      transformId: 't_first',
      variationType: 'linearVar',
      variationId: 'v_b',
    })
    fireEvent.change(screen.getByLabelText('Transform'), {
      target: { value: '1' },
    })
    expect(target()).toEqual({
      kind: 'variationWeight',
      transformIdx: 1,
      transformId: 't_second',
      variationType: 'linearVar',
      variationId: 'v_c',
    })
    // The pills now offer the variations of the transform moved to.
    expect(screen.getAllByRole('button', { name: 'linearVar' })).toHaveLength(1)
  })

  it('picks one of two variations of the same type', () => {
    const target = renderPanel({
      kind: 'variationWeight',
      transformIdx: 0,
      transformId: 't_first',
      variationType: 'linearVar',
      variationId: 'v_a',
    })
    const pills = screen.getAllByRole('button', { name: 'linearVar' })
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ])
    fireEvent.click(pills[1]!)
    expect(target()).toMatchObject({ variationId: 'v_b' })
    expect(
      screen
        .getAllByRole('button', { name: 'linearVar' })
        .map((pill) => pill.getAttribute('aria-pressed')),
    ).toEqual(['false', 'true'])
  })
})
