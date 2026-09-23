/**
 * The orbit worker, run in this thread: its global `addEventListener` and
 * `postMessage` are stubbed, and every test imports a fresh copy, so the
 * supersede state and the orbit cache start empty each time. Counting the
 * calls to `iterateOrbit` tells a cache hit from a full iteration.
 */
import { BAILOUT, computeOrbit } from '@chaos-master/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Core from '@chaos-master/core'
import type { OrbitRequest, OrbitResponse } from './orbitProtocol'

const iterations = vi.hoisted(() => ({ runs: 0 }))

vi.mock('@chaos-master/core', async (importOriginal) => {
  const core = await importOriginal<typeof Core>()
  return {
    ...core,
    iterateOrbit: (spec: Core.OrbitSpec) => {
      iterations.runs += 1
      return core.iterateOrbit(spec)
    },
  }
})

interface Posted {
  readonly message: OrbitResponse
  readonly transfer: readonly Transferable[]
}

const MANDELBROT = {
  kind: 'mandelbrot',
  reference: { re: '-0.75', im: '0.1' },
  juliaC: { re: '-0.8', im: '0.156' },
  bits: 80,
  maxIterations: 1000,
  cMaxLog2: -10,
} as const satisfies Omit<OrbitRequest, 'id'>

const JULIA = {
  ...MANDELBROT,
  kind: 'julia',
  reference: { re: '0.1', im: '0.2' },
} as const satisfies Omit<OrbitRequest, 'id'>

/** c = 0 never escapes, so this runs all 4M iterations: seconds of work. */
const SLOW = {
  ...MANDELBROT,
  reference: { re: '0', im: '0' },
  bits: 64,
  maxIterations: 4_000_000,
} as const satisfies Omit<OrbitRequest, 'id'>

async function loadWorker() {
  let listener: ((event: MessageEvent) => void) | undefined
  const posted: Posted[] = []
  vi.stubGlobal(
    'addEventListener',
    (type: string, handler: (event: MessageEvent) => void) => {
      if (type === 'message') listener = handler
    },
  )
  vi.stubGlobal(
    'postMessage',
    (message: OrbitResponse, transfer: Transferable[] = []) => {
      posted.push({ message, transfer })
    },
  )
  await import('./orbitWorker')
  if (!listener) throw new Error('the worker listens for no messages')
  const handler = listener
  return {
    posted,
    send(data: unknown) {
      handler(new MessageEvent('message', { data }))
    },
    /** Every answer but progress, in the order they were posted. */
    answers() {
      return posted.filter((p) => p.message.type !== 'progress')
    },
    answer(id: number) {
      return posted.find(
        (p) => p.message.id === id && p.message.type !== 'progress',
      )
    },
  }
}

type LoadedWorker = Awaited<ReturnType<typeof loadWorker>>

async function doneSet(worker: LoadedWorker, id: number) {
  await vi.waitFor(() => {
    expect(worker.answer(id)).toBeDefined()
  })
  const { message, transfer } = worker.answer(id)!
  if (message.type !== 'done') throw new Error(`answered ${message.type}`)
  return { set: message.set, transfer }
}

function progressed(worker: LoadedWorker, id: number): Promise<void> {
  return vi.waitFor(() => {
    expect(
      worker.posted.some(
        (p) => p.message.type === 'progress' && p.message.id === id,
      ),
    ).toBe(true)
  })
}

