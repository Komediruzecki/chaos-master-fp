import { describe, expect, it } from 'vitest'
import { deepClone } from '@/utils/clone'
import { createGlideRuntime, glideEnabled, glideQualityPreference, setGlideEnabled, setGlideQualityPreference, } from './runtime'
import { makeFlame } from './testUtils'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * The live driver, on a clock the test owns.
 *
 * Every write goes through `writeFlame`, which the workspace maps to
 * `history.replaceSilently` — so what this asserts about the sequence of
 * writes is what the document actually sees.
 */
function harness(start: FlameDescriptor) {
  let flame = deepClone(start)
  let time = 0
  let pending: ((time: number) => void)[] = []
  const writes: FlameDescriptor[] = []
  const runtime = createGlideRuntime({
    readFlame: () => deepClone(flame),
    writeFlame: (next) => {
      flame = deepClone(next)
      writes.push(deepClone(next))
    },
    now: () => time,
    requestFrame: (callback) => {
      pending.push(callback)
      return pending.length
    },
    cancelFrame: () => {
      pending = []
    },
  })
  return {
    runtime,
    writes,
    read: () => flame,
    set: (next: FlameDescriptor) => {
      flame = deepClone(next)
    },
    advance: (ms: number) => {
      time += ms
      const due = pending
      pending = []
      for (const callback of due) callback(time)
    },
  }
}

const A = makeFlame({
  transforms: { one: { probability: 1, preAffine: { c: 0 } } },
  renderSettings: { gamma: 2 },
})
const B = makeFlame({
  transforms: { one: { probability: 1, preAffine: { c: 4 } } },
  renderSettings: { gamma: 4 },
})

function gammaOf(flame: FlameDescriptor): number {
  return flame.renderSettings.gamma
}

describe('createGlideRuntime', () => {
  it('writes frame 0 immediately and lands on exactly the target', async () => {
    const world = harness(A)
    world.set(B)
    const done = world.runtime.glideFrom(A, { durationMs: 400 })
    expect(gammaOf(world.read())).toBeCloseTo(2, 9)
    expect(world.runtime.isGliding()).toBe(true)

    world.advance(200)
    const midway = gammaOf(world.read())
    expect(midway).toBeGreaterThan(2)
    expect(midway).toBeLessThan(4)

    world.advance(200)
    expect(world.runtime.isGliding()).toBe(false)
    expect(world.read()).toEqual(B)
    await done
  })

  it('reports a plan while it runs and nothing once it settles', async () => {
    const world = harness(A)
    world.set(B)
    const done = world.runtime.glideFrom(A, { durationMs: 400 })
    expect(world.runtime.activePlan()?.settle).toEqual(B)
    expect(world.runtime.activeQuality()?.tier).toBeDefined()
    world.advance(500)
    expect(world.runtime.activePlan()).toBeUndefined()
    expect(world.runtime.activeQuality()).toBeUndefined()
    await done
  })

  it('settles for the next change and hands back what the viewer can see', async () => {
    const world = harness(A)
    world.set(B)
    const done = world.runtime.glideFrom(A, { durationMs: 400 })
    world.advance(200)
    const visible = world.runtime.settleForNextChange()
    expect(visible).toBeDefined()
    // The intermediate the eye was on, so the next glide starts from there...
    expect(gammaOf(visible!)).toBeGreaterThan(2)
    expect(gammaOf(visible!)).toBeLessThan(4)
    // ...while the document itself has landed, so the next edit is made to the
    // state the change actually reached.
    expect(world.read()).toEqual(B)
    expect(world.runtime.isGliding()).toBe(false)
    await done
  })

  it('returns nothing to settle when nothing is in flight', () => {
    const world = harness(A)
    expect(world.runtime.settleForNextChange()).toBeUndefined()
  })

  it('cancel leaves the document where it reached, finish lands it', async () => {
    const cancelled = harness(A)
    cancelled.set(B)
    const first = cancelled.runtime.glideFrom(A, { durationMs: 400 })
    cancelled.advance(200)
    cancelled.runtime.cancel()
    expect(cancelled.read()).not.toEqual(B)
    await first

    const finished = harness(A)
    finished.set(B)
    const second = finished.runtime.glideFrom(A, { durationMs: 400 })
    finished.advance(200)
    finished.runtime.finish()
    expect(finished.read()).toEqual(B)
    await second
  })

  it('glideTo animates from the document to the target', async () => {
    const world = harness(A)
    const done = world.runtime.glideTo(B, { durationMs: 400 })
    world.advance(200)
    expect(gammaOf(world.read())).toBeGreaterThan(2)
    world.advance(200)
    expect(world.read()).toEqual(B)
    await done
  })

  it('arrives at once when the pair cannot be glided', async () => {
    const world = harness(A)
    const threeD = makeFlame({
      transforms: { one: {} },
      renderSettings: { dimensions: 3 },
    })
    world.set(threeD)
    const plan = await world.runtime.glideFrom(A, { durationMs: 400 })
    // A refusal is not a failure to change the document.
    expect(plan).toBeUndefined()
    expect(world.read()).toEqual(threeD)
    expect(world.runtime.isGliding()).toBe(false)
  })

  it('arrives at once when nothing differs', async () => {
    const world = harness(A)
    const plan = await world.runtime.glideFrom(deepClone(A), {
      durationMs: 400,
    })
    expect(plan?.changeClass).toBe('none')
    expect(world.runtime.isGliding()).toBe(false)
    expect(world.read()).toEqual(A)
  })

  it('resolves the tier from the preference and the workspace preset', () => {
    const world = harness(A)
    expect(world.runtime.quality().tier).toBe('responsive')
    setGlideQualityPreference('full')
    expect(world.runtime.quality().tier).toBe('full')
    expect(world.runtime.quality().accumulationScale).toBe(1)
    setGlideQualityPreference('auto')
  })
})

describe('the global mode switches', () => {
  it('starts off, which is how the editor has always behaved', () => {
    expect(glideEnabled()).toBe(false)
    expect(glideQualityPreference()).toBe('auto')
  })

  it('round-trips', () => {
    setGlideEnabled(true)
    expect(glideEnabled()).toBe(true)
    setGlideEnabled(false)
    setGlideQualityPreference('balanced')
    expect(glideQualityPreference()).toBe('balanced')
    setGlideQualityPreference('auto')
  })
})
