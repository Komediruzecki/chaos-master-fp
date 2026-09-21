// Who owns the flame while a glide is running.
//
// A glide writes a whole sampled descriptor every frame through the silent
// path, so for as long as it runs it is the document's only author. That is
// right for the transition and wrong the moment a person touches a control:
// their edit was made to the frame they could see, and a glide that keeps
// writing over it — and then lands on its own target — throws the edit away.
//
// The real history store is used here rather than a fake, because the answer
// depends on which of its write paths a caller took: `replaceSilently` is the
// glide's own and records nothing, while a gesture and a discrete edit each
// reach a different hook. The wiring below is the workspace's wiring.
import { createRoot } from 'solid-js'
import { createStore } from 'solid-js/store'
import { describe, expect, it } from 'vitest'
import { deepClone } from '@/utils/clone'
import { createStoreHistory } from '@/utils/createStoreHistory'
import { createGlideRuntime, setGlideRuntime, yieldGlideToDocumentWrite, } from './runtime'
import { makeFlame } from './testUtils'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

const A = makeFlame({
  transforms: { one: { probability: 1, preAffine: { c: 0 } } },
  renderSettings: { gamma: 2 },
})
const B = makeFlame({
  transforms: { one: { probability: 1, preAffine: { c: 4 } } },
  renderSettings: { gamma: 4 },
})

const gammaOf = (flame: FlameDescriptor) => flame.renderSettings.gamma

/** The workspace, in miniature: its history, its hooks, its glide runtime. */
function workspace(start: FlameDescriptor) {
  const [flame, setFlame, history] = createStoreHistory(
    createStore<FlameDescriptor>(deepClone(start)),
    {
      journal: true,
      // Exactly what MainWorkspace passes, minus the recorder's own reporter.
      onEntryPushed: yieldGlideToDocumentWrite,
      onPreviewStarted: yieldGlideToDocumentWrite,
    },
  )
  let time = 0
  let pending: ((time: number) => void)[] = []
  const runtime = createGlideRuntime({
    readFlame: () => deepClone(flame),
    writeFlame: (next) => {
      history.replaceSilently(next)
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
  setGlideRuntime(runtime)
  return {
    flame,
    setFlame,
    history,
    runtime,
    advance: (ms: number) => {
      time += ms
      const due = pending
      pending = []
      for (const callback of due) callback(time)
    },
    dispose: () => {
      runtime.dispose()
      setGlideRuntime(undefined)
    },
  }
}

describe('a document write that arrives mid-glide', () => {
  it('cancels the transition in place when a person makes it', () => {
    createRoot((dispose) => {
      const world = workspace(A)
      world.history.replaceSilently(deepClone(B))
      void world.runtime.glideFrom(A, { durationMs: 400 })
      world.advance(200)
      const onScreen = gammaOf(world.flame)
      expect(onScreen).toBeGreaterThan(2)
      expect(onScreen).toBeLessThan(4)

      // A control the person moved, on the frame they could see. 1.25 is
      // outside the range the glide travels, so it can never be mistaken for
      // a frame of the transition.
      world.setFlame((draft) => {
        draft.renderSettings.gamma = 1.25
      }, 'Set gamma')

      expect(world.runtime.isGliding()).toBe(false)
      world.advance(400)
      expect(gammaOf(world.flame)).toBe(1.25)

      world.dispose()
      dispose()
    })
  })

  it('cancels on the gesture, before the drag has written anything', () => {
    createRoot((dispose) => {
      const world = workspace(A)
      world.history.replaceSilently(deepClone(B))
      void world.runtime.glideFrom(A, { durationMs: 400 })
      world.advance(200)

      // Pointer-down on a slider: the gesture opens before its first write.
      world.history.startPreview('Set gamma')
      expect(world.runtime.isGliding()).toBe(false)

      world.setFlame((draft) => {
        draft.renderSettings.gamma = 1.25
      })
      world.history.commit()
      world.advance(400)
      expect(gammaOf(world.flame)).toBe(1.25)

      world.dispose()
      dispose()
    })
  })

  it('undo puts back the frame the edit was made on, never the target', () => {
    createRoot((dispose) => {
      const world = workspace(A)
      world.history.replaceSilently(deepClone(B))
      void world.runtime.glideFrom(A, { durationMs: 400 })
      world.advance(200)
      const onScreen = deepClone(world.flame)

      world.setFlame((draft) => {
        draft.renderSettings.gamma = 1.25
      }, 'Set gamma')
      world.advance(400)
      world.history.undo()

      // The glide never became an undo step, so undoing the edit restores
      // what the person was looking at when they made it — not `B`, which is
      // where the transition was heading and which nobody ever saw.
      expect(world.flame).toEqual(onScreen)
      expect(gammaOf(world.flame)).not.toBe(4)

      world.dispose()
      dispose()
    })
  })

  it('ignores the glide runtime writing its own frames', () => {
    createRoot((dispose) => {
      const world = workspace(A)
      world.history.replaceSilently(deepClone(B))
      void world.runtime.glideFrom(A, { durationMs: 400 })
      world.advance(100)
      expect(world.runtime.isGliding()).toBe(true)
      world.advance(100)
      expect(world.runtime.isGliding()).toBe(true)
      world.advance(200)
      // Ran to its own end and landed on exactly the target.
      expect(world.flame).toEqual(B)

      world.dispose()
      dispose()
    })
  })
})