beforeEach(() => {
  vi.resetModules()
  iterations.runs = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('orbitWorker', () => {
  it('answers a Mandelbrot request with the orbit of its reference', async () => {
    const worker = await loadWorker()
    worker.send({ ...MANDELBROT, id: 1 })
    const { set, transfer } = await doneSet(worker, 1)
    const expected = computeOrbit({
      startRe: '0',
      startIm: '0',
      cRe: MANDELBROT.reference.re,
      cIm: MANDELBROT.reference.im,
      bits: MANDELBROT.bits,
      maxIterations: MANDELBROT.maxIterations,
      escapeRadius: BAILOUT,
    })
    expect(set.main.length).toBe(expected.length)
    expect(set.main.escaped).toBe(expected.escaped)
    expect(set.main.data.byteLength).toBe(16 * expected.length)
    expect(set.main.bla.start).toBe(1)
    expect(set.critical).toBeUndefined()
    expect(transfer).toEqual([set.main.data, set.main.bla.data])
    expect(transfer[0]).toBe(set.main.data)
    expect(transfer[1]).toBe(set.main.bla.data)
  })

  it('answers a Julia request with its view orbit and the critical orbit of c', async () => {
    const worker = await loadWorker()
    worker.send({ ...JULIA, id: 1 })
    const { set, transfer } = await doneSet(worker, 1)
    const spec = {
      cRe: JULIA.juliaC.re,
      cIm: JULIA.juliaC.im,
      bits: JULIA.bits,
      maxIterations: JULIA.maxIterations,
      escapeRadius: BAILOUT,
    }
    const main = computeOrbit({
      ...spec,
      startRe: JULIA.reference.re,
      startIm: JULIA.reference.im,
    })
    const critical = computeOrbit({ ...spec, startRe: '0', startIm: '0' })
    // Distinct lengths, so the two orbits cannot have been swapped.
    expect(main.length).not.toBe(critical.length)
    expect(set.main.length).toBe(main.length)
    expect(set.main.escaped).toBe(main.escaped)
    expect(set.critical?.length).toBe(critical.length)
    expect(set.critical?.escaped).toBe(critical.escaped)
    // A Julia pixel starts on the orbit; its critical orbit starts one in.
    expect(set.main.bla.start).toBe(0)
    expect(set.critical?.bla.start).toBe(1)
    expect(transfer).toHaveLength(4)
  })

  it('supersedes a queued request with the one sent after it', async () => {
    const worker = await loadWorker()
    worker.send({ ...SLOW, id: 1 })
    worker.send({ ...MANDELBROT, id: 2 })
    await doneSet(worker, 2)
    expect(worker.answers().map((p) => p.message.type)).toEqual([
      'superseded',
      'done',
    ])
    expect(worker.answers()[0]?.message.id).toBe(1)
    // The slow orbit never started.
    expect(iterations.runs).toBe(1)
  })

  it('stops a request in flight at its next yield when a newer one arrives', async () => {
    const worker = await loadWorker()
    worker.send({ ...SLOW, id: 1 })
    await progressed(worker, 1)
    worker.send({ ...MANDELBROT, id: 2 })
    await doneSet(worker, 2)
    expect(worker.answers().map((p) => [p.message.type, p.message.id])).toEqual(
      [
        ['superseded', 1],
        ['done', 2],
      ],
    )
  })

  it('iterates the same request only once', async () => {
    const worker = await loadWorker()
    worker.send({ ...MANDELBROT, id: 1 })
    const first = await doneSet(worker, 1)
    worker.send({ ...MANDELBROT, id: 2 })
    const second = await doneSet(worker, 2)
    expect(iterations.runs).toBe(1)
    expect(second.set.main.length).toBe(first.set.main.length)
    // Each answer transfers buffers of its own, so the cache survives.
    expect(second.set.main.data).not.toBe(first.set.main.data)
    expect(new Uint8Array(second.set.main.data)).toEqual(
      new Uint8Array(first.set.main.data),
    )
  })

  it('keeps the critical orbit across a Julia pan', async () => {
    const worker = await loadWorker()
    worker.send({ ...JULIA, id: 1 })
    await doneSet(worker, 1)
    expect(iterations.runs).toBe(2)
    worker.send({ ...JULIA, reference: { re: '0.1', im: '0.21' }, id: 2 })
    await doneSet(worker, 2)
    expect(iterations.runs).toBe(3)
  })
})
