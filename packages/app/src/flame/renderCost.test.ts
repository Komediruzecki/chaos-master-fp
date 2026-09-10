import { describe, expect, it } from 'vitest'
import { bucketProbabilityInv, cameraFromFlame, creditsForAnimation, creditsForRender, estimateRenderSeconds, qualityPointLimit, safeQualityCap, } from './renderCost'

const HD = { width: 1920, height: 1080, quality: 0.95 }

describe('bucketProbabilityInv', () => {
  it('matches the client 2D formula: height^2 * zoom^2 / 4', () => {
    expect(bucketProbabilityInv(1080, { zoom: 1 })).toBe((1080 ** 2 * 1) / 4)
    expect(bucketProbabilityInv(1080, { zoom: 3 })).toBe((1080 ** 2 * 9) / 4)
  })

  it('scales with the SQUARE of zoom — 4x zoom needs 16x the area coverage', () => {
    const base = bucketProbabilityInv(1080, { zoom: 1 })
    expect(bucketProbabilityInv(1080, { zoom: 4 })).toBeCloseTo(base * 16, 5)
  })

  it('treats a closer 3D camera as more zoomed in', () => {
    const far = bucketProbabilityInv(1080, { radius: 10, fov: 60 })
    const near = bucketProbabilityInv(1080, { radius: 5, fov: 60 })
    expect(near).toBeGreaterThan(far)
    // Halving the distance doubles the scale -> 4x the area.
    expect(near / far).toBeCloseTo(4, 5)
  })

  it('clamps an extremely close 3D camera (blow-out guard)', () => {
    const at2 = bucketProbabilityInv(1080, { radius: 2, fov: 60 })
    const at0 = bucketProbabilityInv(1080, { radius: 0.001, fov: 60 })
    expect(at0).toBe(at2)
  })

  it('defaults a missing/zero zoom to 1 rather than collapsing to zero points', () => {
    expect(bucketProbabilityInv(1080, { zoom: 0 })).toBe(1080 ** 2 / 4)
  })
})

describe('qualityPointLimit', () => {
  it('reproduces the measured budget at zoom 1 (1080p high = 116.6M)', () => {
    expect(qualityPointLimit(HD, { zoom: 1 })).toBeCloseTo(116_640_000, -3)
  })

  it('costs 16x more points at 4x zoom for the SAME quality preset', () => {
    const flat = qualityPointLimit(HD, { zoom: 1 })
    const zoomed = qualityPointLimit(HD, { zoom: 4 })
    expect(zoomed / flat).toBeCloseTo(16, 5)
  })

  it('rises steeply with quality (ultra vs high at the same camera)', () => {
    const high = qualityPointLimit(HD, { zoom: 1 })
    const ultra = qualityPointLimit({ ...HD, quality: 0.995 }, { zoom: 1 })
    expect(ultra / high).toBeCloseTo(100, 0)
  })

  it('never exceeds the u32-safe cap, even at quality 1', () => {
    const cap = safeQualityCap(HD.width, HD.height)
    expect(qualityPointLimit({ ...HD, quality: 1 }, { zoom: 50 })).toBe(cap)
  })
})

describe('estimateRenderSeconds', () => {
  // Calibration cells measured on the RunPod RTX 4090 endpoint.
  const cases: [
    string,
    { width: number; height: number; quality: number },
    number,
  ][] = [
    ['1280x720 high', { width: 1280, height: 720, quality: 0.95 }, 1.4],
    ['1920x1080 high', { width: 1920, height: 1080, quality: 0.95 }, 1.6],
    ['2560x1440 high', { width: 2560, height: 1440, quality: 0.95 }, 1.9],
    ['1920x1080 ultra', { width: 1920, height: 1080, quality: 0.995 }, 8.0],
    ['2560x1440 ultra', { width: 2560, height: 1440, quality: 0.995 }, 12.1],
    ['3840x2160 ultra', { width: 3840, height: 2160, quality: 0.995 }, 26.4],
  ]

  for (const [label, target, measured] of cases) {
    it(`predicts ${label} within 25% of the measured ${measured}s`, () => {
      const predicted = estimateRenderSeconds(target, { zoom: 1 })
      expect(Math.abs(predicted - measured) / measured).toBeLessThan(0.25)
    })
  }

  it('grows with zoom because the point budget does', () => {
    const flat = estimateRenderSeconds(HD, { zoom: 1 })
    // Modest zoom is still dominated by the ~1.5s fixed overhead...
    expect(estimateRenderSeconds(HD, { zoom: 4 })).toBeGreaterThan(flat * 1.3)
    // ...but deep zoom is squarely point-bound (16x zoom = 256x the points).
    expect(estimateRenderSeconds(HD, { zoom: 16 })).toBeGreaterThan(flat * 5)
  })
})

describe('creditsForRender', () => {
  it('charges a single credit for ordinary renders', () => {
    expect(creditsForRender(HD, { zoom: 1 })).toBe(1)
    expect(
      creditsForRender(
        { width: 3840, height: 2160, quality: 0.95 },
        { zoom: 1 },
      ),
    ).toBe(1)
  })

  it('charges more for long, worker-hogging renders', () => {
    const ultraHd = creditsForRender({ ...HD, quality: 0.995 }, { zoom: 1 })
    const ultra4k = creditsForRender(
      { width: 3840, height: 2160, quality: 0.995 },
      { zoom: 1 },
    )
    expect(ultraHd).toBe(2)
    expect(ultra4k).toBeGreaterThan(ultraHd)
  })

  it('charges a zoomed render more than the same preset unzoomed', () => {
    expect(creditsForRender(HD, { zoom: 8 })).toBeGreaterThan(
      creditsForRender(HD, { zoom: 1 }),
    )
  })

  it('never charges less than one credit', () => {
    expect(
      creditsForRender({ width: 64, height: 64, quality: 0.1 }, { zoom: 1 }),
    ).toBe(1)
  })
})

describe('creditsForAnimation', () => {
  it('is per-frame — 90 frames of a 1-credit render costs 90', () => {
    expect(creditsForAnimation(HD, { zoom: 1 }, 90)).toBe(90)
  })

  it('multiplies the per-frame cost of heavy frames', () => {
    expect(
      creditsForAnimation({ ...HD, quality: 0.995 }, { zoom: 1 }, 10),
    ).toBe(20)
  })

  it('treats a zero/negative frame count as a single frame', () => {
    expect(creditsForAnimation(HD, { zoom: 1 }, 0)).toBe(
      creditsForRender(HD, { zoom: 1 }),
    )
  })
})

describe('cameraFromFlame', () => {
  it('reads 2D zoom', () => {
    expect(
      cameraFromFlame({
        renderSettings: { dimensions: 2, camera: { zoom: 2.5 } },
      }),
    ).toEqual({ zoom: 2.5 })
  })

  it('prefers a real 3D position/target distance over a stale radius', () => {
    const cam = cameraFromFlame({
      renderSettings: {
        dimensions: 3,
        camera3D: {
          radius: 999,
          fov: 45,
          position: [0, 0, 3],
          target: [0, 0, 0],
        },
      },
    })
    expect(cam).toEqual({ radius: 3, fov: 45 })
  })

  it('falls back to zoom 1 for a descriptor with no camera', () => {
    expect(cameraFromFlame({})).toEqual({ zoom: 1 })
  })
})
