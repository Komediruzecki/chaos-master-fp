/** Instanced candy optics and an opaque chess stage sharing one front/exit lighting pipeline. */
import { d, std, tgpu } from 'typegpu'
import { gummyAbsorptionAtPoint } from '../GummyBear/gummyBands'
import { GUMMY_IOR, GUMMY_MATERIALS, gummyFresnel, gummyTransmission, gummyUnitNormal, } from '../GummyBear/gummyMaterial'
import { gummyBoxHit } from '../GummyBear/gummyPress'
import { gummyCameraLayout, gummyFloorLayout } from '../GummyBear/gummyShaders'
import { marchingGummyFloorProjection, marchingGummyFlux, marchingGummyShadowTriangleProjection, } from '../GummyBear/marchingGummyLight'
import { MarchingGummyMaterial, marchingGummyMeshLayout, marchingGummyOpaqueLayout, } from '../GummyBear/marchingGummyRenderShaders'
import { BOARD_TILE_SIZE } from '../PawnBoard/pawnBoardMath'

export const GUMMY_BOARD_LIGHT_EXTENT = 7
export const GummyBoardInstance = d.struct({
  offsetId: d.vec4f,
  /** Dye phase in xyz; uniform geometry scale in w. */
  dyeOffset: d.vec4f,
  /** Palette code (zero inherits the camera), side, reserved, reserved. */
  material: d.vec4f,
})
export const gummyBoardInstanceLayout = tgpu.bindGroupLayout({
  instances: { storage: d.arrayOf(GummyBoardInstance) },
})
export const gummyBoardExitLayout = tgpu.bindGroupLayout({
  front: { texture: d.texture2d(d.f32) },
  rest: { texture: d.texture2d(d.f32) },
})

export const gummyBoardMaterialLayout = tgpu.bindGroupLayout({
  /** Indexed by stable optical identity minus one; palette code, side, scale, reserved. */
  materials: { storage: d.arrayOf(d.vec4f) },
})
const blueAbsorption = d.vec3f(...GUMMY_MATERIALS.blue.absorption)
const blueColour = d.vec3f(...GUMMY_MATERIALS.blue.colour)
const amberAbsorption = d.vec3f(...GUMMY_MATERIALS.amber.absorption)
const amberColour = d.vec3f(...GUMMY_MATERIALS.amber.colour)
const berryAbsorption = d.vec3f(...GUMMY_MATERIALS.berry.absorption)
const berryColour = d.vec3f(...GUMMY_MATERIALS.berry.colour)
const GummyBoardMaterial = d.struct({ absorption: d.vec4f, colour: d.vec4f })
/** Explicit palettes share the workbench coefficients; zero keeps the current global palette. */
export const gummyBoardMaterialAt = tgpu.fn(
  [d.f32, d.vec4f, d.vec4f],
  GummyBoardMaterial,
)((code, inheritedAbsorption, inheritedColour) => {
  'use gpu'
  let absorption = d.vec4f(inheritedAbsorption)
  let colour = d.vec4f(inheritedColour)
  if (code > 0.5) {
    absorption = d.vec4f(blueAbsorption, inheritedAbsorption.w)
    colour = d.vec4f(blueColour, 0)
    if (code < 2.5 && code > 1.5) {
      absorption = d.vec4f(amberAbsorption, inheritedAbsorption.w)
      colour = d.vec4f(amberColour, 0)
    } else if (code < 3.5 && code > 2.5) {
      absorption = d.vec4f(berryAbsorption, inheritedAbsorption.w)
      colour = d.vec4f(berryColour, 0)
    } else if (code > 3.5) colour.w = code - 3
  }
  return GummyBoardMaterial({ absorption, colour })
})
export const gummyBoardSideAbsorption = tgpu.fn(
  [d.f32],
  d.vec3f,
)((side) => {
  'use gpu'
  return std.mix(d.vec3f(1), d.vec3f(1.12, 1.01, 0.92), side)
})
export const gummyBoardRotate = tgpu.fn(
  [d.vec3f, d.vec2f],
  d.vec3f,
)((point, rotation) => {
  'use gpu'
  return d.vec3f(
    point.x * rotation.y + point.z * rotation.x,
    point.y,
    point.z * rotation.y - point.x * rotation.x,
  )
})
/** Uniform positive scale changes positions and optical lengths; rotation also applies to normals. */
export const gummyBoardWorldPosition = tgpu.fn(
  [d.vec3f, d.vec4f, d.f32, d.vec2f],
  d.vec3f,
)((point, offset, scale, rotation) => {
  'use gpu'
  return std.add(std.mul(gummyBoardRotate(point, rotation), scale), offset.xyz)
})

export const gummyBoardSelectionLayout = tgpu.bindGroupLayout({
  /** World x/z centre, radius and visibility. */
  selection: { uniform: d.vec4f },
})

