/**
 * Reference-orbit worker: BigInt iteration plus BLA construction, off the
 * main thread. Raw orbits are cached, so changing only the BLA radius (a
 * zoom-out) or only the view of a Julia set (whose critical orbit does not
 * depend on it) costs a table build instead of a full iteration.
 */
import { BAILOUT, buildBla, iterateOrbit, packOrbit } from '@chaos-master/core'
import type { ReferenceOrbit } from '@chaos-master/core'
import type { GpuOrbit, OrbitRequest, OrbitResponse } from './orbitProtocol'

interface WorkerScope {
  postMessage(message: OrbitResponse, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<OrbitRequest>) => void,
  ): void
}

const scope = globalThis as unknown as WorkerScope
const { performance } = globalThis

let latestId = 0
const cache = new Map<string, ReferenceOrbit>()
/** Orbits kept, by count and by size: 20 B per iteration each. */
const CACHE_LIMIT = 4
const CACHE_BYTES = 128 * 1024 * 1024

function remember(key: string, orbit: ReferenceOrbit) {
  cache.set(key, orbit)
  const bytes = () =>
    [...cache.values()].reduce((sum, o) => sum + o.length * 20, 0)
  // Oldest first, but never the orbit just made: it is about to be used.
  while (
    cache.size > 1 &&
    (cache.size > CACHE_LIMIT || bytes() > CACHE_BYTES)
  ) {
    cache.delete(cache.keys().next().value!)
  }
}

/** Let queued messages in, so a newer request can supersede this one. */
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

class Superseded extends Error {}

async function orbitFor(
  request: OrbitRequest,
  start: { re: string; im: string },
  c: { re: string; im: string },
  progress: (fraction: number) => void,
): Promise<ReferenceOrbit> {
  const key = [
    start.re,
    start.im,
    c.re,
    c.im,
    request.bits,
    request.maxIterations,
  ].join('|')
  const hit = cache.get(key)
  if (hit) return hit
  const run = iterateOrbit({
    startRe: start.re,
    startIm: start.im,
    cRe: c.re,
    cIm: c.im,
    bits: request.bits,
    maxIterations: request.maxIterations,
    escapeRadius: BAILOUT,
  })
  let lastPost = performance.now()
  for (;;) {
    const step = run.next()
    if (step.done) {
      remember(key, step.value)
      return step.value
    }
    const now = performance.now()
    if (now - lastPost > 50) {
      lastPost = now
      progress(step.value / (request.maxIterations + 1))
      await yieldToMessages()
      if (latestId !== request.id) throw new Superseded()
    }
  }
}

function pack(
  orbit: ReferenceOrbit,
  hasDc: boolean,
  start: number,
  cMaxLog2: number,
): GpuOrbit {
  const bla = buildBla(orbit, { hasDc, start, cMaxLog2 })
  return {
    data: packOrbit(orbit),
    length: orbit.length,
    escaped: orbit.escaped,
    bla: {
      data: bla.data,
      levels: bla.levels,
      minLevel: bla.minLevel,
      start: bla.start,
      entryCount: bla.entryCount,
    },
  }
}

async function handle(request: OrbitRequest): Promise<void> {
  const t0 = performance.now()
  const zero = { re: '0', im: '0' }
  const julia = request.kind === 'julia'
  const progress = (fraction: number) => {
    scope.postMessage({
      type: 'progress',
      id: request.id,
      fraction: julia ? fraction / 2 : fraction,
    })
  }
  try {
    const main = julia
      ? await orbitFor(request, request.reference, request.juliaC, progress)
      : await orbitFor(request, zero, request.reference, progress)
    const critical = julia
      ? await orbitFor(request, zero, request.juliaC, (f) => {
          progress(1 + f)
        })
      : undefined
    const set = {
      main: pack(main, !julia, julia ? 0 : 1, request.cMaxLog2),
      critical: critical && pack(critical, false, 1, request.cMaxLog2),
    }
    const transfer = [set.main.data, set.main.bla.data]
    if (set.critical) transfer.push(set.critical.data, set.critical.bla.data)
    scope.postMessage(
      { type: 'done', id: request.id, set, ms: performance.now() - t0 },
      transfer,
    )
  } catch (error) {
    if (error instanceof Superseded) {
      scope.postMessage({ type: 'superseded', id: request.id })
    } else {
      scope.postMessage({
        type: 'error',
        id: request.id,
        message: String(error),
      })
    }
  }
}

let queue: Promise<void> = Promise.resolve()

scope.addEventListener('message', (event) => {
  const request = event.data
  latestId = request.id
  queue = queue.then(async () => {
    if (latestId === request.id) await handle(request)
    else scope.postMessage({ type: 'superseded', id: request.id })
  })
})
