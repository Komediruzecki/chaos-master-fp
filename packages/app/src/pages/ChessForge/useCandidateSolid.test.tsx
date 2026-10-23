/** Stale background builds must never replace the solid for a newer inspection edit. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHESS_CANDIDATE_SOLID_DEFAULT, createChessCandidate, } from '@/flame/chess/chessCandidate'
import { buildFigurineStudy } from '@/flame/chess/figurineStudies'
import { useCandidateSolid } from './useCandidateSolid'
import type { CandidateSolidData, CandidateSolidReply, } from './candidateSolidWorker'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: MessageEvent<CandidateSolidReply>) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    FakeWorker.instances.push(this)
  }
  reply(data: CandidateSolidReply) {
    this.onmessage?.({ data } as MessageEvent<CandidateSolidReply>)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const initial = createChessCandidate(buildFigurineStudy('menger-rook'))
  initial.version = 2
  initial.solid = { ...CHESS_CANDIDATE_SOLID_DEFAULT }
  const [candidate, setCandidate] = createSignal(initial)
  const [enabled, setEnabled] = createSignal(true)
  let solid!: ReturnType<typeof useCandidateSolid>
  const view = render(() => {
    solid = useCandidateSolid(candidate, enabled)
    return <div />
  })
  return { candidate, setCandidate, setEnabled, solid, view }
}

describe('background candidate solid', () => {
  it('debounces edits, transfers an owned snapshot, and avoids rebuilding for a name edit', () => {
    const s = setup()
    s.setCandidate((c) => ({ ...c, placement: { ...c.placement, scale: 0.8 } }))
    vi.advanceTimersByTime(249)
    expect(FakeWorker.instances).toHaveLength(0)
    vi.advanceTimersByTime(1)
    const worker = FakeWorker.instances[0]!
    expect(worker.postMessage.mock.calls[0]![0]).toEqual({
      ...s.candidate(),
      name: 'Solid inspection',
    })
    expect(worker.postMessage.mock.calls[0]![0]).not.toBe(s.candidate())
    s.setCandidate((c) => ({ ...c, name: 'Window tower' }))
    vi.advanceTimersByTime(300)
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('builds geometry while the draft name is temporarily empty', () => {
    const s = setup()
    s.setCandidate((c) => ({ ...c, name: '' }))
    vi.advanceTimersByTime(250)
    expect(FakeWorker.instances[0]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Solid inspection' }),
    )
    expect(s.candidate().name).toBe('')
    expect(s.solid.error()).toBe('')
  })

  it('terminates an outdated build and ignores its late completion', () => {
    const s = setup()
    vi.advanceTimersByTime(250)
    const old = FakeWorker.instances[0]!
    s.setCandidate((c) => ({ ...c, solid: { ...c.solid!, spacing: 0.08 } }))
    expect(old.terminate).toHaveBeenCalledTimes(1)
    old.reply({ data: { geometryKey: 'stale' } as CandidateSolidData })
    expect(s.solid.data()).toBeUndefined()
    expect(s.solid.busy()).toBe(true)
    vi.advanceTimersByTime(250)
    const current = FakeWorker.instances[1]!
    const result = { geometryKey: 'current' } as CandidateSolidData
    current.reply({ data: result })
    expect(s.solid.data()).toBe(result)
    expect(s.solid.busy()).toBe(false)
    expect(current.terminate).toHaveBeenCalledTimes(1)
  })

  it('releases the worker and clears geometry on source view or unmount', () => {
    const s = setup()
    vi.advanceTimersByTime(250)
    const first = FakeWorker.instances[0]!
    s.setEnabled(false)
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(s.solid.data()).toBeUndefined()
    expect(s.solid.busy()).toBe(false)
    s.setEnabled(true)
    vi.advanceTimersByTime(250)
    const second = FakeWorker.instances[1]!
    s.view.unmount()
    expect(second.terminate).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported geometry and worker failure without keeping busy state', () => {
    const s = setup()
    vi.advanceTimersByTime(250)
    FakeWorker.instances[0]!.reply({
      error: 'Nonlinear maps require another adapter.',
    })
    expect(s.solid.error()).toBe('Nonlinear maps require another adapter.')
    expect(s.solid.busy()).toBe(false)
    s.setCandidate((c) => ({ ...c, placement: { ...c.placement, scale: 0.9 } }))
    expect(s.solid.error()).toBe('')
    vi.advanceTimersByTime(250)
    FakeWorker.instances[1]!.onerror?.()
    expect(s.solid.error()).toContain('solid builder stopped')
    expect(s.solid.busy()).toBe(false)
  })
})
