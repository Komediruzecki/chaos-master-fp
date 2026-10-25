/** Bakes are owned by the current scene: supersession, reuse and failure cannot leak a worker. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativeContactPreparation } from './nativeContactPreparation'
import type { NativeContactInput } from './nativeContactInput'
import type { NativeContactReply } from './nativeContactWorker'
import type { RookContactMotion, RookContactPhysics, } from '@/flame/chess/rookContactTypes'

const fixture = vi.hoisted(() => ({ physics: {} as RookContactPhysics }))
vi.mock('./nativeContactInput', () => ({
  nativeContactInput: (input: NativeContactInput) =>
    input.look.fracture === 'contact'
      ? {
          physics: fixture.physics,
          attacker: { radius: 1, height: 1, path: new Float32Array(6) },
          duration: 1,
          sampleRate: 1,
        }
      : undefined,
}))
class TestWorker {
  static all: TestWorker[] = []
  onmessage?: (event: MessageEvent<NativeContactReply>) => void
  onerror?: () => void
  onmessageerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    TestWorker.all.push(this)
  }
  reply(data: NativeContactReply) {
    this.onmessage?.({ data } as MessageEvent<NativeContactReply>)
  }
}
const motion: RookContactMotion = {
  poses: new Float32Array([0, 0, 0, 0, 0, 0, 0, 1]),
  sampleRate: 120,
  frameCount: 1,
  chunkCount: 1,
  brokenAt: new Float32Array([-1]),
  stats: {
    boxCount: 1,
    steps: 0,
    contacts: 0,
    brokenBonds: 0,
    firstContact: -1,
    maxPenetration: 0,
  },
}
const receipt = applyChessMove(
  createChessGame('7k/8/8/3r4/4P3/8/8/K7 w - - 0 1'),
  { from: 'e4', to: 'd5' },
).receipt
const input: NativeContactInput = {
  receipt,
  look: {
    collectionId: 'lattice-court',
    enclosure: 'glass',
    scale: 0.9,
    fracture: 'contact',
  },
  clouds: [],
}
beforeEach(() => {
  TestWorker.all = []
  vi.stubGlobal('Worker', TestWorker)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('contact preparation ownership', () => {
  it('shares pending and completed takes through enclosure changes without detaching physics', async () => {
    const owner = createNativeContactPreparation()
    const first = owner.prepare(input)
    expect(
      owner.prepare({ ...input, look: { ...input.look, enclosure: 'pure' } }),
    ).toBe(first)
    const worker = TestWorker.all[0]!
    const [request, transfer] = worker.postMessage.mock.calls[0]!
    expect(request.physics).toBe(fixture.physics)
    expect(transfer).toEqual([request.attacker.path.buffer])
    worker.reply({ motion })
    const prepared = await first
    expect(await owner.prepare(input)).toBe(prepared)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(TestWorker.all).toHaveLength(1)
    owner.dispose()
  })

  it('cancels superseded work, ignores its late reply, and bounds cached takes', async () => {
    const owner = createNativeContactPreparation()
    const old = owner.prepare(input)
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    const nextInput = { ...input, look: { ...input.look, scale: 0.95 } }
    const next = owner.prepare(nextInput)
    await rejected
    TestWorker.all[0]!.reply({ motion })
    TestWorker.all[1]!.reply({ motion })
    const result = await next
    expect(result?.key).toContain('0.95')
    for (const scale of [0.85, 1]) {
      const pending = owner.prepare({
        ...input,
        look: { ...input.look, scale },
      })
      TestWorker.all.at(-1)!.reply({ motion })
      await pending
    }
    const again = owner.prepare(nextInput)
    expect(TestWorker.all).toHaveLength(5)
    TestWorker.all[4]!.reply({ motion })
    await again
    owner.dispose()
  })

  it('terminates on deadline and lets a different effect recover', async () => {
    const owner = createNativeContactPreparation()
    const pending = owner.prepare(input)
    const rejected = expect(pending).rejects.toThrow('too long')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(TestWorker.all[0]!.terminate).toHaveBeenCalledOnce()
    expect(
      await owner.prepare({
        ...input,
        look: { ...input.look, fracture: 'points' },
      }),
    ).toBeUndefined()
    const retry = owner.prepare(input)
    const closed = expect(retry).rejects.toMatchObject({ name: 'AbortError' })
    owner.dispose()
    await closed
    expect(TestWorker.all[1]!.terminate).toHaveBeenCalledOnce()
    await expect(owner.prepare(input)).rejects.toThrow('closed')
  })

  it('never reuses a victim identity from another history with the same position', async () => {
    const owner = createNativeContactPreparation()
    const first = owner.prepare(input)
    TestWorker.all[0]!.reply({ motion })
    await first
    const captured = { ...receipt.captured!, id: receipt.captured!.id + 100 }
    const second = owner.prepare({
      ...input,
      receipt: { ...receipt, captured },
    })
    expect(TestWorker.all).toHaveLength(2)
    TestWorker.all[1]!.reply({ motion })
    expect((await second)?.victimId).toBe(captured.id)
    owner.dispose()
  })
})
