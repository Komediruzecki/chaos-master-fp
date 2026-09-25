/**
 * The ground a flame's art sits on (backgroundColor.ts): what Flam3 clears
 * the canvas to, and what the canvas box shows where the rail's sheet has
 * moved the canvas up.
 */
import { describe, expect, it } from 'vitest'
import { cssRgb, flameBackgroundColor } from './backgroundColor'
import type { FlameDescriptor } from './schema/flameSchema'

type RenderSettings = FlameDescriptor['renderSettings']

function settings(overrides: Partial<RenderSettings>): RenderSettings {
  return { drawMode: 'light', ...overrides } as RenderSettings
}

describe('flameBackgroundColor', () => {
  it('is black for light drawing with no colour chosen', () => {
    expect(
      flameBackgroundColor(settings({ backgroundColor: undefined })),
    ).toEqual([0, 0, 0])
  })

  it('is white for paint with no colour chosen', () => {
    expect(
      flameBackgroundColor(
        settings({ drawMode: 'paint', backgroundColor: undefined }),
      ),
    ).toEqual([1, 1, 1])
  })

  it('is the chosen colour as it is, paint or not', () => {
    const chosen: [number, number, number] = [0.2, 0.4, 0.6]
    expect(flameBackgroundColor(settings({ backgroundColor: chosen }))).toEqual(
      chosen,
    )
    expect(
      flameBackgroundColor(
        settings({ drawMode: 'paint', backgroundColor: chosen }),
      ),
    ).toEqual(chosen)
  })
})

describe('cssRgb', () => {
  it('writes each channel as a byte, rounded and kept in range', () => {
    expect(cssRgb([0, 0.5, 1])).toBe('rgb(0 128 255)')
    expect(cssRgb([-0.5, 1.5, 0.2])).toBe('rgb(0 255 51)')
  })
})
