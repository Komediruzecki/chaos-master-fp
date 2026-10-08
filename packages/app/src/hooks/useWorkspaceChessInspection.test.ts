/** Leaving for inspection protects the editor and writes only a frozen copy. */
import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initExample3D } from '@/flame/examples/initExample3D'
import { deepClone } from '@/utils/clone'
import { defaultConfig } from '@/utils/timeline'
import { useWorkspaceChessInspection } from './useWorkspaceChessInspection'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

const ports = vi.hoisted(() => ({
  createCandidate: vi.fn((flame: unknown) => ({ source: { flame } })),
  saveCandidate: vi.fn(),
  saveEditorReturn: vi.fn(),
}))
vi.mock('@/flame/chess/chessCandidate', () => ({
  createChessCandidate: ports.createCandidate,
}))
vi.mock('@/flame/chess/chessCandidateHandoff', () => ({
  saveChessCandidateHandoff: ports.saveCandidate,
}))
vi.mock('@/flame/chess/chessEditorReturn', () => ({
  saveChessEditorReturn: ports.saveEditorReturn,
}))
vi.mock('@/lib/platform', () => ({ IS_NATIVE: false }))

describe('useWorkspaceChessInspection', () => {
  let dispose = () => {}

  beforeEach(() => {
    ports.createCandidate.mockReset()
    ports.createCandidate.mockImplementation((flame) => ({
      source: { flame: deepClone(flame) },
    }))
    ports.saveCandidate.mockReset()
    ports.saveEditorReturn.mockReset()
  })

  afterEach(() => {
    dispose()
  })

  function mount(prepare = vi.fn(() => Promise.resolve(true))) {
    const flame: FlameDescriptor = deepClone(initExample3D)
    flame.metadata = { name: 'Candidate source', author: '', description: '' }
    const navigate = vi.fn()
    const showToast = vi.fn()
    const timeline = {
      config: defaultConfig(),
      tracks: [],
      currentFrame: 24,
      animationEnabled: false,
    }
    const inspect = createRoot((cleanup) => {
      dispose = cleanup
      return useWorkspaceChessInspection({
        savedFlame: () => flame,
        timelineSnapshot: () => timeline,
        prepareDocumentReplacement: prepare,
        navigate,
        showToast,
      })
    })
    if (!inspect) throw new Error('Web inspection entry is missing')
    return { flame, timeline, inspect, navigate, showToast, prepare }
  }

  it('queues an independent copy before leaving in the same tab', async () => {
    const editor = mount()
    const original = deepClone(editor.flame)
    await editor.inspect()

    expect(editor.prepare).toHaveBeenCalledOnce()
    expect(ports.saveCandidate).toHaveBeenCalledOnce()
    const captured = ports.saveCandidate.mock.calls[0]?.[0].source.flame
    expect(captured).toEqual(original)
    expect(captured).not.toBe(editor.flame)
    expect(editor.flame).toEqual(original)
    expect(ports.saveEditorReturn).toHaveBeenCalledWith(
      { source: { flame: original } },
      editor.timeline,
      '/',
    )
    expect(editor.navigate).toHaveBeenCalledWith('/chess-forge')
    expect(ports.saveCandidate.mock.invocationCallOrder[0]).toBeLessThan(
      editor.navigate.mock.invocationCallOrder[0]!,
    )
    expect(editor.showToast).not.toHaveBeenCalled()
  })

  it('freezes the clicked shape while the save decision is pending', async () => {
    let accept!: (value: boolean) => void
    const prepare = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve
        }),
    )
    const editor = mount(prepare)
    const opening = editor.inspect()
    editor.flame.metadata.name = 'Later editor work'
    editor.timeline.currentFrame = 36
    accept(true)
    await opening

    expect(ports.saveCandidate.mock.calls[0]?.[0]).toMatchObject({
      source: { flame: { metadata: { name: 'Candidate source' } } },
    })
    expect(editor.flame.metadata.name).toBe('Later editor work')
    expect(ports.saveEditorReturn).toHaveBeenCalledWith(
      {
        source: {
          flame: expect.objectContaining({
            metadata: expect.objectContaining({ name: 'Later editor work' }),
          }),
        },
      },
      expect.objectContaining({ currentFrame: 36 }),
      '/',
    )
  })

  it('keeps the previous candidate and editor when the save gate declines', async () => {
    const editor = mount(vi.fn(() => Promise.resolve(false)))
    const original = deepClone(editor.flame)
    await editor.inspect()
    expect(ports.saveCandidate).not.toHaveBeenCalled()
    expect(ports.saveEditorReturn).not.toHaveBeenCalled()
    expect(editor.navigate).not.toHaveBeenCalled()
    expect(editor.flame).toEqual(original)
  })

  it('rejects an unresolved source before asking to leave', async () => {
    ports.createCandidate.mockImplementation(() => {
      throw new Error('Missing custom variation')
    })
    const editor = mount()
    await editor.inspect()
    expect(editor.prepare).not.toHaveBeenCalled()
    expect(editor.navigate).not.toHaveBeenCalled()
    expect(ports.saveCandidate).not.toHaveBeenCalled()
    expect(editor.showToast).toHaveBeenCalledWith(
      'Missing custom variation',
      6500,
    )
  })

  it('stays in the editor when incoming candidate storage refuses the write', async () => {
    ports.saveCandidate.mockImplementation(() => {
      throw new Error('Could not save candidate')
    })
    const editor = mount()
    const original = deepClone(editor.flame)
    await editor.inspect()
    expect(editor.navigate).not.toHaveBeenCalled()
    expect(editor.flame).toEqual(original)
    expect(editor.showToast).toHaveBeenCalledWith(
      'Could not save candidate',
      6500,
    )
  })

  it('keeps the prior inspection draft when return storage refuses the write', async () => {
    ports.saveEditorReturn.mockImplementation(() => {
      throw new Error('Editor return storage is full')
    })
    const editor = mount()
    await editor.inspect()
    expect(ports.saveCandidate).not.toHaveBeenCalled()
    expect(editor.navigate).not.toHaveBeenCalled()
    expect(editor.showToast).toHaveBeenCalledWith(
      'Editor return storage is full',
      6500,
    )
  })

  it('coalesces repeated clicks and abandons a pending departure on unmount', async () => {
    let accept!: (value: boolean) => void
    const prepare = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve
        }),
    )
    const editor = mount(prepare)
    const opening = editor.inspect()
    await editor.inspect()
    expect(editor.prepare).toHaveBeenCalledOnce()
    expect(ports.createCandidate).toHaveBeenCalledOnce()
    dispose()
    accept(true)
    await opening
    expect(ports.saveCandidate).not.toHaveBeenCalled()
    expect(editor.navigate).not.toHaveBeenCalled()
  })
})
