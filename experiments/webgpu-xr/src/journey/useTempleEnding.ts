// A component-owned ending follows the shared audio clock and never starts on restore.
import { createEffect, createSignal, onCleanup } from 'solid-js'
import { TEMPLE_SCORE } from './templeScore'
import type { MotifAudio, MotifAudioSnapshot } from '../almanac/motifAudio'
import type { TemplePresentation } from '../observatory/scene'

export type TemplePhase =
  | 'ready'
  | 'loading'
  | 'playing'
  | 'stopped'
  | 'complete'
  | 'error'

export function useTempleEnding(options: {
  eligible(): boolean
  ready(): boolean
  audio(): MotifAudio | undefined
  present(value: TemplePresentation): void
  enter(): void
  leave(): void
}) {
  const [active, setActive] = createSignal(false)
  const [phase, setPhase] = createSignal<TemplePhase>('ready')
  const [progress, setProgress] = createSignal(0)

  function present() {
    options.present({
      active: active(),
      progress: progress(),
      revealed: phase() === 'complete',
    })
  }

  function update(snapshot: MotifAudioSnapshot) {
    if (!active()) return
    if (snapshot.error) setPhase('error')
    else if (snapshot.motifId === TEMPLE_SCORE.id) {
      if (snapshot.loading) setPhase('loading')
      else if (snapshot.playing) setPhase('playing')
      else if (snapshot.progress === 1) setPhase('complete')
      else setPhase('stopped')
      setProgress(snapshot.progress)
    } else if (phase() === 'loading' || phase() === 'playing') {
      setPhase('stopped')
    }
    present()
  }

  function stop() {
    if (!active() || (phase() !== 'loading' && phase() !== 'playing')) return
    setPhase('stopped')
    options.audio()?.stop()
    present()
  }

  function close() {
    if (!active()) return
    setActive(false)
    options.audio()?.stop()
    setPhase('ready')
    setProgress(0)
    present()
    options.leave()
  }

  function open() {
    if (!options.eligible() || !options.ready()) return
    options.enter()
    setActive(true)
    setPhase('ready')
    setProgress(0)
    present()
  }

  function play() {
    if (!active() || !options.eligible() || !options.ready() || document.hidden)
      return
    setProgress(0)
    setPhase('loading')
    present()
    void options.audio()?.playArrangement(TEMPLE_SCORE)
  }

  createEffect(() => {
    if (active() && !options.eligible()) close()
  })
  onCleanup(() => {
    if (active()) options.audio()?.stop()
  })
  return { active, phase, progress, open, close, play, stop, update }
}
