// A fixed oscillator bank gives each world a quiet voice without another transport.
export type AmbienceWorldId = 'glasswake' | 'tideweave'

interface AmbientTone {
  midi: number
  gain: number
  type: OscillatorType
}

export const WORLD_AMBIENCE: Record<
  AmbienceWorldId,
  {
    tones: readonly AmbientTone[]
    breathingHz: number
    cue: readonly number[]
  }
> = {
  glasswake: {
    tones: [
      { midi: 60, gain: 0.006, type: 'sine' },
      { midi: 72, gain: 0.009, type: 'sine' },
      { midi: 76, gain: 0.007, type: 'sine' },
      { midi: 79, gain: 0.005, type: 'sine' },
      { midi: 83, gain: 0.004, type: 'sine' },
      { midi: 88, gain: 0.003, type: 'sine' },
    ],
    breathingHz: 0.075,
    cue: [72, 76, 79],
  },
  tideweave: {
    tones: [
      { midi: 38, gain: 0.009, type: 'triangle' },
      { midi: 45, gain: 0.006, type: 'triangle' },
      { midi: 50, gain: 0.007, type: 'sine' },
      { midi: 53, gain: 0.005, type: 'sine' },
      { midi: 59, gain: 0.004, type: 'sine' },
      { midi: 69, gain: 0.003, type: 'sine' },
    ],
    breathingHz: 0.13,
    cue: [62, 65, 71],
  },
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const DUCK_GAIN = 0.18
export const AMBIENCE_CUE_SECONDS = 0.58

interface Voice {
  oscillator: OscillatorNode
  gain: GainNode
}

function hold(param: AudioParam, at: number) {
  if (typeof param.cancelAndHoldAtTime === 'function')
    param.cancelAndHoldAtTime(at)
  else {
    const value = param.value
    param.cancelScheduledValues(at)
    param.setValueAtTime(value, at)
  }
}

/** BaseAudioContext also permits offline renders of the exact production graph. */
export function createWorldAmbience(
  context: BaseAudioContext,
  destination: AudioNode,
  initialWorld: AmbienceWorldId,
  changed: () => void = () => {},
) {
  const breathing = context.createGain()
  const duck = context.createGain()
  const lfoGain = context.createGain()
  const lfo = context.createOscillator()
  const voices: Voice[] = []
  const cues = new Set<Voice>()
  const retiringCues = new Set<Voice>()
  let worldId = initialWorld
  let ducked = false
  let disposed = false
  let cueEndsAt = 0
  breathing.gain.value = 0.78
  lfoGain.gain.value = 0.18
  lfo.type = 'sine'
  lfo.frequency.value = WORLD_AMBIENCE[worldId].breathingHz
  lfo.connect(lfoGain)
  lfoGain.connect(breathing.gain)
  breathing.connect(duck)
  duck.connect(destination)
  const startsAt = context.currentTime + 0.015
  for (const tone of WORLD_AMBIENCE[worldId].tones) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tone.type
    oscillator.frequency.value = frequency(tone.midi)
    oscillator.connect(gain)
    gain.connect(breathing)
    gain.gain.setValueAtTime(0, startsAt)
    gain.gain.linearRampToValueAtTime(tone.gain, startsAt + 0.8)
    oscillator.start(startsAt)
    voices.push({ oscillator, gain })
  }
  lfo.start(startsAt)

  function releaseCue(voice: Voice) {
    voice.oscillator.onended = null
    voice.oscillator.disconnect()
    voice.gain.disconnect()
    cues.delete(voice)
    retiringCues.delete(voice)
  }

  function stopCue(immediate = false) {
    for (const voice of retiringCues) {
      voice.oscillator.stop(context.currentTime)
      releaseCue(voice)
    }
    for (const voice of cues) {
      const at = context.currentTime
      if (immediate || context.state !== 'running') {
        voice.oscillator.stop(at)
        releaseCue(voice)
      } else {
        hold(voice.gain.gain, at)
        voice.gain.gain.linearRampToValueAtTime(0, at + 0.025)
        voice.oscillator.onended = () => {
          releaseCue(voice)
        }
        voice.oscillator.stop(at + 0.03)
        retiringCues.add(voice)
      }
    }
    cues.clear()
    cueEndsAt = 0
  }

  function disconnect() {
    stopCue(true)
    for (const voice of voices) {
      voice.oscillator.stop(context.currentTime)
      voice.oscillator.disconnect()
      voice.gain.disconnect()
    }
    voices.length = 0
    lfo.onended = null
    lfo.stop(context.currentTime)
    lfo.disconnect()
    lfoGain.disconnect()
    breathing.disconnect()
    duck.disconnect()
  }

  return {
    setWorld(next: AmbienceWorldId) {
      if (disposed || next === worldId) return
      worldId = next
      const at = context.currentTime
      const recipe = WORLD_AMBIENCE[worldId]
      for (const [index, voice] of voices.entries()) {
        const tone = recipe.tones[index]
        voice.oscillator.type = tone.type
        hold(voice.oscillator.frequency, at)
        voice.oscillator.frequency.setTargetAtTime(
          frequency(tone.midi),
          at,
          0.18,
        )
        hold(voice.gain.gain, at)
        voice.gain.gain.setTargetAtTime(tone.gain, at, 0.35)
      }
      lfo.frequency.setTargetAtTime(recipe.breathingHz, at, 0.3)
    },
    setDucked(next: boolean) {
      if (disposed || next === ducked) return
      ducked = next
      const at = context.currentTime
      hold(duck.gain, at)
      duck.gain.setTargetAtTime(next ? DUCK_GAIN : 1, at, next ? 0.04 : 0.25)
    },
    cue() {
      if (disposed) return
      stopCue()
      const at = context.currentTime + 0.015
      for (const [index, midi] of WORLD_AMBIENCE[worldId].cue.entries()) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const voice = { oscillator, gain }
        const start = at + index * 0.065
        const end = at + AMBIENCE_CUE_SECONDS
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency(midi)
        oscillator.connect(gain)
        gain.connect(duck)
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.009 - index * 0.002, start + 0.025)
        gain.gain.exponentialRampToValueAtTime(0.0001, end - 0.035)
        gain.gain.linearRampToValueAtTime(0, end)
        oscillator.onended = () => {
          releaseCue(voice)
          if (!disposed) changed()
        }
        cues.add(voice)
        oscillator.start(start)
        oscillator.stop(end)
      }
      cueEndsAt = at + AMBIENCE_CUE_SECONDS
    },
    stopCue,
    snapshot() {
      return {
        active: !disposed,
        worldId,
        cueActive: cues.size > 0 && context.currentTime < cueEndsAt,
        ducked,
      }
    },
    dispose(immediate = false) {
      if (disposed && !immediate) return
      disposed = true
      if (immediate || context.state !== 'running') {
        disconnect()
        return
      }
      const at = context.currentTime
      hold(duck.gain, at)
      duck.gain.linearRampToValueAtTime(0, at + 0.04)
      // The last looping source owns cleanup; no timer survives the audio graph.
      lfo.onended = disconnect
      for (const voice of voices) {
        voice.oscillator.stop(at + 0.045)
      }
      lfo.stop(at + 0.045)
    },
  }
}
