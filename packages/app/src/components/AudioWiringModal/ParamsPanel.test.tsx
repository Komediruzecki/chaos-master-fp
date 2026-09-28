// Pins the wiring editor's envelope sliders: they show the times the envelope
// runs at, reach a three-second attack and a six-second release, and never
// clamp a longer time an imported wiring brought.
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { ParamsPanel } from './ParamsPanel'
import type { AudioMappingEntry } from '@/utils/audioAnalysis'

const entry = (
  times: Pick<AudioMappingEntry, 'attackMs' | 'releaseMs'>,
): AudioMappingEntry => ({
  audioFeature: 'rms',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0.5, 1.5],
  ...times,
})

function renderPanel(value: AudioMappingEntry) {
  render(() => (
    <ParamsPanel
      entry={value}
      sourceByFeature={new Map()}
      onUpdate={() => undefined}
      onDelete={() => undefined}
    />
  ))
  return {
    attack: screen.getByRole<HTMLInputElement>('slider', { name: 'Attack' }),
    release: screen.getByRole<HTMLInputElement>('slider', { name: 'Release' }),
  }
}

describe('the envelope sliders', () => {
  afterEach(() => {
    cleanup()
  })

  it('reach a three-second attack and a six-second release', () => {
    const { attack, release } = renderPanel(
      entry({ attackMs: 40, releaseMs: 150 }),
    )
    expect([attack.max, release.max]).toEqual(['3000', '6000'])
  })

  it('show the attack the envelope runs at when a row sets only the release', () => {
    const { attack } = renderPanel(entry({ releaseMs: 300 }))
    expect(attack.value).toBe('300')
    expect(screen.getAllByText('300ms')).toHaveLength(2)
  })

  it('keep an imported time past their end instead of clamping it', () => {
    const { attack, release } = renderPanel(
      entry({ attackMs: 4000, releaseMs: 8000 }),
    )
    expect([attack.value, release.value]).toEqual(['4000', '8000'])
    expect(screen.getByText('8000ms')).toBeTruthy()
  })
})
