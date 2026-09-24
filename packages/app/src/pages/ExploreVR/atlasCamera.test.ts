/** Camera regressions: perspective depth, safe framing and interrupted travel. */
import { describe, expect, it } from 'vitest'
import { ATLAS_WORLDS, atlasProjector, atlasWorld, cameraEye, cameraForWorld, interpolateCamera, targetDiameter, } from './atlasCamera'

const desktop = { width: 1600, height: 1000 }

describe('atlas perspective camera', () => {
  it.each(ATLAS_WORLDS)(
    'frames $id with a common visible diameter in the safe scene area',
    (world) => {
      const camera = cameraForWorld(world, desktop)
      const point = atlasProjector(camera, desktop)(world.position)
      const diameter = 2 * world.radius * point.scale
      expect(point.visible).toBe(true)
      expect(point.x).toBeCloseTo(928)
      expect(point.y).toBeCloseTo(450)
      expect(diameter).toBeCloseTo(480)
      expect(point.y - diameter / 2).toBeGreaterThan(72)
      expect(point.y + diameter / 2).toBeLessThan(desktop.height - 150)
    },
  )

  it('makes more distant geometry smaller and rejects points behind the eye', () => {
    const world = atlasWorld('verdant')
    const camera = cameraForWorld(world, desktop)
    const project = atlasProjector(camera, desktop)
    const near = project(world.position)
    const far = project([
      world.position[0],
      world.position[1],
      world.position[2] - 8,
    ])
    expect(far.depth).toBeGreaterThan(near.depth)
    expect(far.scale).toBeLessThan(near.scale)
    const eye = cameraEye(camera)
    expect(project([eye[0], eye[1], eye[2] + 1]).visible).toBe(false)
  })

  it('keeps the remaining worlds in front of every settled viewpoint', () => {
    for (const world of ATLAS_WORLDS) {
      const project = atlasProjector(cameraForWorld(world, desktop), desktop)
      for (const other of ATLAS_WORLDS)
        expect(project(other.position).depth).toBeGreaterThan(0.15)
    }
  })

  it.each([
    { width: 390, height: 844 },
    { width: 900, height: 480 },
  ])('reserves HUD space at $width by $height', (viewport) => {
    const world = atlasWorld('verdant')
    const camera = cameraForWorld(world, viewport)
    const point = atlasProjector(camera, viewport)(world.position)
    const radius = targetDiameter(viewport) / 2
    expect(point.y - radius).toBeGreaterThan(72)
    expect(point.y + radius).toBeLessThan(viewport.height - 150)
    if (viewport.width < 680) expect(point.x).toBeCloseTo(viewport.width / 2)
  })

  it('uses the short path across the angular seam', () => {
    const base = cameraForWorld(atlasWorld('verdant'), desktop)
    const start = { ...base, azimuth: Math.PI - 0.1 }
    const finish = { ...base, azimuth: -Math.PI + 0.1 }
    const middle = interpolateCamera(start, finish, 0.5)
    expect(middle.azimuth).toBeCloseTo(Math.PI)
    expect(Math.abs(middle.azimuth - start.azimuth)).toBeLessThan(0.11)
  })

  it('restarts an interrupted flight at the exact current eye without a jump', () => {
    const first = cameraForWorld(atlasWorld('sol'), desktop)
    const second = cameraForWorld(atlasWorld('tide'), desktop)
    const third = cameraForWorld(atlasWorld('ember'), desktop)
    const interrupted = interpolateCamera(first, second, 0.43)
    const restarted = interpolateCamera(interrupted, third, 0)
    expect(cameraEye(restarted)).toEqual(cameraEye(interrupted))
    expect(restarted.focus).toEqual(interrupted.focus)
    const arrived = interpolateCamera(interrupted, third, 1)
    expect(arrived.focus).toEqual(third.focus)
    cameraEye(arrived).forEach((coordinate, index) => {
      expect(coordinate).toBeCloseTo(cameraEye(third)[index]!)
    })
  })
})
