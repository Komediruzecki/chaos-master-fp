/** Board theme surface shading for classic, glass and lava. */
import { d, std, tgpu } from 'typegpu'
import { gummyEnvironment, gummyFresnel } from '../GummyBear/gummyMaterial'
import { gummyBoardGlassNormal, gummyBoardGlassSupportHit, gummyBoardGlassSupportMaterial, } from './gummyBoardGlassGeometry'
import { gummyBoardGlassPath, gummyBoardGlassReceiver, } from './gummyBoardGlassOptics'
import { GUMMY_BOARD_GRID, GUMMY_BOARD_SLAB } from './gummyBoardGrid'
import { gummyBoardGlassInset, gummyBoardGridContains, } from './gummyBoardGridShaders'
import { gummyBoardLavaMaterial } from './gummyBoardLavaMaterial'
import { gummyBoardSquareColour } from './gummyBoardStageLighting'
import { GUMMY_BOARD_GLASS_FLOOR } from './gummyBoardThemes'

/** Glass follows a second interface to the lower receiver; classic keeps its original material. */
export const gummyBoardStageMaterial = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32],
  d.vec3f,
)((point, normal, ray, theme, time) => {
  'use gpu'
  const edge = std.max(std.abs(point.x), std.abs(point.z))
  const top = normal.y > 0.99
  let base = d.vec3f(0.055, 0.095, 0.1)
  if (theme < 0.5) {
    if (top) {
      base = d.vec3f(0.11, 0.16, 0.16)
      if (gummyBoardGridContains(point.xz))
        base = gummyBoardSquareColour(point.xz)
      else if (edge < GUMMY_BOARD_GRID.halfExtent + GUMMY_BOARD_SLAB.bevel)
        base = d.vec3f(0.43, 0.31, 0.13)
    }
    return base
  }
  if (theme > 1.5) return gummyBoardLavaMaterial(point, normal, ray, time)
  const surfaceNormal = gummyBoardGlassNormal(point, normal)
  const reflection = gummyEnvironment(std.reflect(ray, surfaceNormal))
  const path = gummyBoardGlassPath(point, surfaceNormal, ray)
  let behind = d.vec3f(0.018, 0.035, 0.04)
  if (path.valid > 0.5 && path.direction.y < -0.001) {
    const distance =
      (GUMMY_BOARD_GLASS_FLOOR - path.position.y) / path.direction.y
    if (distance > 0)
      behind = gummyBoardGlassReceiver(
        std.add(path.position, std.mul(path.direction, distance)),
      )
    // Start just above the contact plane so rounding cannot put this ray inside a foot.
    const foot = gummyBoardGlassSupportHit(
      std.sub(path.position, std.mul(path.direction, 0.0005)),
      path.direction,
    )
    if (foot.w >= 0 && foot.w < distance)
      behind = gummyBoardGlassSupportMaterial(foot.xyz, path.direction)
  }
  const fresnel = gummyFresnel(std.max(0, std.dot(std.neg(ray), surfaceNormal)))
  if (path.valid < 0.5) return d.vec3f(reflection)
  let glass = std.add(
    std.mul(behind, path.transmission),
    std.mul(reflection, fresnel),
  )
  if (top && gummyBoardGridContains(point.xz)) {
    const inset = gummyBoardGlassInset(point.xz)
    // Frost is a local surface response: its square boundaries stay at y=0
    // while transmitted light can move independently on the lower receiver.
    const diffuse =
      0.55 +
      0.45 *
        std.max(
          std.dot(surfaceNormal, std.normalize(d.vec3f(-0.42, 0.87, 0.26))),
          0,
        )
    glass = std.mix(
      glass,
      std.mul(inset.colour, diffuse),
      inset.frost * (1 - fresnel),
    )
    glass = std.mix(
      glass,
      std.add(std.mul(reflection, 0.075), d.vec3f(0.008, 0.019, 0.021)),
      inset.seam * 0.72,
    )
  }
  return glass
})
