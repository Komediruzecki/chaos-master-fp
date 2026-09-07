import '@/commands/builtins'
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { AdvancedToolsDrawer, MobileBottomSurface, TabletInspectorDeck, TabletSplitLayout, TouchControlSurface, TouchHUD, } from './index'

describe('TouchSurface Components', () => {
  afterEach(cleanup)

  describe('TouchHUD', () => {
    it('renders flame name and action buttons', () => {
      const ctx = createMockCommandContext()
      const onMutate = vi.fn()
      const onRandomize = vi.fn()
      const onSnapshot = vi.fn()

      render(() => (
        <TouchHUD
          ctx={ctx}
          flame={ctx.flameDescriptor}
          onMutate={onMutate}
          onRandomize={onRandomize}
          onSnapshot={onSnapshot}
        />
      ))

      expect(screen.getByRole('banner')).toBeTruthy()
      expect(
        screen.getByTitle(
          ctx.flameDescriptor().metadata?.name || 'Chaos Master',
        ),
      ).toBeTruthy()

      const mutateBtn = screen.getByTitle('Mutate')
      mutateBtn.click()
      expect(onMutate).toHaveBeenCalled()

      const randBtn = screen.getByTitle('Randomize')
      randBtn.click()
      expect(onRandomize).toHaveBeenCalled()

      const snapBtn = screen.getByTitle('Snapshot PNG')
      snapBtn.click()
      expect(onSnapshot).toHaveBeenCalled()
    })
  })

  describe('AdvancedToolsDrawer', () => {
    it('renders cards and dispatches actions when open', () => {
      const onClose = vi.fn()
      const onArtDirector = vi.fn()
      const onFlameClash = vi.fn()
      const onBreed = vi.fn()

      render(() => (
        <AdvancedToolsDrawer
          open={true}
          onClose={onClose}
          onArtDirector={onArtDirector}
          onFlameClash={onFlameClash}
          onBreed={onBreed}
        />
      ))

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('Art Director Mode')).toBeTruthy()
      expect(screen.getByText('Flame Clash Arena')).toBeTruthy()
      expect(screen.getByText('Breeding & Genetics')).toBeTruthy()

      screen.getByText('Art Director Mode').click()
      expect(onArtDirector).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('does not render when open is false', () => {
      render(() => <AdvancedToolsDrawer open={false} onClose={() => {}} />)

      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('TouchControlSurface', () => {
    it('renders transform pills, tabs, and switches views', () => {
      const ctx = createMockCommandContext()

      render(() => (
        <TouchControlSurface
          ctx={ctx}
          flame={ctx.flameDescriptor}
          mode="tablet-deck"
        />
      ))

      // Check transform pill exists
      expect(screen.getByRole('button', { name: 'T1' })).toBeTruthy()

      // Check tabs exist
      const varTab = screen.getByRole('tab', { name: /Variations/i })
      const shapeTab = screen.getByRole('tab', { name: /Shape/i })
      const colourTab = screen.getByRole('tab', { name: /Colour/i })

      expect(varTab).toBeTruthy()
      expect(shapeTab).toBeTruthy()
      expect(colourTab).toBeTruthy()

      // Switch to Shape tab
      shapeTab.click()
      expect(screen.getByText(/Reset Shape/i)).toBeTruthy()

      // Switch to Colour tab
      colourTab.click()
      expect(screen.getByText(/Color Coordinate/i)).toBeTruthy()
    })
  })

  describe('MobileBottomSurface', () => {
    it('renders collapsed pill bar and expands on chip tap', () => {
      const ctx = createMockCommandContext()
      const onRandomize = vi.fn()

      render(() => (
        <MobileBottomSurface
          ctx={ctx}
          flame={ctx.flameDescriptor}
          onRandomize={onRandomize}
        />
      ))

      expect(
        screen.getByRole('region', { name: 'Mobile Controls' }),
      ).toBeTruthy()
      const openVariations = screen.getByRole('button', {
        name: 'Open Variations',
      })
      expect(openVariations).toBeTruthy()

      openVariations.click()
      // Once clicked, bottom sheet expands and renders TouchControlSurface
      expect(screen.getByRole('button', { name: 'T1' })).toBeTruthy()
    })
  })

  describe('TabletInspectorDeck', () => {
    it('renders header and embedded control surface', () => {
      const ctx = createMockCommandContext()

      render(() => (
        <TabletInspectorDeck ctx={ctx} flame={ctx.flameDescriptor} />
      ))

      expect(
        screen.getByRole('complementary', { name: 'Tablet Touch Inspector' }),
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: 'T1' })).toBeTruthy()
    })
  })

  describe('TabletSplitLayout', () => {
    it('renders split layout with canvas pane and inspector pane', () => {
      const ctx = createMockCommandContext()

      render(() => (
        <TabletSplitLayout ctx={ctx} flame={ctx.flameDescriptor}>
          <div data-testid="test-canvas-pane">Canvas Hero</div>
        </TabletSplitLayout>
      ))

      expect(
        screen.getByRole('main', { name: 'Tablet Split Studio' }),
      ).toBeTruthy()
      expect(screen.getByTestId('test-canvas-pane')).toBeTruthy()
      expect(
        screen.getByRole('complementary', { name: 'Tablet Touch Inspector' }),
      ).toBeTruthy()
    })
  })
})
