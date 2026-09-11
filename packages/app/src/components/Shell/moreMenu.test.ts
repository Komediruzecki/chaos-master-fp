import { describe, expect, it, vi } from 'vitest'
import { buildMoreMenu } from './moreMenu'

const LABELS = [
  'Export options',
  'Share link',
  'Advanced tools',
  'Lumen Arcade',
  'Documentation',
  'Quick GPU benchmark',
  'Benchmark Lab',
  'Settings and more',
  'Desktop layout',
]

describe('buildMoreMenu', () => {
  it('offers nothing a host cannot do', () => {
    expect(buildMoreMenu({})).toEqual([])
  })

  it('lists every item the host can do, in one order', () => {
    const handlers = {
      onOpenExportModal: vi.fn(),
      onShare: vi.fn(),
      onOpenDrawer: vi.fn(),
      onOpenArcade: vi.fn(),
      onOpenDocs: vi.fn(),
      onOpenBenchmark: vi.fn(),
      onOpenBenchmarkLab: vi.fn(),
      onOpenSettings: vi.fn(),
      onDesktopLayout: vi.fn(),
    }
    const items = buildMoreMenu(handlers)
    expect(items.map((item) => item.label)).toEqual(LABELS)

    for (const item of items) item.run()
    for (const handler of Object.values(handlers)) {
      expect(handler).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the order when only some handlers are there', () => {
    const items = buildMoreMenu({
      onDesktopLayout: () => {},
      onShare: () => {},
    })
    expect(items.map((item) => item.label)).toEqual([
      'Share link',
      'Desktop layout',
    ])
  })
})
