/** Validated linear-RGBA cloud buffers, with deterministic capture velocities and allocation rollback. */
import { d } from 'typegpu'
import { cloudLayout } from './pawnBoardShaders'
import type { TgpuRoot } from 'typegpu'
import type { PawnSide } from '@/flame/chess/pawnFlame'

export function createPawnBoardCloud(
  root: TgpuRoot,
  side: PawnSide,
  points: Float32Array,
  colors?: Float32Array,
) {
  if (
    points.length === 0 ||
    points.length % 4 !== 0 ||
    !points.every(Number.isFinite)
  )
    throw new Error('Pawn cloud requires finite packed xyzw points')
  if (
    colors &&
    (colors.length !== points.length ||
      !colors.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ))
  )
    throw new Error(
      'Pawn cloud colours require matching finite linear RGBA in [0,1]',
    )
  const count = points.length / 4
  const cloudResources: { destroy(): void }[] = []
  const ownCloud = <T extends { destroy(): void }>(resource: T): T => {
    cloudResources.push(resource)
    return resource
  }
  try {
    const pointBuffer = ownCloud(
      root
        .createBuffer(d.arrayOf(d.vec4f, count), (buffer) => {
          buffer.write(new Float32Array(points).buffer)
        })
        .$usage('storage'),
    )
    const colorBuffer = ownCloud(
      root
        .createBuffer(d.arrayOf(d.vec4f, count), (buffer) => {
          buffer.write(
            (colors
              ? new Float32Array(colors)
              : new Float32Array(points.length)
            ).buffer,
          )
        })
        .$usage('storage'),
    )
    const settings = ownCloud(
      root
        .createBuffer(d.vec4f, [
          colors ? 0.11 * Math.min(1, 32_000 / count) : 0.22,
          2.85,
          colors ? 1 : 0,
          0,
        ])
        .$usage('uniform'),
    )
    const velocities = new Float32Array(points.length)
    let seed = side === 'light' ? 41873 : 8821
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    for (let n = 0; n < count; n++) {
      const o = n * 4,
        yaw = random() * Math.PI * 2,
        speed = 0.8 + random() * 2
      velocities[o] = Math.cos(yaw) * speed
      velocities[o + 1] = 1 + random() * 3
      velocities[o + 2] = Math.sin(yaw) * speed
      velocities[o + 3] = 0
    }
    const velocity = ownCloud(
      root
        .createBuffer(d.arrayOf(d.vec4f, count), (buffer) => {
          buffer.write(velocities.buffer)
        })
        .$usage('storage'),
    )
    const group = root.createBindGroup(cloudLayout, {
      points: pointBuffer,
      velocity,
      colors: colorBuffer,
      settings,
    })
    return {
      count,
      group,
      destroy: () => {
        for (const resource of cloudResources) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of cloudResources) resource.destroy()
    throw error
  }
}
