/** Page controls must reach the isolated scene without touching editor or chess documents. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createEffect, on, onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GummyBearPage } from './GummyBearPage'
import type { GummyBearSceneProps } from '@/components/GummyBear/GummyBearScene'
import type { ParticleGummyBearSceneProps } from '@/components/GummyBear/ParticleGummyBearScene'

const stubs = vi.hoisted(() => ({
  scene: undefined as GummyBearSceneProps | undefined,
  particleScene: undefined as ParticleGummyBearSceneProps | undefined,
  particleDisposals: 0,
  holdReady: false,
}))
vi.mock('@/components/GummyBear/ParticleGummyBearScene', () => ({
  ParticleGummyBearScene: (props: ParticleGummyBearSceneProps) => {
    stubs.particleScene = props
    if (!stubs.holdReady) props.onReady?.(true)
    onCleanup(() => {
      stubs.particleDisposals++
    })
    return <div data-testid="mock-particle-scene" />
  },
}))
vi.mock('@/components/GummyBear/GummyBearScene', () => ({
  GummyBearScene: (props: GummyBearSceneProps) => {
    stubs.scene = props
    createEffect(
      on(
        () => [props.experiment, props.protocol, props.geometry] as const,
        () => {
          if (!stubs.holdReady) props.onReady?.(true)
        },
      ),
    )
    return <div data-testid="mock-gummy-scene" />
  },
}))
let oldTitle: string
beforeEach(() => {
  oldTitle = document.title
  stubs.scene = undefined
  stubs.particleScene = undefined
  stubs.particleDisposals = 0
  stubs.holdReady = false
})
afterEach(() => {
  cleanup()
  document.title = oldTitle
  vi.restoreAllMocks()
})

function scene() {
  if (!stubs.scene) throw new Error('The gummy scene was not mounted')
  return stubs.scene
}

describe('GummyBearPage', () => {
  it('defaults to fine geometry and resets a changed preset while preserving material choices', () => {
    render(() => <GummyBearPage />)
    const fine = screen.getByRole('button', { name: /^Fine$/ })
    const standard = screen.getByRole('button', { name: 'Standard' })
    expect(scene().geometry).toBe('fine')
    expect(fine.getAttribute('aria-pressed')).toBe('true')
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Fragility/ }), {
      target: { value: '93' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crumble' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(fine)
    expect(scene().paused).toBe(true)
    expect(scene().resetKey).toBe(1)
    fireEvent.click(standard)
    expect(scene().geometry).toBe('standard')
    expect(scene().paused).toBe(false)
    expect(scene().demoKey).toBe(0)
    expect(scene().resetKey).toBe(0)
    expect(scene().softness).toBe(0.75)
    expect(scene().fragility).toBe(0.93)
    expect(scene().tearResponse).toBe('crumble')
    expect(scene().palette).toBe('candy')
    expect(scene().tearing).toBe(false)
    expect(standard.getAttribute('aria-pressed')).toBe('true')
    expect(fine.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(scene().geometry).toBe('standard')
    expect(scene().resetKey).toBe(1)
    fireEvent.click(standard)
    expect(scene().resetKey).toBe(1)
  })

  it('disables geometry changes while loading and retains the preset across comparison modes', () => {
    render(() => <GummyBearPage />)
    stubs.holdReady = true
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }))
    expect(scene().geometry).toBe('standard')
    const fine = screen.getByRole('button', { name: /^Fine$/ })
    expect(fine.closest('fieldset')?.disabled).toBe(true)
    fireEvent.click(fine)
    expect(scene().geometry).toBe('standard')
    stubs.holdReady = false
    scene().onReady?.(true)
    fireEvent.click(screen.getByRole('button', { name: 'Squeeze & release' }))
    expect(screen.queryByRole('group', { name: 'Geometry' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pull to tear' }))
    expect(scene().geometry).toBe('standard')
    for (const model of ['Fine crush', 'Limb pull', 'Particle jelly']) {
      fireEvent.click(screen.getByRole('button', { name: model }))
      expect(screen.queryByRole('group', { name: 'Geometry' })).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(scene().geometry).toBe('standard')
    expect(
      screen
        .getByRole('button', { name: 'Standard' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('allows a failed Fine scene to recover with Standard while protecting the material controls', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    scene().onReady?.(false)
    scene().onError?.('The simulation stopped.')
    const standard = screen.getByRole('button', { name: 'Standard' })
    const fine = screen.getByRole('button', { name: /^Fine$/ })
    const geometryFieldset = standard.closest('fieldset')!
    const materialFieldset = screen
      .getByRole('slider', { name: /Softness/ })
      .closest('fieldset')!
    expect(geometryFieldset.disabled).toBe(false)
    expect(materialFieldset.disabled).toBe(true)
    fireEvent.click(fine)
    expect(screen.getByRole('alert').textContent).toContain(
      'The simulation stopped.',
    )
    stubs.holdReady = true
    fireEvent.click(standard)
    expect(scene().geometry).toBe('standard')
    expect(scene().palette).toBe('candy')
    expect(scene().softness).toBe(0.75)
    expect(scene().tearResponse).toBe('soft')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(geometryFieldset.disabled).toBe(true)
    expect(materialFieldset.disabled).toBe(true)
    fireEvent.click(fine)
    expect(scene().geometry).toBe('standard')
    scene().onReady?.(true)
    expect(geometryFieldset.disabled).toBe(false)
    expect(materialFieldset.disabled).toBe(false)
  })

  it('defaults to soft tearing and resets only when the response changes, preserving material choices', () => {
    render(() => <GummyBearPage />)
    const soft = screen.getByRole('button', { name: 'Soft tear' })
    const crumble = screen.getByRole('button', { name: 'Crumble' })
    expect(scene().tearResponse).toBe('soft')
    expect(soft.getAttribute('aria-pressed')).toBe('true')
    expect(crumble.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(soft)
    expect(scene().resetKey).toBe(0)
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Fragility/ }), {
      target: { value: '93' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(crumble)
    expect(scene().tearResponse).toBe('crumble')
    expect(scene().resetKey).toBe(1)
    expect(scene().paused).toBe(false)
    expect(scene().softness).toBe(0.75)
    expect(scene().fragility).toBe(0.93)
    expect(scene().palette).toBe('candy')
    expect(scene().tearing).toBe(false)
    expect(soft.getAttribute('aria-pressed')).toBe('false')
    expect(crumble.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(crumble)
    expect(scene().resetKey).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(scene().tearResponse).toBe('crumble')
    expect(scene().resetKey).toBe(2)
    fireEvent.click(soft)
    expect(scene().tearResponse).toBe('soft')
    expect(scene().resetKey).toBe(3)
  })

  it('shows tear responses only in continuous tear and retains the choice across comparison models', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Crumble' }))
    fireEvent.click(screen.getByRole('button', { name: 'Squeeze & release' }))
    expect(screen.queryByRole('group', { name: 'Tear response' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pull to tear' }))
    expect(scene().tearResponse).toBe('crumble')
    expect(
      screen
        .getByRole('button', { name: 'Crumble' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    for (const model of ['Fine crush', 'Limb pull', 'Particle jelly']) {
      fireEvent.click(screen.getByRole('button', { name: model }))
      expect(screen.queryByRole('group', { name: 'Tear response' })).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(scene().tearResponse).toBe('crumble')
    expect(scene().protocol).toBe('tear')
    expect(
      screen
        .getByRole('button', { name: 'Crumble' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('places tuning and reset before the lower-priority model comparisons', () => {
    render(() => <GummyBearPage />)
    const comparisons = screen.getByRole('group', { name: 'Gummy model' })
    const fragility = screen.getByRole('slider', { name: /Fragility/ })
    for (const control of [
      screen.getByRole('button', { name: 'Reset bear' }),
      screen.getByRole('group', { name: 'Tear response' }),
      screen.getByRole('slider', { name: /Softness/ }),
      fragility,
    ])
      expect(
        control.compareDocumentPosition(comparisons) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0)
    expect(
      screen
        .getByRole('button', { name: 'Reset bear' })
        .compareDocumentPosition(fragility) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
  })

  it('keeps fragility, softness and palette independent across resets and comparison modes', () => {
    render(() => <GummyBearPage />)
    const fragility = screen.getByRole<HTMLInputElement>('slider', {
      name: /Fragility/,
    })
    fireEvent.input(fragility, { target: { value: '90' } })
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    expect(scene().fragility).toBe(0.9)
    expect(scene().softness).toBe(0.75)
    expect(scene().palette).toBe('candy')
    expect(scene().resetKey).toBe(0)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    expect(scene().tearing).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(scene().fragility).toBe(0.9)
    expect(scene().softness).toBe(0.75)
    expect(scene().palette).toBe('candy')
    fireEvent.click(screen.getByRole('button', { name: 'Fine crush' }))
    expect(screen.queryByRole('slider', { name: /Fragility/ })).toBeNull()
    expect(scene().tearing).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(scene().protocol).toBe('tear')
    expect(scene().mode).toBe('drag')
    expect(scene().fragility).toBe(0.9)
    expect(scene().tearing).toBe(false)
    expect(
      screen.getByRole<HTMLInputElement>('slider', { name: /Fragility/ }).value,
    ).toBe('90')
  })
  it('offers a tear load without changing the welded benchmarks or legacy tearing preference', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pull to tear' }))
    expect(scene().protocol).toBe('tear')
    expect(scene().tearing).toBe(true)
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Allow tearing',
    })
    expect(checkbox.disabled).toBe(false)
    expect(checkbox.checked).toBe(true)
    expect(screen.queryByRole('button', { name: 'Demo tear' })).toBeNull()
    scene().onReplay?.()
    expect(scene().demoKey).toBe(0)
    fireEvent.click(checkbox)
    expect(scene().tearing).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Stretch & release' }))
    expect(scene().protocol).toBe('stretch')
    expect(scene().tearing).toBe(false)
    expect(checkbox.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Limb pull' }))
    expect(scene().tearing).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pull to tear' }))
    expect(scene().tearing).toBe(false)
    expect(checkbox.disabled).toBe(false)
    expect(scene().demoKey).toBe(0)
    expect(scene().resetKey).toBe(0)
    expect(scene().paused).toBe(false)
  })
  it('adds an isolated particle mode while preserving the incumbent material and replay controls', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('radio', { name: 'Lagoon' }))
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    expect(screen.queryByTestId('mock-gummy-scene')).toBeNull()
    expect(screen.getByTestId('mock-particle-scene')).toBeTruthy()
    const particle = stubs.particleScene!
    expect(particle.palette).toBe('lagoon')
    expect(particle.softness).toBe(0.75)
    expect(particle.mode).toBe('drag')
    expect(particle.tearing).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Particle jelly' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.queryByRole('group', { name: 'Jelly protocol' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Demo tear/ }))
    expect(particle.demoKey).toBe(1)
    expect(screen.getByRole('button', { name: /Replay tear/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(particle.paused).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    expect(particle.tearing).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(stubs.particleDisposals).toBe(1)
    expect(screen.queryByTestId('mock-particle-scene')).toBeNull()
    expect(scene().experiment).toBe('jelly')
    expect(scene().palette).toBe('lagoon')
    expect(scene().softness).toBe(0.75)
    expect(scene().paused).toBe(false)
    expect(scene().demoKey).toBe(0)
    expect(screen.getByRole('group', { name: 'Jelly protocol' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    expect(stubs.particleScene?.tearing).toBe(false)
    expect(stubs.particleScene?.demoKey).toBe(0)
  })

  it('waits for the particle scene before enabling its actions', () => {
    render(() => <GummyBearPage />)
    stubs.holdReady = true
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Demo tear/ })
        .disabled,
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Fine crush' })).toBeTruthy()
    stubs.particleScene!.onReady?.(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Demo tear/ })
        .disabled,
    ).toBe(false)
  })
  it('places manual pause and reset controls beside the canvas on phones', () => {
    const query = '(max-width: 720px)'
    const original = window.matchMedia.bind(window)
    const compact = {
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } satisfies MediaQueryList
    vi.spyOn(window, 'matchMedia').mockImplementation((value) =>
      value === query ? compact : original(value),
    )
    render(() => <GummyBearPage />)
    expect(screen.getByTestId('gummy-studio-actions').hidden).toBe(false)
    expect(screen.getByTestId('gummy-sidebar-actions').hidden).toBe(true)
    expect(screen.queryByRole('button', { name: /Demo/ })).toBeNull()
    expect(scene().mode).toBe('drag')
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(scene().paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(scene().paused).toBe(false)
    expect(scene().resetKey).toBe(1)
    scene().onStatus?.('dragging')
    expect(
      screen.getByRole('status', { name: 'Gummy status' }).textContent,
    ).toContain('Release to let it settle')
  })

  it('starts with a fragile manual marbled jelly and offers explicit pausing and resetting', () => {
    render(() => <GummyBearPage />)
    expect(scene().palette).toBe('marble')
    expect(scene().experiment).toBe('jelly')
    expect(scene().protocol).toBe('tear')
    expect(scene().mode).toBe('drag')
    expect(scene().demoKey).toBe(0)
    expect(scene().softness).toBe(0.55)
    expect(scene().fragility).toBe(0.88)
    expect(scene().tearing).toBe(true)
    const tearing = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Allow tearing',
    })
    expect(tearing.disabled).toBe(false)
    expect(tearing.checked).toBe(true)
    expect(
      screen.getByText(
        'Higher fragility breaks connections sooner. Turn tearing off to compare the stretch.',
      ),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Continuous jelly' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('status', { name: 'Gummy status' }).textContent,
    ).toContain('Ready to tear')
    expect(
      screen.getByRole<HTMLInputElement>('slider', { name: /Fragility/ }).value,
    ).toBe('88')
    expect(screen.queryByRole('button', { name: /Demo/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(scene().paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(scene().paused).toBe(false)
    expect(scene().resetKey).toBe(1)
    expect(scene().demoKey).toBe(0)
  })
  it('preserves material and legacy tearing choices across all three experiments', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Squeeze & release' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Lagoon' }))
    const slider = screen.getByRole<HTMLInputElement>('slider', {
      name: /Softness/,
    })
    fireEvent.input(slider, { target: { value: '0.8' } })
    fireEvent.click(screen.getByRole('button', { name: /Demo squeeze/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Limb pull' }))
    expect(scene().experiment).toBe('pull')
    expect(scene().mode).toBe('drag')
    expect(scene().palette).toBe('lagoon')
    expect(scene().softness).toBe(0.8)
    expect(scene().tearing).toBe(true)
    const tearing = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Allow tearing',
    })
    expect(tearing.disabled).toBe(false)
    expect(tearing.checked).toBe(true)
    fireEvent.click(tearing)
    expect(scene().tearing).toBe(false)
    expect(scene().paused).toBe(false)
    expect(scene().demoKey).toBe(0)
    expect(screen.getByRole('button', { name: /Demo pull/ })).toBeTruthy()
    expect(screen.getByText(/feet anchored for pulling/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Demo pull/ }))
    expect(scene().demoKey).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fine crush' }))
    expect(scene().experiment).toBe('crush')
    expect(scene().mode).toBe('orbit')
    expect(scene().demoKey).toBe(0)
    expect(screen.getByText(/rests on its back beneath the press/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Demo crush/ })).toBeTruthy()
    expect(scene().tearing).toBe(false)
    expect(tearing.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(scene().experiment).toBe('jelly')
    expect(scene().palette).toBe('lagoon')
    expect(scene().softness).toBe(0.8)
    expect(scene().tearing).toBe(false)
    expect(tearing.disabled).toBe(true)
    expect(tearing.checked).toBe(false)
    expect(scene().demoKey).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Limb pull' }))
    expect(scene().tearing).toBe(false)
    expect(tearing.disabled).toBe(false)
  })
  it('resets protocol playback and waits for the new scene while retaining the material', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Squeeze & release' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Berry' }))
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Demo squeeze/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(scene().resetKey).toBe(1)
    stubs.holdReady = true
    fireEvent.click(screen.getByRole('button', { name: 'Stretch & release' }))
    expect(scene().experiment).toBe('jelly')
    expect(scene().protocol).toBe('stretch')
    expect(scene().mode).toBe('drag')
    expect(scene().paused).toBe(false)
    expect(scene().demoKey).toBe(0)
    expect(scene().resetKey).toBe(0)
    expect(scene().palette).toBe('berry')
    expect(scene().softness).toBe(0.75)
    expect(scene().tearing).toBe(false)
    expect(
      screen
        .getByRole('region', { name: 'Gummy bear studio' })
        .getAttribute('data-ready'),
    ).toBe('false')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Demo stretch/ })
        .disabled,
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Stretch & release' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    scene().onReady?.(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Demo stretch/ })
        .disabled,
    ).toBe(false)
    expect(
      screen.getByRole('status', { name: 'Gummy status' }).textContent,
    ).toContain('Ready to stretch')
    fireEvent.click(screen.getByRole('button', { name: /Demo stretch/ }))
    expect(scene().demoKey).toBe(1)
    expect(screen.getByRole('button', { name: /Replay stretch/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stretch & release' }))
    expect(scene().demoKey).toBe(1)
    stubs.holdReady = false
    fireEvent.click(screen.getByRole('button', { name: 'Squeeze & release' }))
    expect(scene().protocol).toBe('squeeze')
    expect(scene().mode).toBe('orbit')
    expect(scene().demoKey).toBe(0)
    expect(scene().palette).toBe('berry')
    expect(scene().softness).toBe(0.75)
    expect(screen.getByRole('button', { name: /Demo squeeze/ })).toBeTruthy()
  })
  it('updates material, tearing and interaction independently, and resets only the view', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Fine crush' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
    expect(scene().palette).toBe('amber')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    expect(scene().tearing).toBe(false)
    const slider = screen.getByRole<HTMLInputElement>('slider', {
      name: /Softness/,
    })
    fireEvent.input(slider, { target: { value: '0.8' } })
    expect(scene().softness).toBe(0.8)
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }))
    expect(scene().mode).toBe('orbit')
    expect(screen.getByText(/Drag to turn the bear/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(scene().resetViewKey).toBe(1)
    expect(scene().resetKey).toBe(0)
    expect(scene().palette).toBe('amber')
  })
  it('offers three solid and three patterned palettes without restarting the simulation', () => {
    render(() => <GummyBearPage />)
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    expect(
      screen.getByRole('radiogroup', { name: 'Gummy palette' }),
    ).toBeTruthy()
    const choices = [
      ['Blue', 'blue'],
      ['Amber', 'amber'],
      ['Berry', 'berry'],
      ['Candy', 'candy'],
      ['Lagoon', 'lagoon'],
      ['Marble', 'marble'],
    ] as const
    for (const [name, id] of choices) {
      const radio = screen.getByRole<HTMLInputElement>('radio', { name })
      fireEvent.click(radio)
      expect(radio.checked).toBe(true)
      expect(scene().palette).toBe(id)
      expect(scene().resetKey).toBe(0)
      expect(scene().demoKey).toBe(0)
    }
    expect(
      screen.getByText(
        'Candy and Lagoon use layers that stretch with the bear. Marble swirls flow with it, too.',
      ),
    ).toBeTruthy()
  })
  it('surfaces simulation failure and offers a reset that clears the error', () => {
    render(() => <GummyBearPage />)
    scene().onError?.('The material became unstable.')
    expect(screen.getByRole('alert').textContent).toContain(
      'The material became unstable.',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reset bear' })
        .disabled,
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(scene().resetKey).toBe(1)
  })
  it('restores the title and carries canvas keyboard callbacks to the same controls', () => {
    const mounted = render(() => <GummyBearPage />)
    expect(document.title).toBe('Gummy Study · Lumen Apeiron')
    scene().onPauseChange?.(true)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    scene().onReplay?.()
    expect(scene().demoKey).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Stretch & release' }))
    scene().onReplay?.()
    expect(scene().demoKey).toBe(1)
    scene().onReset?.()
    expect(scene().resetKey).toBe(1)
    mounted.unmount()
    expect(document.title).toBe(oldTitle)
  })
})
