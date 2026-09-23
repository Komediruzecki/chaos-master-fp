// The arena's top bar names the arena it stages and draws its streak with an SVG icon.
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { ArenaTopBar } from './ArenaTopBar'
import type { ArenaTopBarProps } from './ArenaTopBar'

function mountTopBar(overrides: Partial<ArenaTopBarProps> = {}) {
  return render(() => (
    <ArenaTopBar
      winStreak={0}
      gameState="idle"
      rounds={[]}
      activeRoundIndex={0}
      winner={null}
      commentary={null}
      eventBanner={null}
      dimensions={3}
      onReplay={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  ))
}

describe('ArenaTopBar', () => {
  afterEach(() => {
    cleanup()
  })

  it('titles a 2D arena 2D and a 3D arena 3D', () => {
    mountTopBar({ dimensions: 2 })
    expect(screen.getByRole('heading').textContent).toBe('Flame Clash Arena 2D')
    cleanup()
    mountTopBar({ dimensions: 3 })
    expect(screen.getByRole('heading').textContent).toBe('Flame Clash Arena 3D')
  })

  it('draws the streak with an SVG icon, not a text glyph', () => {
    mountTopBar({ winStreak: 2 })
    const badge = screen.getByTitle('Current Arena Win Streak')
    expect(badge.querySelector('svg')).not.toBeNull()
    expect(badge.textContent).toBe('Streak: 2 Wins')
  })
})
