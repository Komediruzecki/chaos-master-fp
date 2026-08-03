import { describe, it, expect } from 'vitest'
import { applyAudioDriver, smoothDriverOutput } from './audioDriver'
import type { AudioDriver } from './audioDriver'

function driver(overrides: Partial<AudioDriver> = {}): AudioDriver {
  return {
    feature: 'bass',
    mode: 'multiply',
    sensitivity: 1,
    range: [0, 1],
    ...overrides,
  }
}

// --- applyAudioDriver ---

describe('applyAudioDriver', () => {
  it('returns value unchanged when driver is undefined', () => {
    expect(applyAudioDriver(0.5, undefined, 0.8)).toBe(0.5)
  })

  it('returns value unchanged when sensitivity is 0', () => {
    expect(applyAudioDriver(0.5, driver({ sensitivity: 0 }), 0.8)).toBe(0.5)
  })

  it('returns value unchanged when featureNorm is 0 (multiply)', () => {
    expect(applyAudioDriver(0.5, driver({ mode: 'multiply' }), 0)).toBe(0.5)
  })

  // --- multiply mode ---

  it('multiply mode: value × (1 + featureNorm × sensitivity)', () => {
    // 0.5 * (1 + 0.8 * 2) = 0.5 * 2.6 = 1.3
    // Use a wide range so the unclamped result passes through
    expect(
      applyAudioDriver(
        0.5,
        driver({ mode: 'multiply', sensitivity: 2, range: [0, 2] }),
        0.8,
      ),
    ).toBeCloseTo(1.3)
  })

  it('multiply mode: clamps to range', () => {
    expect(
      applyAudioDriver(
        0.9,
        driver({ mode: 'multiply', sensitivity: 10, range: [0, 1] }),
        1,
      ),
    ).toBe(1)
    expect(
      applyAudioDriver(
        0.1,
        driver({ mode: 'multiply', sensitivity: 1, range: [0, 1] }),
        0,
      ),
    ).toBe(0.1)
  })

  // --- add mode ---

  it('add mode: value + featureNorm × sensitivity × span', () => {
    // 0.3 + 0.4 * 5 * (1 - 0) = 0.3 + 2 = 2.3 → clamp to 1.0
    expect(
      applyAudioDriver(
        0.3,
        driver({ mode: 'add', sensitivity: 5, range: [0, 1] }),
        0.4,
      ),
    ).toBe(1)
  })

  it('add mode with wider range', () => {
    // 0.5 + 0.5 * 2 * (100 - (-100)) = 0.5 + 200 = 200.5 → clamp to 100
    expect(
      applyAudioDriver(
        0.5,
        driver({ mode: 'add', sensitivity: 2, range: [-100, 100] }),
        0.5,
      ),
    ).toBe(100)
  })

  // --- replace mode ---

  it('replace mode: lerp value → featureNorm by sensitivity', () => {
    // value + (fn - value) * s = 0.2 + (0.9 - 0.2) * 0.5 = 0.2 + 0.35 = 0.55
    expect(
      applyAudioDriver(0.2, driver({ mode: 'replace', sensitivity: 0.5 }), 0.9),
    ).toBeCloseTo(0.55)
  })

  it('replace mode: full sensitivity gives featureNorm', () => {
    // value + (fn - value) * 1 = fn
    expect(
      applyAudioDriver(0.2, driver({ mode: 'replace', sensitivity: 1 }), 0.9),
    ).toBeCloseTo(0.9)
  })

  it('replace mode: zero sensitivity returns value unchanged', () => {
    expect(
      applyAudioDriver(0.2, driver({ mode: 'replace', sensitivity: 0 }), 0.9),
    ).toBe(0.2)
  })

  // --- edge cases ---

  it('handles negative sensitivity (clamped to 0)', () => {
    expect(applyAudioDriver(0.5, driver({ sensitivity: -5 }), 0.8)).toBe(0.5)
  })

  it('handles sensitivity > 10 (clamped to 10)', () => {
    // multiply: 0.5 * (1 + 1 * 10) = 5.5 → clamp to 1
    expect(
      applyAudioDriver(
        0.5,
        driver({ mode: 'multiply', sensitivity: 999, range: [0, 1] }),
        1,
      ),
    ).toBe(1)
  })

  it('handles featureNorm outside [0, 1] (clamped)', () => {
    // multiply with fn=2 (clamped to 1): 0.5 * (1 + 1 * 1) = 1.0 → clamp to 1
    expect(
      applyAudioDriver(
        0.5,
        driver({ mode: 'multiply', sensitivity: 1, range: [0, 1] }),
        2,
      ),
    ).toBe(1)
  })

  it('handles featureNorm below 0 (clamped)', () => {
    // multiply with fn=-1 (clamped to 0): 0.5 * (1 + 0 * 1) = 0.5
    expect(
      applyAudioDriver(
        0.5,
        driver({ mode: 'multiply', sensitivity: 1, range: [0, 1] }),
        -1,
      ),
    ).toBe(0.5)
  })

  it('add mode with negative range minima', () => {
    // 0 + 1 * 1 * (0 - (-5)) = 5 → clamp to 0
    expect(
      applyAudioDriver(
        0,
        driver({ mode: 'add', sensitivity: 1, range: [-5, 0] }),
        1,
      ),
    ).toBe(0)
  })
})

// --- smoothDriverOutput ---

describe('smoothDriverOutput', () => {
  it('passes through when attack and release are zero', () => {
    const state = { lastOutput: 0 }
    expect(smoothDriverOutput(state, 0.8, 0.016, 0, 0)).toBe(0.8)
    expect(state.lastOutput).toBe(0.8)
  })

  it('rises smoothly with attack time', () => {
    const state = { lastOutput: 0 }
    // dt=16ms, attack=50ms, new=1.0
    // tau = 0.05, alpha = 1 - exp(-0.016/0.05) ≈ 1 - 0.726 = 0.274
    // smoothed = 0 + (1 - 0) * 0.274 = 0.274
    const result = smoothDriverOutput(state, 1.0, 0.016, 50, 50)
    expect(result).toBeGreaterThan(0.1)
    expect(result).toBeLessThan(0.5)
    expect(state.lastOutput).toBe(result)
  })

  it('falls smoothly with release time', () => {
    const state = { lastOutput: 1.0 }
    const result = smoothDriverOutput(state, 0, 0.016, 50, 100)
    expect(result).toBeGreaterThan(0.7)
    expect(result).toBeLessThan(1.0)
    expect(state.lastOutput).toBe(result)
  })

  it('converges to target over multiple calls', () => {
    const state = { lastOutput: 0 }
    for (let i = 0; i < 100; i++) {
      smoothDriverOutput(state, 1.0, 0.016, 20, 20)
    }
    expect(state.lastOutput).toBeCloseTo(1.0, 2)
  })

  it('handles zero dt gracefully', () => {
    const state = { lastOutput: 0.5 }
    // dt=0 → alpha = 1 - exp(0) = 0, so result = lastOutput + 0 = 0.5
    const result = smoothDriverOutput(state, 1.0, 0, 20, 20)
    expect(result).toBe(0.5)
  })
})