const varyings = {
  world: d.vec3f,
  normal: d.vec3f,
  rest: d.vec3f,
  identity: d.f32,
}
export const gummyBoardVertex = tgpu.vertexFn({
  in: { id: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: { position: d.builtin.position, ...varyings },
})((input) => {
  'use gpu'
  const vertex = marchingGummyMeshLayout.$.vertices[input.id]!
  const instance = gummyBoardInstanceLayout.$.instances[input.instance]!
  const world = gummyBoardWorldPosition(
    vertex.position.xyz,
    instance.offsetId,
    instance.dyeOffset.w,
    instance.material.zw,
  )
  return {
    position: std.mul(
      gummyCameraLayout.$.camera.viewProjection,
      d.vec4f(world, 1),
    ),
    world,
    normal: gummyBoardRotate(vertex.normal.xyz, instance.material.zw),
    rest: std.add(vertex.rest.xyz, instance.dyeOffset.xyz),
    identity: instance.offsetId.w,
  }
})

export const gummyBoardFrontFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, ...varyings },
  out: { front: d.vec4f, rest: d.vec4f },
})((input) => {
  'use gpu'
  const towardEye = std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world)
  if (std.dot(input.normal, towardEye) <= 0) std.discard()
  const opaque = std.textureLoad(
    marchingGummyOpaqueLayout.$.depth,
    d.vec2i(input.pixel.xy),
    0,
  )
  if (input.pixel.z > opaque) std.discard()
  return {
    front: d.vec4f(
      gummyUnitNormal(input.normal, towardEye),
      std.length(towardEye),
    ),
    rest: d.vec4f(input.rest, input.identity),
  }
})

/** A rear surface may close only its own piece, even when several pieces overlap on screen. */
export const gummyBoardMatchingExit = tgpu.fn(
  [d.f32, d.f32, d.f32, d.f32],
  d.bool,
)((frontId, exitId, frontDistance, exitDistance) => {
  'use gpu'
  return (
    frontDistance > 0 &&
    std.abs(frontId - exitId) < 0.25 &&
    exitDistance >= frontDistance - 0.004
  )
})

export const gummyBoardExitFragment = tgpu.fragmentFn({
  in: { pixel: d.builtin.position, ...varyings },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const towardEye = std.sub(gummyCameraLayout.$.camera.eye.xyz, input.world)
  const pixel = d.vec2i(input.pixel.xy)
  const front = std.textureLoad(gummyBoardExitLayout.$.front, pixel, 0)
  const identity = std.textureLoad(gummyBoardExitLayout.$.rest, pixel, 0).w
  const distance = std.length(towardEye)
  if (
    std.dot(input.normal, towardEye) >= 0 ||
    !gummyBoardMatchingExit(identity, input.identity, front.w, distance)
  )
    std.discard()
  return d.vec4f(input.rest, distance)
})

/** Board edges lie on whole tile boundaries; half-tile offsets are the square centres. */
export const gummyBoardSquareColour = tgpu.fn(
  [d.vec2f],
  d.vec3f,
)((point) => {
  'use gpu'
  const square = std.floor(std.add(std.div(point, BOARD_TILE_SIZE), d.vec2f(4)))
  const alternate = std.fract((square.x + square.y) * 0.5) * 2
  return std.mix(d.vec3f(0.76, 0.71, 0.61), d.vec3f(0.12, 0.19, 0.2), alternate)
})

export const gummyBoardBackgroundFragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: { colour: d.vec4f, depth: d.builtin.fragDepth },
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const far = std.mul(
    camera.inverseViewProjection,
    d.vec4f(input.uv.x * 2 - 1, 1 - input.uv.y * 2, 1, 1),
  )
  const ray = std.normalize(std.sub(std.div(far.xyz, far.w), camera.eye.xyz))
  let colour = std.mix(
    d.vec3f(0.61, 0.57, 0.51),
    d.vec3f(0.82, 0.79, 0.73),
    std.smoothstep(-0.2, 0.6, ray.y),
  )
  let depth = d.f32(1)
  let distance = d.f32(-1)
  let base = d.vec3f(0.64, 0.59, 0.5)
  let boardTop = d.bool(false)
  if (ray.y < -0.001) distance = (-0.32 - camera.eye.y) / ray.y
  const box = gummyBoxHit(
    camera.eye.xyz,
    ray,
    d.vec3f(-6.65, -0.32, -6.65),
    d.vec3f(6.65, 0, 6.65),
  )
  if (box.w >= 0 && (distance < 0 || box.w < distance)) {
    distance = box.w
    const point = std.add(camera.eye.xyz, std.mul(ray, distance))
    base = d.vec3f(0.055, 0.095, 0.1)
    if (box.y > 0.5) {
      boardTop = true
      base = d.vec3f(0.11, 0.16, 0.16)
      if (std.abs(point.x) < 6.4 && std.abs(point.z) < 6.4)
        base = gummyBoardSquareColour(point.xz)
      else if (std.max(std.abs(point.x), std.abs(point.z)) < 6.48)
        base = d.vec3f(0.43, 0.31, 0.13)
    }
  }
  if (distance > 0) {
    const world = std.add(camera.eye.xyz, std.mul(ray, distance))
    const clip = std.mul(camera.viewProjection, d.vec4f(world, 1))
    depth = std.clamp(clip.z / clip.w, 0, 1)
    let light = d.vec4f(0)
    const uv = std.add(
      std.div(world.xz, 2 * GUMMY_BOARD_LIGHT_EXTENT),
      d.vec2f(0.5),
    )
    if (boardTop && uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1) {
      for (const x of std.range(-1, 2)) {
        for (const y of std.range(-1, 2)) {
          light = std.add(
            light,
            std.textureSampleLevel(
              gummyFloorLayout.$.light,
              gummyFloorLayout.$.sampler,
              std.add(
                uv,
                std.div(
                  d.vec2f(d.f32(x), d.f32(y)),
                  d.vec2f(std.textureDimensions(gummyFloorLayout.$.light)),
                ),
              ),
              0,
            ),
          )
        }
      }
      light = std.div(light, 9)
    }
    colour = std.add(
      std.mul(base, 1 - std.clamp(light.w, 0, 0.45)),
      std.min(light.xyz, d.vec3f(0.7)),
    )
    const selection = gummyBoardSelectionLayout.$.selection
    if (boardTop && selection.w > 0.5) {
      const ring =
        1 -
        std.smoothstep(
          0.018,
          0.038,
          std.abs(std.length(std.sub(world.xz, selection.xy)) - selection.z),
        )
      colour = std.mix(colour, d.vec3f(0.3, 0.9, 0.83), ring * 0.7)
    }
  }
  return { colour: d.vec4f(colour, 1), depth }
})

const lightOutput = {
  position: d.builtin.position,
  rest: d.vec3f,
  flux: d.f32,
  path: d.f32,
  material: d.vec2f,
}

