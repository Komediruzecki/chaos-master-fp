/** Late GPU picks cannot resurrect released grips or overwrite a newer gesture. */
import { describe, expect, it, vi } from 'vitest'
import { createGummyStudyInput } from './gummyStudyInput'
import { DEFAULT_GUMMY_ORBIT } from './gummyStudyMath'
import type { GummyGrip, GummyVec3 } from './gummyStudyMath'

type Pick = { point: GummyVec3; grip: GummyGrip } | undefined

function deferred() {
  let resolve!: (value: Pick) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Pick>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function picked(x: number): Exclude<Pick, undefined> {
  return {
    point: [x, 1, 0],
    grip: { center: [x, 1, 0], target: [x, 1, 0], radius: 0.25 },
  }
}

function pointer(id: number, x = 100, y = 100) {
  return {
    pointerId: id,
    clientX: x,
    clientY: y,
    button: 0,
    pointerType: 'touch',
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

function harness() {
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400)
  const captures = new Set<number>()
  canvas.setPointerCapture = (id) => {
    captures.add(id)
  }
  canvas.hasPointerCapture = (id) => captures.has(id)
  canvas.releasePointerCapture = (id) => {
    captures.delete(id)
  }
  const reads: ReturnType<typeof deferred>[] = []
  const failure = vi.fn(),
    status = vi.fn()
  const orbit = { ...DEFAULT_GUMMY_ORBIT }
  let disposed = false
  const interaction = createGummyStudyInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'drag',
    ready: () => true,
    disposed: () => disposed,
    rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
    readPick: () => {
      const read = deferred()
      reads.push(read)
      return read.promise
    },
    updateTarget: (grip, _frame, ray) => {
      grip.target = [ray.origin[0], ray.origin[1], 0]
    },
    onPickStart: vi.fn(),
    onStatus: status,
    onFailure: failure,
  })
  return {
    interaction,
    reads,
    failure,
    status,
    dispose: () => {
      disposed = true
    },
  }
}

describe('gummy study pointer readback lifetime', () => {
  it('does not restore a grip after the pointer is released while readback is pending', async () => {
    const { interaction, reads, status } = harness()
    interaction.input.pointerDown(pointer(1))
    expect(interaction.picking).toBe(true)
    interaction.input.pointerEnd(pointer(1))
    reads[0]!.resolve(picked(0))
    await reads[0]!.promise
    expect(interaction.picking).toBe(false)
    expect(interaction.grip).toBeUndefined()
    expect(status).not.toHaveBeenCalledWith('dragging')
  })

  it('keeps a newer pending pick active when an older completion arrives', async () => {
    const { interaction, reads } = harness()
    interaction.input.pointerDown(pointer(1))
    interaction.input.pointerEnd(pointer(1))
    interaction.input.pointerDown(pointer(2))
    reads[0]!.resolve(picked(0))
    await reads[0]!.promise
    expect(interaction.picking).toBe(true)
    expect(interaction.grip).toBeUndefined()
    reads[1]!.resolve(picked(2))
    await reads[1]!.promise
    expect(interaction.picking).toBe(false)
    expect(interaction.grip?.center).toEqual([2, 1, 0])
  })

  it('uses the current pointer location after delayed readback, then releases the grip on two-finger navigation', async () => {
    const { interaction, reads } = harness()
    interaction.input.pointerDown(pointer(1))
    interaction.input.pointerMove(pointer(1, 240, 180))
    reads[0]!.resolve(picked(0))
    await reads[0]!.promise
    expect(interaction.grip?.target).toEqual([2.4, 1.8, 0])
    interaction.input.pointerDown(pointer(2, 300, 200))
    expect(interaction.grip).toBeUndefined()
    expect(interaction.picking).toBe(false)
  })

  it('does not report a stale read failure after disposal', async () => {
    const { interaction, reads, failure, dispose } = harness()
    interaction.input.pointerDown(pointer(1))
    dispose()
    reads[0]!.reject(new Error('readback cancelled'))
    await reads[0]!.promise.catch(() => {})
    expect(failure).not.toHaveBeenCalled()
    expect(interaction.grip).toBeUndefined()
  })
})
