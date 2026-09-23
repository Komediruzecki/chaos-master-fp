/**
 * Enter on a gallery with a selected candidate, under an Arcade lock.
 *
 * The select-then-apply grid (the breed gallery, the randomizer's own modal)
 * listens for Enter on the whole document, not on a focused cell, so taking
 * focus away from the page does not stop it: with a candidate selected
 * before the agent took the screen, Enter applied it over the take being
 * made. And it called preventDefault, so the Enter a focused Stop button
 * needed never reached it.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetPilot, startPilot } from '@/arcade/pilot'
import { examples } from '@/flame/examples'
import { deepClone } from '@/utils/clone'
import { GalleryGrid } from './GalleryGrid'

// The cells' thumbnails render through WebGPU; the key handling does not.
vi.mock('@/components/VariationSelector/VariationSelector', () => ({
  VariationPreview: () => null,
}))

function drive(lock: 'screen' | 'seat') {
  startPilot({
    mode: lock === 'screen' ? 'teach' : 'duel',
    title: 'Driving',
    stepBudget: 10,
    allowed: ['flame.'],
    qualityRankAtStart: 1,
    seatId: lock === 'screen' ? 'player' : 'rival',
    lock,
  })
}

function mountWithSelection() {
  const onApply = vi.fn()
  render(() => (
    <GalleryGrid
      candidates={[deepClone(examples.example1), deepClone(examples.example2)]}
      version={0}
      onApply={onApply}
      onMutate={() => {}}
    />
  ))
  fireEvent.click(screen.getAllByTitle('Click to select')[0]!)
  expect(onApply).not.toHaveBeenCalled()
  return onApply
}

function pressEnter(): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  })
  document.body.dispatchEvent(ev)
  return ev
}

afterEach(() => {
  cleanup()
  resetPilot()
})

describe('Enter on a gallery with a selected candidate', () => {
  it('applies nothing and claims nothing while the agent owns the screen', () => {
    const onApply = mountWithSelection()
    drive('screen')

    const ev = pressEnter()

    expect(onApply).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('applies the candidate with the lock off', () => {
    const onApply = mountWithSelection()

    const ev = pressEnter()

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('applies the candidate under a seat lock', () => {
    const onApply = mountWithSelection()
    drive('seat')

    pressEnter()

    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
