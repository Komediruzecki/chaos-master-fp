import '@/commands/builtins'
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockCommandContext } from '@/webmcp/testUtils'
import { AdvancedToolsDrawer, MobileBottomSurface, TabletInspectorDeck, TabletSplitLayout, TouchControlSurface, TouchHUD, } from './index'
import type { TransformId, VariationId } from '@/flame/schema/flameSchema'

describe('TouchSurface Components', () => {
  afterEach(cleanup)

  describe('TouchHUD', () => {
    it('renders the flame name, Library and the history buttons', () => {
      const ctx = createMockCommandContext()
      const onPickGallery = vi.fn()
      const onUndo = vi.fn()
      const onRedo = vi.fn()

      render(() => (
        <TouchHUD
          ctx={ctx}
          flame={ctx.flameDescriptor}
          onPickGallery={onPickGallery}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={() => true}
          canRedo={() => false}
        />
      ))

      expect(screen.getByRole('banner')).toBeTruthy()

      const library = screen.getByRole('button', { name: 'Library' })
      library.click()
      expect(onPickGallery).toHaveBeenCalled()

      // The title button keeps its tap tooltip.
      const titleBtn = screen.getByTitle(
        ctx.flameDescriptor().metadata?.name || 'Untitled flame',
      )
      titleBtn.click()
      expect(screen.getByRole('tooltip')).toBeTruthy()

      // Undo and Redo draw their disabled state instead of disappearing.
      const undo = screen.getByRole('button', { name: 'Undo' })
      const redo = screen.getByRole('button', { name: 'Redo' })
      expect((redo as HTMLButtonElement).disabled).toBe(true)
      expect((undo as HTMLButtonElement).disabled).toBe(false)
      undo.click()
      redo.click()
      expect(onUndo).toHaveBeenCalledTimes(1)
      expect(onRedo).not.toHaveBeenCalled()
    })

    it('falls back to Untitled flame when the flame has no name', () => {
      const ctx = createMockCommandContext()
      const flame = () => ({
        ...ctx.flameDescriptor(),
        metadata: { ...ctx.flameDescriptor().metadata, name: '' },
      })

      render(() => <TouchHUD ctx={ctx} flame={flame} />)

      expect(screen.getByTitle('Untitled flame')).toBeTruthy()
    })

    it('lists only the More items whose handler was given', () => {
      const ctx = createMockCommandContext()
      const onOpenExportModal = vi.fn()
      const onOpenSettings = vi.fn()

      render(() => (
        <TouchHUD
          ctx={ctx}
          flame={ctx.flameDescriptor}
          onOpenExportModal={onOpenExportModal}
          onOpenSettings={onOpenSettings}
        />
      ))

      screen.getByRole('button', { name: 'More' }).click()
      expect(screen.getByText('Settings and more')).toBeTruthy()
      expect(screen.queryByText('Share link')).toBeNull()

      screen.getByText('Export options').click()
      expect(onOpenExportModal).toHaveBeenCalled()
      // Choosing an item closes the menu.
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  describe('AdvancedToolsDrawer', () => {
    it('renders cards and dispatches actions when open', () => {
      const onClose = vi.fn()
      const onArtDirector = vi.fn()
      const onFlameClash = vi.fn()
      const onBreed = vi.fn()
      const onSwitchToDesktop = vi.fn()
      const onPickGallery = vi.fn()

      render(() => (
        <AdvancedToolsDrawer
          open={true}
          onClose={onClose}
          onArtDirector={onArtDirector}
          onFlameClash={onFlameClash}
          onBreed={onBreed}
          onSwitchToDesktop={onSwitchToDesktop}
          onPickGallery={onPickGallery}
        />
      ))

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('Browse Flame Gallery')).toBeTruthy()
      expect(screen.getByText('Switch to Desktop Layout')).toBeTruthy()
      expect(screen.getByText('Art Director Mode')).toBeTruthy()
      expect(screen.getByText('Flame Clash Arena')).toBeTruthy()
      expect(screen.getByText('Breeding & Genetics')).toBeTruthy()

      screen.getByText('Browse Flame Gallery').click()
      expect(onPickGallery).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()

      screen.getByText('Switch to Desktop Layout').click()
      expect(onSwitchToDesktop).toHaveBeenCalled()

      screen.getByText('Art Director Mode').click()
      expect(onArtDirector).toHaveBeenCalled()
    })

    it('closes on Escape key press when open', () => {
      const onClose = vi.fn()
      render(() => <AdvancedToolsDrawer open={true} onClose={onClose} />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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

    it('dispatches flame.setVariationWeight when variation slider changes', () => {
      const ctx = createMockCommandContext()

      render(() => (
        <TouchControlSurface
          ctx={ctx}
          flame={ctx.flameDescriptor}
          mode="bottom-sheet"
        />
      ))

      const slider = screen.getByLabelText(/linear weight/i)
      expect(slider).toBeTruthy()

      fireEvent.input(slider, { target: { value: '0.85' } })
      expect(ctx.setFlameDescriptor).toHaveBeenCalled()
      const t1 = ctx.flameDescriptor().transforms['t1' as TransformId]
      expect(t1?.variations['v1' as VariationId]?.weight).toBe(0.85)
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
      const onPickGallery = vi.fn()

      render(() => (
        <TabletInspectorDeck
          ctx={ctx}
          flame={ctx.flameDescriptor}
          onPickGallery={onPickGallery}
        />
      ))

      expect(
        screen.getByRole('complementary', { name: 'Tablet Touch Inspector' }),
      ).toBeTruthy()
      expect(screen.getByText('Browse Gallery')).toBeTruthy()
      const pickBtn = screen.getByRole('button', {
        name: 'Browse & load flame from gallery',
      })
      pickBtn.click()
      expect(onPickGallery).toHaveBeenCalled()
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
