/**
 * What a control the viewer had focused does once the agent takes the screen.
 *
 * The shield swallows the pointer, and the keyboard dispatchers stand down
 * under the screen lock, but a control focused before the lock kept its
 * focus: a slider still took its arrows, a field its typing, a button its
 * Space and Enter, all of them editing the take the viewer was only
 * watching. So the rest of the page is inert for as long as the agent owns
 * the screen, focus moves into the overlay, and it comes back to the
 * viewer's control when the lock and its end card are gone.
 *
 * A seat lock (a duel) leaves the page alone: the viewer is playing.
 */
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { endPilot, resetPilot, startPilot } from '@/arcade/pilot'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { PilotOverlay } from './PilotOverlay'

function drive(lock: 'screen' | 'seat') {
  startPilot({
    mode: lock === 'screen' ? 'cinema' : 'duel',
    title: 'Animating your flame',
    stepBudget: 25,
    allowed: ['timeline.'],
    qualityRankAtStart: 1,
    seatId: lock === 'screen' ? 'player' : 'rival',
    lock,
  })
}

/** A stand-in for the workspace, with the kinds of control the brief names:
 *  a slider, a text field and a button. */
function mountWorkspace() {
  const workspace = document.createElement('div')
  workspace.dataset.testid = 'workspace'
  const slider = document.createElement('input')
  slider.type = 'range'
  const field = document.createElement('input')
  field.type = 'text'
  const button = document.createElement('button')
  button.textContent = 'Apply'
  workspace.append(slider, field, button)
  document.body.append(workspace)
  return { workspace, slider, field, button }
}

function lockDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'The agent is driving the editor' })
}

afterEach(() => {
  cleanup()
  resetPilot()
  document.body.replaceChildren()
})

describe('the screen lock', () => {
  it('makes everything but the overlay inert and moves focus into it', () => {
    const { workspace, slider } = mountWorkspace()
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    slider.focus()
    expect(document.activeElement).toBe(slider)

    drive('screen')

    const dialog = lockDialog()
    expect(workspace.hasAttribute('inert')).toBe(true)
    expect(dialog.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(dialog)
    // Its own controls stay usable.
    const stop = screen.getByRole('button', {
      name: 'Stop the agent and keep what was recorded',
    })
    expect(stop.closest('[inert]')).toBeNull()
  })

  it('hands the page back when the take ends, focus to the end card, then to the control the viewer had', () => {
    const { workspace, slider } = mountWorkspace()
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    slider.focus()
    drive('screen')

    endPilot('finished', { title: 'Pendulum waltz' })

    expect(workspace.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('[inert]')).toBeNull()
    const card = screen.getByRole('dialog', { name: /Pendulum waltz/ })
    expect(document.activeElement).toBe(card)

    resetPilot()

    expect(document.activeElement).toBe(slider)
  })

  it('gives focus straight back when the lock ends with no end card', () => {
    const { button } = mountWorkspace()
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    button.focus()
    drive('screen')

    resetPilot()

    expect(document.querySelector('[inert]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('does not reach for a control that went away while the agent drove', () => {
    const { field } = mountWorkspace()
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    field.focus()
    drive('screen')
    field.remove()

    resetPilot()

    expect(document.activeElement).toBe(document.body)
  })

  it('leaves alone what was inert before the lock', () => {
    const { workspace } = mountWorkspace()
    // Home covers the workspace the same way, with its own `inert`.
    workspace.setAttribute('inert', '')
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    drive('screen')

    resetPilot()

    expect(workspace.hasAttribute('inert')).toBe(true)
  })
})

describe('a seat lock', () => {
  it('leaves the page and the focus alone', () => {
    const { workspace, slider } = mountWorkspace()
    render(() => <PilotOverlay ctx={createMockCommandContext()} />)
    slider.focus()

    drive('seat')

    expect(workspace.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(slider)
  })
})
