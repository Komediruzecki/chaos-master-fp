import { describe, expect, it, vi } from 'vitest'
import { examples } from '@/flame/examples'
import { SESSION_FORMAT_VERSION } from '@/recorder/schema'
import { deepClone } from './clone'
import { useAppDragAndDrop } from './useAppDragAndDrop'
import type { RecordedSession } from '@/recorder/schema'

const { loadFlameFromFileMock } = vi.hoisted(() => ({
  loadFlameFromFileMock: vi.fn(),
}))

vi.mock('@/utils/useLoadFlameFromFile', () => ({
  useLoadFlameFromFile: () => loadFlameFromFileMock,
}))

function session(): RecordedSession {
  return {
    version: SESSION_FORMAT_VERSION,
    app: { version: 'test', flameSchemaVersion: 'test' },
    createdAt: '2026-08-21T12:00:00.000Z',
    initial: deepClone(examples.example1),
    actions: [],
    unnamedWriteCount: 0,
  }
}

describe('useAppDragAndDrop recording imports', () => {
  it('passes the source file with a dropped steps session', async () => {
    const droppedSession = session()
    const sourceFile = new File(['steps'], 'Dropped take.steps.json')
    loadFlameFromFileMock.mockResolvedValue({ session: droppedSession })
    const onSessionDropped = vi.fn()
    const onDrop = useAppDragAndDrop(
      { replace: vi.fn() },
      vi.fn(),
      onSessionDropped,
    )

    await onDrop(sourceFile)

    expect(onSessionDropped).toHaveBeenCalledWith(droppedSession, sourceFile)
  })
})

describe('useAppDragAndDrop flame loads', () => {
  it('hands the dropped flame its audio wiring', async () => {
    const audio = {
      preset: 'custom' as const,
      mappings: [
        {
          audioFeature: 'bass' as const,
          target: {
            kind: 'renderSetting' as const,
            param: 'vibrancy' as const,
          },
          sensitivity: 1,
          range: [0.5, 1.5] as [number, number],
        },
      ],
    }
    loadFlameFromFileMock.mockResolvedValue({
      flame: deepClone(examples.example1),
      audio,
    })
    const setLoadedAnimation = vi.fn()
    const onDrop = useAppDragAndDrop({ replace: vi.fn() }, setLoadedAnimation)

    await onDrop(new File(['{}'], 'wired.json'))

    expect(setLoadedAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ audio }),
    )
  })
})
