/** Page controls must reach the isolated scene without touching editor or chess documents. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { createEffect, on, onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GummyBearPage } from './GummyBearPage'
import { loadGummyPresets } from './gummyPresets'
import type { GummyBearSceneProps } from '@/components/GummyBear/GummyBearScene'
import type { ParticleGummyBearSceneProps } from '@/components/GummyBear/ParticleGummyBearScene'

const stubs = vi.hoisted(() => ({
  scene: undefined as GummyBearSceneProps | undefined,
  particleScene: undefined as ParticleGummyBearSceneProps | undefined,
  particleDisposals: 0,
  activeParticleScenes: 0,
  maxParticleScenes: 0,
  holdReady: false,
}))
vi.mock('@/components/GummyBear/ParticleGummyBearScene', () => ({
  ParticleGummyBearScene: (props: ParticleGummyBearSceneProps) => {
    stubs.particleScene = props
    stubs.activeParticleScenes++
    stubs.maxParticleScenes = Math.max(
      stubs.maxParticleScenes,
      stubs.activeParticleScenes,
    )
    if (!stubs.holdReady) props.onReady?.(true)
    onCleanup(() => {
      stubs.particleDisposals++
      stubs.activeParticleScenes--
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
let oldUrl: string
beforeEach(() => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  })
  oldTitle = document.title
  oldUrl = window.location.href
  stubs.scene = undefined
  stubs.particleScene = undefined
  stubs.particleDisposals = 0
  stubs.activeParticleScenes = 0
  stubs.maxParticleScenes = 0
  stubs.holdReady = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.title = oldTitle
  window.history.replaceState(null, '', oldUrl)
  vi.restoreAllMocks()
})

function scene() {
  if (!stubs.scene) throw new Error('The gummy scene was not mounted')
  return stubs.scene
}

describe('GummyBearPage', () => {
  it('saves the live bear tuning without resetting and applies every setting to a selected chess piece', () => {
    window.history.replaceState(null, '', '?experiment=mpm')
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByText('Fine tuning'))
    for (const [name, value] of [
      ['Softness', 0.3],
      ['Fragility', 73],
      ['Grab radius', 0.14],
      ['Grab strength', 0.42],
      ['Maximum pull', 0.65],
      ['Flow', 0.2],
      ['Viscosity', 0.8],
      ['Floor drag', 7],
      ['Gravity', 0.25],
    ] as const) {
      fireEvent.input(screen.getByRole('slider', { name: new RegExp(name) }), {
        target: { value: String(value) },
      })
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Lagoon' }))
    for (const name of [/Allow tearing/, /Pin feet to floor/, /Floor caustics/])
      fireEvent.click(screen.getByRole('checkbox', { name }))
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Preset name' }), {
      target: { value: 'Soft capture' },
    })
    const resetBeforeSave = stubs.particleScene!.resetKey
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    expect(stubs.particleScene!.resetKey).toBe(resetBeforeSave)
    expect(loadGummyPresets().presets[0]?.settings).toEqual({
      palette: 'lagoon',
      particleMaterial: 'warm',
      softness: 0.3,
      fragility: 0.73,
      tearing: false,
      pinnedFeet: false,
      caustics: false,
      grabRadius: 0.14,
      maxPull: 0.65,
      tuning: {
        grabStrength: 0.42,
        flow: 0.2,
        viscosity: 0.8,
        floorDrag: 7,
        gravity: 0.25,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rook' }))
    stubs.particleScene!.onReady?.(true)
    fireEvent.input(screen.getByRole('slider', { name: /Fragility/ }), {
      target: { value: '10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Elastic jelly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore tuning' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.9' },
    })
    for (const name of [/Allow tearing/, /Pin base to floor/, /Floor caustics/])
      fireEvent.click(screen.getByRole('checkbox', { name }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const resetBeforeApply = stubs.particleScene!.resetKey
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }))
    const particle = stubs.particleScene!
    expect(particle.fixture).toBe('rook')
    expect(particle.resetKey).toBe(resetBeforeApply + 1)
    expect(particle.paused).toBe(false)
    for (const [key, value] of Object.entries(
      loadGummyPresets().presets[0]!.settings,
    ))
      expect(particle[key as keyof ParticleGummyBearSceneProps]).toEqual(value)
  })

  it.each(['pawn', 'rook'] as const)(
    'opens the %s mould directly with transferable material controls',
    (fixture) => {
      window.history.replaceState(null, '', `?experiment=mpm&shape=${fixture}`)
      render(() => <GummyBearPage />)
      expect(stubs.particleScene?.fixture).toBe(fixture)
      expect(stubs.particleScene?.palette).toBe('marble')
      expect(screen.getByRole('button', { name: 'Reset piece' })).toBeTruthy()
      expect(
        screen.getByRole('radiogroup', { name: 'Gummy palette' }),
      ).toBeTruthy()
      fireEvent.click(screen.getByText('Fine tuning'))
      expect(
        screen.getByRole('checkbox', { name: /Pin base to floor/ }),
      ).toBeTruthy()
    },
  )

  it('carries bear tuning through both chess moulds and back without changing the material', () => {
    window.history.replaceState(null, '', '?experiment=mpm')
    render(() => <GummyBearPage />)
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.3' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Lagoon' }))
    fireEvent.click(screen.getByText('Fine tuning'))
    fireEvent.input(screen.getByRole('slider', { name: /Flow/ }), {
      target: { value: '0.25' },
    })
    for (const [label, fixture] of [
      ['Pawn', 'pawn'],
      ['Rook', 'rook'],
      ['Knight', 'knight'],
      ['Bishop', 'bishop'],
      ['Queen', 'queen'],
      ['King', 'king'],
      ['Bear', 'bear'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      const particle = stubs.particleScene!
      particle.onReady?.(true)
      expect(particle.fixture).toBe(fixture)
      expect(particle.softness).toBe(0.3)
      expect(particle.palette).toBe('lagoon')
      expect(particle.tuning?.flow).toBe(0.25)
      expect(new URL(window.location.href).searchParams.get('shape')).toBe(
        fixture,
      )
    }
  })

  it('keeps the recorded pointer guide choice across simulations without resetting them', () => {
    render(() => <GummyBearPage />)
    expect(scene().pointerGuide).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pointer guide' }))
    expect(scene().pointerGuide).toBe(false)
    expect(scene().resetKey).toBe(0)
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    const particle = stubs.particleScene!
    expect(particle.pointerGuide).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pointer guide' }))
    expect(particle.pointerGuide).toBe(true)
    expect(particle.resetKey).toBe(0)
    expect(stubs.particleScene).toBe(particle)
  })

  it('applies the short pull preset and restores tuning without losing the current bear or playback', () => {
    window.history.replaceState(null, '', '?experiment=mpm')
    render(() => <GummyBearPage />)
    const particle = stubs.particleScene!
    fireEvent.click(screen.getByText('Fine tuning'))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.input(screen.getByRole('slider', { name: /Gravity/ }), {
      target: { value: '0.5' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Viscosity/ }), {
      target: { value: '0.6' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Short pull preset' }))
    expect(particle.tuning).toEqual({
      grabStrength: 0.45,
      flow: 0.3,
      gravity: 0.5,
      viscosity: 0.6,
      floorDrag: 8,
    })
    expect(particle.grabRadius).toBe(0.14)
    expect(particle.maxPull).toBe(0.65)
    expect(particle.pinnedFeet).toBe(true)
    expect(particle.paused).toBe(true)
    expect(particle.resetKey).toBe(0)
    expect(stubs.particleScene).toBe(particle)
    fireEvent.click(screen.getByRole('button', { name: 'Restore tuning' }))
    expect(particle.tuning).toEqual({
      grabStrength: 1,
      flow: 1,
      gravity: 1,
      viscosity: 1,
      floorDrag: 5,
    })
    expect(particle.grabRadius).toBe(0.22)
    expect(particle.maxPull).toBe(1.8)
    expect(particle.paused).toBe(true)
    expect(particle.resetKey).toBe(0)
  })

  it('routes each fine tuning slider live and only offers controls used by the selected material', () => {
    window.history.replaceState(null, '', '?experiment=particle')
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByText('Fine tuning'))
    const particle = stubs.particleScene!
    for (const [name, value] of [
      ['Grab radius', 0.12],
      ['Grab strength', 0.42],
      ['Maximum pull', 0.6],
      ['Flow', 0.2],
      ['Viscosity', 0.8],
      ['Floor drag', 7],
      ['Gravity', 0.25],
    ] as const)
      fireEvent.input(screen.getByRole('slider', { name: new RegExp(name) }), {
        target: { value: String(value) },
      })
    expect(particle.tuning).toEqual({
      grabStrength: 0.42,
      flow: 0.2,
      viscosity: 0.8,
      floorDrag: 7,
      gravity: 0.25,
    })
    expect(particle.grabRadius).toBe(0.12)
    expect(particle.maxPull).toBe(0.6)
    expect(particle.resetKey).toBe(0)
    fireEvent.click(screen.getByRole('checkbox', { name: /Pin feet to floor/ }))
    expect(particle.pinnedFeet).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Restore tuning' }))
    expect(particle.pinnedFeet).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Elastic jelly' }))
    for (const name of ['Flow', 'Viscosity', 'Floor drag'])
      expect(
        screen.queryByRole('slider', { name: new RegExp(name) }),
      ).toBeNull()
    expect(screen.getByRole('slider', { name: /Gravity/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore tuning' }))
    expect(particle.grabRadius).toBe(0.28)
    fireEvent.click(screen.getByRole('button', { name: 'Two blobs' }))
    expect(
      screen.queryByRole('checkbox', { name: /Pin feet to floor/ }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(screen.queryByText('Fine tuning')).toBeNull()
  })

  it.each([
    ['mpm', 'marching-cubes', 'MPM + marching cubes'],
    ['particle', 'screen-space', 'Particle jelly'],
  ])('opens the %s comparison from its URL', (query, reconstruction, label) => {
    window.history.replaceState(null, '', `?experiment=${query}`)
    render(() => <GummyBearPage />)
    expect(stubs.particleScene?.reconstruction).toBe(reconstruction)
    expect(stubs.particleScene?.particleMaterial).toBe('warm')
    expect(stubs.particleScene?.mode).toBe('drag')
    expect(
      screen.getByRole('button', { name: label }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.queryByTestId('mock-gummy-scene')).toBeNull()
  })

  it('keeps the existing default for unknown model links and preserves unrelated URL state on selection', () => {
    window.history.replaceState(
      null,
      '',
      '?experiment=unknown&keep=example#study',
    )
    render(() => <GummyBearPage />)
    expect(scene().experiment).toBe('jelly')
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    expect(new URL(window.location.href).searchParams.get('experiment')).toBe(
      'mpm',
    )
    expect(new URL(window.location.href).searchParams.get('keep')).toBe(
      'example',
    )
    expect(window.location.hash).toBe('#study')
  })

  it('disposes each particle comparison before mounting the next, retaining material and fixture choices', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.input(screen.getByRole('slider', { name: /Softness/ }), {
      target: { value: '0.75' },
    })
    fireEvent.input(screen.getByRole('slider', { name: /Fragility/ }), {
      target: { value: '91' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Elastic jelly' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow tearing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Two blobs' }))
    stubs.particleScene!.onReady?.(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const previous = stubs.particleScene
    stubs.holdReady = true
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    const next = stubs.particleScene!
    expect(next).not.toBe(previous)
    expect(stubs.particleDisposals).toBe(1)
    expect(stubs.maxParticleScenes).toBe(1)
    expect(next.reconstruction).toBe('marching-cubes')
    expect(next.fixture).toBe('blobs')
    expect(next.palette).toBe('candy')
    expect(next.particleMaterial).toBe('elastic')
    expect(next.softness).toBe(0.75)
    expect(next.fragility).toBe(0.91)
    expect(next.tearing).toBe(false)
    expect(next.paused).toBe(false)
    expect(next.resetKey).toBe(0)
    expect(next.demoKey).toBe(0)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled,
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Particle jelly' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    stubs.holdReady = false
    next.onReady?.(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset blobs' }))
    expect(next.resetKey).toBe(1)
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    expect(stubs.particleScene).toBe(next)
    expect(next.resetKey).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    expect(stubs.particleDisposals).toBe(2)
    expect(stubs.maxParticleScenes).toBe(1)
    expect(stubs.particleScene?.reconstruction).toBe('screen-space')
    expect(stubs.particleScene?.fixture).toBe('blobs')
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(stubs.particleDisposals).toBe(3)
    expect(scene().experiment).toBe('jelly')
    expect(scene().palette).toBe('candy')
  })

  it('changes floor caustics live only in the marching comparison and retains the choice', () => {
    render(() => <GummyBearPage />)
    expect(
      screen.queryByRole('checkbox', { name: 'Floor caustics' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    const mounted = stubs.particleScene!
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Floor caustics',
    })
    expect(checkbox.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(checkbox)
    expect(stubs.particleScene).toBe(mounted)
    expect(mounted.caustics).toBe(false)
    expect(mounted.paused).toBe(true)
    expect(mounted.resetKey).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    expect(
      screen.queryByRole('checkbox', { name: 'Floor caustics' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'MPM + marching cubes' }),
    )
    expect(stubs.particleScene?.caustics).toBe(false)
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Floor caustics' })
        .checked,
    ).toBe(false)
  })

  it('switches torn surface live without remounting, resetting, or changing playback', () => {
    render(() => <GummyBearPage />)
    const mounted = scene()
    const original = screen.getByRole('button', { name: 'Original' })
    const rounded = screen.getByRole('button', { name: 'Rounded' })
    expect(scene().surface).toBe('rounded')
    expect(rounded.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Candy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(original)
    expect(scene()).toBe(mounted)
    expect(scene().surface).toBe('original')
    expect(scene().paused).toBe(true)
    expect(scene().resetKey).toBe(1)
    expect(scene().demoKey).toBe(0)
    expect(scene().palette).toBe('candy')
    expect(original.getAttribute('aria-pressed')).toBe('true')
    expect(rounded.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(rounded)
    expect(scene()).toBe(mounted)
    expect(scene().surface).toBe('rounded')
    expect(scene().paused).toBe(false)
    expect(scene().resetKey).toBe(1)
    expect(scene().demoKey).toBe(0)
    expect(
      screen.getByText(
        'Round torn corners. Switch views without resetting the bear.',
      ),
    ).toBeTruthy()
  })

  it('retains the surface choice across geometry and models and only offers it for manual tear', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    stubs.holdReady = true
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }))
    expect(scene().surface).toBe('original')
    expect(
      screen.getByRole('button', { name: 'Rounded' }).closest('fieldset')
        ?.disabled,
    ).toBe(true)
    stubs.holdReady = false
    scene().onReady?.(true)
    for (const protocol of ['Squeeze & release', 'Stretch & release']) {
      fireEvent.click(screen.getByRole('button', { name: protocol }))
      expect(screen.queryByRole('group', { name: 'Torn surface' })).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Pull to tear' }))
    expect(
      screen
        .getByRole('button', { name: 'Original' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    for (const model of ['Limb pull', 'Fine crush', 'Particle jelly']) {
      fireEvent.click(screen.getByRole('button', { name: model }))
      expect(screen.queryByRole('group', { name: 'Torn surface' })).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(scene().surface).toBe('original')
    expect(
      screen
        .getByRole('button', { name: 'Original' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

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
  it('adds an isolated manual particle mode while preserving the incumbent material controls', () => {
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
    expect(screen.queryByRole('button', { name: /Demo tear/ })).toBeNull()
    particle.onReplay?.()
    expect(particle.demoKey).toBe(0)
    expect(particle.particleMaterial).toBe('warm')
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
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled,
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Fine crush' })).toBeTruthy()
    stubs.particleScene!.onReady?.(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled,
    ).toBe(false)
  })
  it('resets material comparisons, retains the palette, and routes contact fixtures to particles only', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Particle jelly' }))
    const particle = stubs.particleScene!
    fireEvent.click(screen.getByRole('radio', { name: 'Berry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Elastic jelly' }))
    expect(particle.particleMaterial).toBe('elastic')
    expect(particle.resetKey).toBe(1)
    expect(particle.paused).toBe(false)
    expect(screen.queryByRole('slider', { name: /Fragility/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Warm jelly' }))
    expect(particle.resetKey).toBe(2)
    expect(screen.getByRole('slider', { name: /Fragility/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Two blobs' }))
    expect(particle.fixture).toBe('blobs')
    expect(particle.palette).toBe('berry')
    expect(
      screen.queryByRole('radiogroup', { name: 'Gummy palette' }),
    ).toBeNull()
    particle.onReady?.(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset blobs' }))
    expect(particle.resetKey).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^Bear$/ }))
    expect(particle.fixture).toBe('bear')
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Berry' }).checked,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(screen.queryByRole('group', { name: 'Particle study' })).toBeNull()
    expect(
      screen.queryByRole('group', { name: 'Particle material' }),
    ).toBeNull()
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
    expect(screen.getByText(/Drag to turn around the bear/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }))
    expect(scene().mode).toBe('pan')
    expect(screen.getByText(/Drag to move the view/)).toBeTruthy()
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
        'Candy and Lagoon use layers that stretch with the gummy. Marble swirls flow with it, too.',
      ),
    ).toBeTruthy()
  })
  it('surfaces simulation failure and offers a reset that clears the error', () => {
    render(() => <GummyBearPage />)
    scene().onError?.('The material became unstable.')
    expect(screen.getByRole('alert').textContent).toContain(
      'The material became unstable.',
    )
    const notice = screen.getByRole('button', { name: 'Simulation error' })
    expect(
      screen
        .getByRole('region', { name: 'Gummy bear studio' })
        .contains(notice),
    ).toBe(true)
    expect(
      screen
        .getByRole('complementary', { name: 'Gummy controls' })
        .contains(notice),
    ).toBe(false)
    fireEvent.click(notice)
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Simulation error log',
      }).value,
    ).toBe('The material became unstable.')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reset bear' })
        .disabled,
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reset bear' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Simulation error' }),
    ).toBeNull()
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
