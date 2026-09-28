// Pins the flame writers after their move out of audioAnalysis.ts: what they
// write, the schema hold on render settings, and the re-export.
import { describe, expect, it } from 'vitest'
import * as analysis from './audioAnalysis'
import { applyAudioMappingsToFlame, applyAudioTargetValues, } from './audioTargets'

describe('audioTargets', () => {
  it('writes a render setting into the flame it is given', () => {
    const flame: Record<string, unknown> = {
      renderSettings: { exposure: 0.25 },
    }
    applyAudioTargetValues(flame, [
      { target: { kind: 'renderSetting', param: 'exposure' }, value: 0.75 },
    ])
    expect(flame.renderSettings).toEqual({ exposure: 0.75 })
  })

  it('wraps palettePhase the way the shader reads it', () => {
    const flame: Record<string, unknown> = { renderSettings: {} }
    applyAudioTargetValues(flame, [
      { target: { kind: 'renderSetting', param: 'palettePhase' }, value: 1.25 },
    ])
    expect(flame.renderSettings).toEqual({ palettePhase: 0.25 })
  })

  it('is the module audioAnalysis re-exports', () => {
    expect(analysis.applyAudioTargetValues).toBe(applyAudioTargetValues)
    expect(analysis.applyAudioMappingsToFlame).toBe(applyAudioMappingsToFlame)
  })
})
