// Pins the wiring editor's import: wiring that does not fit keeps the panel
// open with the reason, wiring the workspace refuses keeps it open too, and
// wiring that fits replaces the mappings and closes it.
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioWiringModal } from './AudioWiringModal'
import type { AudioMappingEntry } from '@/utils/audioAnalysis'

const row: AudioMappingEntry = {
  audioFeature: 'bass',
  target: { kind: 'renderSetting', param: 'exposure' },
  sensitivity: 1,
  range: [0.5, 1.5],
}

async function importText(text: string, accept: boolean) {
  const changes: AudioMappingEntry[][] = []
  render(() => (
    <AudioWiringModal
      mappings={[]}
      transforms={[]}
      onMappingsChange={(next) => {
        changes.push(next)
        return accept
      }}
      onClose={() => undefined}
    />
  ))
  fireEvent.click(screen.getByText('Import…'))
  const box = await screen.findByPlaceholderText('Paste wiring JSON here…')
  fireEvent.input(box, { target: { value: text } })
  fireEvent.click(screen.getByText('Apply wiring'))
  return changes
}

describe('AudioWiringModal import', () => {
  beforeEach(() => {
    // The modal remembers its view mode in localStorage, and reads the
    // clipboard on Import; the test environment provides neither.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    vi.stubGlobal('navigator', {
      clipboard: { readText: () => Promise.reject(new Error('denied')) },
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the panel open and says why when a row does not fit', async () => {
    const changes = await importText(
      JSON.stringify([{ ...row, audioFeature: 'treble' }]),
      true,
    )
    expect(changes).toEqual([])
    expect(screen.getByRole('alert').textContent).toMatch(
      /^This wiring does not fit: 0\.audioFeature/,
    )
    expect(screen.getByText('Apply wiring')).toBeTruthy()
  })

  it('keeps the panel open when the workspace refuses the wiring', async () => {
    const changes = await importText(JSON.stringify([row]), false)
    expect(changes).toEqual([[row]])
    expect(screen.getByRole('alert').textContent).toBe(
      'The workspace did not take this wiring, so nothing changed.',
    )
  })

  it('applies wiring that fits and closes the panel', async () => {
    const changes = await importText(JSON.stringify([row]), true)
    expect(changes).toEqual([[row]])
    expect(screen.queryByText('Apply wiring')).toBeNull()
  })
})
