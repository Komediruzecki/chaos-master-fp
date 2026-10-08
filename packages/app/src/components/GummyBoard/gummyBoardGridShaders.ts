/** Analytic glass insets share the exact contact-plane grid used by CPU chess picking. */
import { d, std, tgpu } from 'typegpu'
import { gummyTransmission } from '../GummyBear/gummyMaterial'
import { GUMMY_BOARD_GRID } from './gummyBoardGrid'

export const gummyBoardGridCell = tgpu.fn(
  [d.vec2f],
  d.vec2f,
)((point) => {
  'use gpu'
  return std.floor(
    std.add(
      std.div(std.mul(point, d.vec2f(1, -1)), GUMMY_BOARD_GRID.squareSize),
      d.vec2f(GUMMY_BOARD_GRID.squares / 2),
    ),
  )
})

export const gummyBoardGridContains = tgpu.fn(
  [d.vec2f],
  d.bool,
)((point) => {
  'use gpu'
  const cell = gummyBoardGridCell(point)
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < GUMMY_BOARD_GRID.squares &&
    cell.y < GUMMY_BOARD_GRID.squares
  )
})

/** a1 is dark; changing the camera never moves the material into the receiver plane. */
export const gummyBoardSquareParity = tgpu.fn(
  [d.vec2f],
  d.f32,
)((point) => {
  'use gpu'
  const cell = gummyBoardGridCell(point)
  return 1 - std.fract((cell.x + cell.y) * 0.5) * 2
})

export const GummyGlassInset = d.struct({
  colour: d.vec3f,
  frost: d.f32,
  absorption: d.vec3f,
  seam: d.f32,
  bevel: d.vec2f,
})

/** 64 flush material insets, with a narrow etched seam and bevel shading, add no geometry passes. */
export const gummyBoardGlassInset = tgpu.fn(
  [d.vec2f],
  GummyGlassInset,
)((point) => {
  'use gpu'
  const result = GummyGlassInset({
    colour: d.vec3f(0.035, 0.075, 0.078),
    frost: 0,
    absorption: d.vec3f(0),
    seam: 0,
    bevel: d.vec2f(0),
  })
  if (!gummyBoardGridContains(point)) return result
  const alternate = gummyBoardSquareParity(point)
  const uv = std.add(
    std.div(point, GUMMY_BOARD_GRID.squareSize),
    d.vec2f(GUMMY_BOARD_GRID.squares / 2),
  )
  const local = std.sub(std.fract(uv), d.vec2f(0.5))
  const margin = std.mul(
    std.sub(d.vec2f(0.5), std.abs(local)),
    GUMMY_BOARD_GRID.squareSize,
  )
  const edge = std.min(margin.x, margin.y)
  result.seam = 1 - std.smoothstep(0.008, 0.017, edge)
  result.colour = std.mix(
    d.vec3f(0.25, 0.32, 0.3),
    d.vec3f(0.014, 0.06, 0.067),
    alternate,
  )
  result.frost = std.mix(0.16, 0.06, alternate) * (1 - result.seam)
  result.absorption = std.mix(
    d.vec3f(0.12, 0.04, 0.02),
    d.vec3f(1.8, 0.38, 0.21),
    alternate,
  )
  const slope = std.mul(
    std.sub(d.vec2f(1), std.smoothstep(d.vec2f(0.015), d.vec2f(0.045), margin)),
    std.sign(local),
  )
  result.bevel = std.mul(slope, 0.24 * (1 - result.seam))
  return result
})

/** Clear substrate plus thin coloured insets avoids a second strong checker on the light receiver. */
export const gummyBoardGlassTransmission = tgpu.fn(
  [d.vec3f, d.vec3f, d.f32],
  d.vec3f,
)((point, normal, length) => {
  'use gpu'
  let transmission = gummyTransmission(d.vec3f(0.08, 0.025, 0.018), length)
  if (normal.y > 0.85 && std.abs(point.y - GUMMY_BOARD_GRID.top) < 0.001) {
    const inset = gummyBoardGlassInset(point.xz)
    transmission = std.mul(
      transmission,
      gummyTransmission(inset.absorption, std.min(length, 0.1)),
    )
  }
  return transmission
})
