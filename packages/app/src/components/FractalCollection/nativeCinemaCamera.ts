/** Deterministic capture timing and sampled actor bounds keep native shots framed at every aspect. */
import { mat4 } from 'wgpu-matrix'
import { squareWorld } from '../PawnBoard/pawnBoardMath'
import { nativeMatchSquare } from './nativeFractalMatchFrame'
import type { ChessMoveReceipt } from '@chaos-master/core/chess/chessGame'
import type { CollectionCloud } from './collectionCloudWorker'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

export const NATIVE_CINEMA_DURATION = 6
type Vec3 = [number, number, number]
type Bounds = { min: Vec3; max: Vec3 }

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** A short establishing hold and slowed impact leave the legal final board readable. */
export function nativeCinemaTime(displaySeconds: number) {
  const time = Math.max(0, Math.min(NATIVE_CINEMA_DURATION, displaySeconds))
  if (time <= 0.5) return 0
  if (time <= 1.7) return ((time - 0.5) / 1.2) * 0.9
  if (time <= 3.3) return 0.9 + ((time - 1.7) / 1.6) * 0.45
  if (time <= 5.2) return 1.35 + ((time - 3.3) / 1.9) * 1.35
  return 2.7
}

function include(bounds: Bounds, point: readonly number[]) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis]!, point[axis]!)
    bounds.max[axis] = Math.max(bounds.max[axis]!, point[axis]!)
  }
}

/** Reserve the complete travel envelope, including knight lift and promoted role height. */
export function nativeCinemaActorBounds(
  receipt: ChessMoveReceipt,
  clouds: readonly CollectionCloud[],
  scale: number,
  displaySeconds: number,
): Bounds {
  const bounds: Bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  const actors = receipt.before.pieces.filter(
    (piece) =>
      piece.id === receipt.pieceId || piece.id === receipt.captured?.id,
  )
  const age = Math.max(0, nativeCinemaTime(displaySeconds) - 0.9)
  // Native points disperse at at most 2.8 units/s and fade at age 1.6.
  // Anticipate that spread so the camera pulls back before the cloud reaches it.
  const spread = 4.5 * smooth((nativeCinemaTime(displaySeconds) - 0.2) / 1.8)
  for (const actor of actors) {
    const side = actor.color === 'w' ? 'light' : 'dark'
    const roles = [actor.role]
    if (actor.id === receipt.pieceId && receipt.promotion)
      roles.push(receipt.promotion)
    for (const role of roles) {
      const cloud = clouds.find(
        (candidate) => candidate.key === `${role}:${side}`,
      )
      const local = cloud?.bounds ?? {
        min: [-0.8, 0, -0.8],
        max: [0.8, 2.6, 0.8],
      }
      const squares =
        actor.id === receipt.pieceId
          ? [receipt.from, receipt.to]
          : [actor.square]
      for (const square of squares) {
        const origin = squareWorld(nativeMatchSquare(square)!)
        const victim = actor.id === receipt.captured?.id
        const margin = victim ? spread * scale : 0
        include(
          bounds,
          local.min.map(
            (v, axis) => origin[axis]! + v * scale - (axis === 1 ? 0 : margin),
          ),
        )
        include(
          bounds,
          local.max.map(
            (v, axis) =>
              origin[axis]! +
              v * scale +
              (axis === 1
                ? victim
                  ? Math.min(1.06, age * 4) * scale
                  : 1.1
                : margin),
          ),
        )
      }
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis]! -= 0.25
    bounds.max[axis]! += 0.25
  }
  return bounds
}

export function nativeCinemaCamera(
  receipt: ChessMoveReceipt,
  clouds: readonly CollectionCloud[],
  recipe: Pick<NativeCinemaRecipe, 'scale' | 'camera'>,
  displaySeconds: number,
  aspect: number,
) {
  const bounds = nativeCinemaActorBounds(
    receipt,
    clouds,
    recipe.scale,
    displaySeconds,
  )
  const target = bounds.min.map(
    (value, axis) => (value + bounds.max[axis]!) / 2,
  ) as Vec3
  const from = squareWorld(nativeMatchSquare(receipt.from)!)
  const to = squareWorld(nativeMatchSquare(receipt.to)!)
  const direction = Math.atan2(to[0] - from[0], to[2] - from[2])
  const progress = smooth(displaySeconds / NATIVE_CINEMA_DURATION)
  const travel =
    recipe.camera === 'arc' ? 0.38 : recipe.camera === 'diagonal' ? 0.16 : 0.08
  const theta = direction + Math.PI / 2 + (progress - 0.5) * travel
  const phi =
    recipe.camera === 'hero' ? 0.95 : recipe.camera === 'diagonal' ? 0.67 : 0.8
  const st = Math.sin(theta),
    ct = Math.cos(theta),
    sp = Math.sin(phi),
    cp = Math.cos(phi)
  const fittedAspect = Number.isFinite(aspect) ? Math.max(0.25, aspect) : 1
  const tangent = Math.tan(Math.PI / 8) * 0.88
  let radius = 1
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const dx = x - target[0],
          dy = y - target[1],
          dz = z - target[2]
        const depth = dx * sp * st + dy * cp + dz * sp * ct
        radius = Math.max(
          radius,
          depth + Math.abs(dx * ct - dz * st) / (tangent * fittedAspect),
          depth + Math.abs(-dx * cp * st + dy * sp - dz * cp * ct) / tangent,
        )
      }
  const eye = new Float32Array([
    target[0] + radius * sp * st,
    target[1] + radius * cp,
    target[2] + radius * sp * ct,
  ])
  const view = mat4.lookAt(eye, target, [0, 1, 0])
  const projection = mat4.perspective(Math.PI / 4, fittedAspect, 0.05, 250)
  return {
    eye,
    viewProjection: mat4.mul(projection, view),
    target,
    bounds,
    radius,
  }
}