/** Each triangle transports its incident flux to the refracted footprint of its smooth mesh normals. */
export const gummyBoardLightVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: lightOutput,
})(({ corner, instance }) => {
  'use gpu'
  const transform = gummyBoardInstanceLayout.$.instances[instance]!
  const base = corner - (corner % 3)
  const a = marchingGummyMeshLayout.$.vertices[base]!
  const b = marchingGummyMeshLayout.$.vertices[base + 1]!
  const c = marchingGummyMeshLayout.$.vertices[base + 2]!
  const vertex = marchingGummyMeshLayout.$.vertices[corner]!
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  const incident = std.neg(light)
  const na = gummyUnitNormal(
    gummyBoardRotate(a.normal.xyz, transform.material.zw),
    d.vec3f(0, 1, 0),
  )
  const nb = gummyUnitNormal(
    gummyBoardRotate(b.normal.xyz, transform.material.zw),
    na,
  )
  const nc = gummyUnitNormal(
    gummyBoardRotate(c.normal.xyz, transform.material.zw),
    na,
  )
  const fa = marchingGummyFloorProjection(
    gummyBoardWorldPosition(
      a.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    std.refract(incident, na, 1 / GUMMY_IOR),
  )
  const fb = marchingGummyFloorProjection(
    gummyBoardWorldPosition(
      b.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    std.refract(incident, nb, 1 / GUMMY_IOR),
  )
  const fc = marchingGummyFloorProjection(
    gummyBoardWorldPosition(
      c.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    std.refract(incident, nc, 1 / GUMMY_IOR),
  )
  const normal = gummyUnitNormal(std.add(std.add(na, nb), nc), na)
  let area = std.cross(
    gummyBoardRotate(
      std.sub(b.position.xyz, a.position.xyz),
      transform.material.zw,
    ),
    gummyBoardRotate(
      std.sub(c.position.xyz, a.position.xyz),
      transform.material.zw,
    ),
  )
  // The density gradient defines outside even when a lookup-table triangle has opposite winding.
  if (std.dot(area, normal) < 0) area = std.neg(area)
  const incomingArea =
    std.max(std.dot(area, light), 0) *
    transform.dyeOffset.w *
    transform.dyeOffset.w
  const floorArea = std.abs(
    std.cross(std.sub(fb.xyz, fa.xyz), std.sub(fc.xyz, fa.xyz)).y,
  )
  const cosine = std.max(std.dot(normal, light), 0)
  let flux = marchingGummyFlux(incomingArea, floorArea)
  flux *= 1 - gummyFresnel(cosine)
  let floor = d.vec4f(fa)
  if (corner % 3 === 1) floor = d.vec4f(fb)
  if (corner % 3 === 2) floor = d.vec4f(fc)
  let clip = d.vec4f(
    floor.x / GUMMY_BOARD_LIGHT_EXTENT,
    -floor.z / GUMMY_BOARD_LIGHT_EXTENT,
    0.5,
    1,
  )
  if (fa.w * fb.w * fc.w < 0.5 || cosine < 0.04 || flux <= 0) {
    clip = d.vec4f(2, 2, 2, 1)
    flux = 0
  }
  const inside = std.refract(incident, normal, 1 / GUMMY_IOR)
  // Local absorbing slab only: neither height above the floor nor empty air adds absorption.
  const path = std.clamp(
    (0.35 * transform.dyeOffset.w) / std.max(-std.dot(inside, normal), 0.2),
    0.1,
    1.4,
  )
  return {
    position: clip,
    rest: std.add(vertex.rest.xyz, transform.dyeOffset.xyz),
    flux,
    path,
    material: transform.material.xy,
  }
})

export const gummyBoardShadowVertex = tgpu.vertexFn({
  in: { corner: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    rest: d.vec3f,
    normal: d.vec3f,
    material: d.vec3f,
  },
})(({ corner, instance }) => {
  'use gpu'
  const transform = gummyBoardInstanceLayout.$.instances[instance]!
  const vertex = marchingGummyMeshLayout.$.vertices[corner]!
  const base = corner - (corner % 3)
  const floor = marchingGummyShadowTriangleProjection(
    gummyBoardWorldPosition(
      marchingGummyMeshLayout.$.vertices[base]!.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    gummyBoardWorldPosition(
      marchingGummyMeshLayout.$.vertices[base + 1]!.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    gummyBoardWorldPosition(
      marchingGummyMeshLayout.$.vertices[base + 2]!.position.xyz,
      transform.offsetId,
      transform.dyeOffset.w,
      transform.material.zw,
    ),
    corner % 3,
  )
  let clip = d.vec4f(
    floor.x / GUMMY_BOARD_LIGHT_EXTENT,
    -floor.z / GUMMY_BOARD_LIGHT_EXTENT,
    0.5,
    1,
  )
  if (floor.w < 0.5) clip = d.vec4f(2, 2, 2, 1)
  return {
    position: clip,
    rest: std.add(vertex.rest.xyz, transform.dyeOffset.xyz),
    normal: gummyBoardRotate(vertex.normal.xyz, transform.material.zw),
    material: d.vec3f(transform.material.xy, transform.dyeOffset.w),
  }
})

export const gummyBoardLightFragment = tgpu.fragmentFn({
  in: { rest: d.vec3f, flux: d.f32, path: d.f32, material: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const camera = gummyCameraLayout.$.camera
  const material = gummyBoardMaterialAt(
    input.material.x,
    camera.absorption,
    camera.colour,
  )
  const absorption = std.mul(
    gummyAbsorptionAtPoint(
      input.rest,
      material.colour.w,
      material.absorption.xyz,
    ),
    gummyBoardSideAbsorption(input.material.y),
  )
  return d.vec4f(
    std.mul(gummyTransmission(absorption, input.path), input.flux * 0.085),
    0,
  )
})
export const gummyBoardShadowFragment = tgpu.fragmentFn({
  in: { rest: d.vec3f, normal: d.vec3f, material: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const normal = gummyUnitNormal(input.normal, d.vec3f(0, 1, 0))
  const light = std.normalize(d.vec3f(-0.42, 0.87, 0.26))
  if (std.dot(normal, light) <= 0.04) std.discard()
  const camera = gummyCameraLayout.$.camera
  const material = gummyBoardMaterialAt(
    input.material.x,
    camera.absorption,
    camera.colour,
  )
  const absorption = std.mul(
    gummyAbsorptionAtPoint(
      input.rest,
      material.colour.w,
      material.absorption.xyz,
    ),
    gummyBoardSideAbsorption(input.material.y),
  )
  const transmission = gummyTransmission(absorption, 0.35 * input.material.z)
  const mean = (transmission.x + transmission.y + transmission.z) / 3
  return d.vec4f(0, 0, 0, 0.08 + 0.2 * (1 - mean))
})

/** Select the same per-piece material used by light transport, keeping composite optics shared. */
export const gummyBoardOptics = (identity: number) => {
  'use gpu'
  const settings =
    gummyBoardMaterialLayout.$.materials[d.u32(std.round(identity)) - 1]!
  const camera = gummyCameraLayout.$.camera
  const material = gummyBoardMaterialAt(
    settings.x,
    camera.absorption,
    camera.colour,
  )
  return MarchingGummyMaterial({
    absorption: material.absorption,
    colour: material.colour,
    absorptionTint: gummyBoardSideAbsorption(settings.y),
    scale: settings.z,
  })
}
