/** Fixed-step studio timing, an authored pull, and current-state world-space picking. */
import { mat4 } from 'wgpu-matrix'

export type GummyVec3 = [number, number, number]
export type GummyOrbit = { theta: number; phi: number; zoom: number }
export type GummyGrip = { center: GummyVec3; target: GummyVec3; radius: number }
export const GUMMY_STEP = 1 / 120
export const GUMMY_MAX_STEPS = 8
export const GUMMY_DEMO_SECONDS = 7.5
export const GUMMY_CRUSH_SECONDS = 9.6
export const GUMMY_JELLY_SECONDS = 12
export const GUMMY_JELLY_TEAR_GRIP_RADIUS = 0.2
export type GummyJellyProtocol = 'squeeze' | 'stretch' | 'tear'
export type GummyBenchmarkPhase =
  | 'settling'
  | 'loading'
  | 'holding'
  | 'releasing'
  | 'recovering'
  | 'complete'
export type GummyPress = { height: number; halfExtent: number }
export const DEFAULT_GUMMY_PRESS: Readonly<GummyPress> = Object.freeze({
  height: 1.2,
  halfExtent: 1.4,
})
export const DEFAULT_GUMMY_ORBIT: Readonly<GummyOrbit> = Object.freeze({
  theta: 0.14,
  phi: 1.27,
  zoom: 1,
})
export const DEFAULT_GUMMY_CRUSH_ORBIT: Readonly<GummyOrbit> = Object.freeze({
  theta: 0.65,
  phi: 0.7,
  zoom: 1.2,
})
export type GummyClock = { wall?: number; remainder: number; time: number }

/** Drop excess wall time instead of applying one unstable step after a stall. */
export function advanceGummyClock(
  clock: GummyClock,
  wall: number,
  paused: boolean,
) {
  if (!Number.isFinite(wall))
    throw new RangeError('The studio clock must be finite')
  if (paused || clock.wall === undefined) {
    return { clock: { ...clock, wall, remainder: 0 }, steps: 0 }
  }
  const delta = Math.max(
    0,
    Math.min(wall - clock.wall, GUMMY_STEP * GUMMY_MAX_STEPS),
  )
  const accumulated = clock.remainder + delta
  const steps = Math.min(
    GUMMY_MAX_STEPS,
    Math.floor((accumulated + 1e-10) / GUMMY_STEP),
  )
  return {
    clock: {
      wall,
      remainder: Math.max(0, accumulated - steps * GUMMY_STEP),
      time: clock.time + steps * GUMMY_STEP,
    },
    steps,
  }
}

export function gummyCameraMatrices(
  orbit: GummyOrbit,
  aspect: number,
  viewProjection: Float32Array,
  inverse: Float32Array,
  eye: Float32Array,
  experiment: 'pull' | 'crush' = 'pull',
) {
  const fittedAspect = Math.max(0.25, aspect)
  const targetY = experiment === 'crush' ? 0.4 : 1.32
  const radius =
    (experiment === 'crush' ? 4.5 : 5.1) *
    Math.max(1, 0.75 / fittedAspect) *
    orbit.zoom
  eye[0] = radius * Math.sin(orbit.phi) * Math.sin(orbit.theta)
  eye[1] = targetY + radius * Math.cos(orbit.phi)
  eye[2] = radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
  const view = mat4.lookAt(eye, [0, targetY, 0], [0, 1, 0])
  const projection = mat4.perspective(Math.PI / 4, fittedAspect, 0.05, 50)
  mat4.mul(projection, view, viewProjection)
  mat4.inverse(viewProjection, inverse)
}

export type GummyRay = { origin: GummyVec3; direction: GummyVec3 }
export function gummyRay(
  x: number,
  y: number,
  inverse: ArrayLike<number>,
): GummyRay {
  const at = (z: number): GummyVec3 => {
    const w =
      inverse[3]! * x + inverse[7]! * y + inverse[11]! * z + inverse[15]!
    return [
      (inverse[0]! * x + inverse[4]! * y + inverse[8]! * z + inverse[12]!) / w,
      (inverse[1]! * x + inverse[5]! * y + inverse[9]! * z + inverse[13]!) / w,
      (inverse[2]! * x + inverse[6]! * y + inverse[10]! * z + inverse[14]!) / w,
    ]
  }
  const near = at(0),
    far = at(1)
  const length = Math.hypot(
    far[0] - near[0],
    far[1] - near[1],
    far[2] - near[2],
  )
  return {
    origin: near,
    direction: [
      (far[0] - near[0]) / length,
      (far[1] - near[1]) / length,
      (far[2] - near[2]) / length,
    ],
  }
}

/** Pick the nearest movable sampled vertex in the CURRENT deforming body. */
export function pickGummyVertex(
  ray: GummyRay,
  positions: Float32Array,
  radius = 0.11,
): GummyVec3 | undefined {
  let nearest = Infinity
  let result: GummyVec3 | undefined
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 3]! <= 0) continue
    const dx = positions[i]! - ray.origin[0],
      dy = positions[i + 1]! - ray.origin[1],
      dz = positions[i + 2]! - ray.origin[2]
    const along =
      dx * ray.direction[0] + dy * ray.direction[1] + dz * ray.direction[2]
    const perpendicular2 = Math.max(
      0,
      dx * dx + dy * dy + dz * dz - along * along,
    )
    if (along < 0 || perpendicular2 > radius * radius) continue
    const entry = along - Math.sqrt(radius * radius - perpendicular2)
    if (entry >= 0 && entry < nearest) {
      nearest = entry
      result = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
    }
  }
  return result
}

/** A view-facing plane keeps dragging at the picked point's depth. */
export function intersectGummyDragPlane(
  ray: GummyRay,
  point: GummyVec3,
  normal: GummyVec3,
): GummyVec3 | undefined {
  const divisor =
    ray.direction[0] * normal[0] +
    ray.direction[1] * normal[1] +
    ray.direction[2] * normal[2]
  if (Math.abs(divisor) < 1e-8) return undefined
  const distance =
    ((point[0] - ray.origin[0]) * normal[0] +
      (point[1] - ray.origin[1]) * normal[1] +
      (point[2] - ray.origin[2]) * normal[2]) /
    divisor
  if (!Number.isFinite(distance) || distance < 0) return undefined
  return [
    ray.origin[0] + ray.direction[0] * distance,
    ray.origin[1] + ray.direction[1] * distance,
    ray.origin[2] + ray.direction[2] * distance,
  ]
}

export type GummyDragFrame = {
  point: GummyVec3
  normal: GummyVec3
  offset: GummyVec3
}

/** Preserve the picked vertex's offset from the pointer ray, so a click cannot pull. */
export function gummyDragFrame(
  ray: GummyRay,
  point: GummyVec3,
): GummyDragFrame | undefined {
  const initial = intersectGummyDragPlane(ray, point, ray.direction)
  if (!initial) return undefined
  return {
    point: [...point],
    normal: [...ray.direction],
    offset: [
      point[0] - initial[0],
      point[1] - initial[1],
      point[2] - initial[2],
    ],
  }
}

/** Move the grip only by the pointer's travel on the original view-facing plane. */
export function gummyDragTarget(
  ray: GummyRay,
  frame: GummyDragFrame,
): GummyVec3 | undefined {
  const hit = intersectGummyDragPlane(ray, frame.point, frame.normal)
  if (!hit) return undefined
  return [
    hit[0] + frame.offset[0],
    hit[1] + frame.offset[1],
    hit[2] + frame.offset[2],
  ]
}

const smooth = (t: number) => {
  const a = Math.max(0, Math.min(1, t))
  return a * a * (3 - 2 * a)
}

/** Motion of the handle only; the solver supplies the bear's response and tearing. */
export function gummyDemoGrip(
  time: number,
  handle: { center: GummyVec3; radius: number; pull: GummyVec3 } = {
    center: [0.64, 1.24, 0.08],
    radius: 0.28,
    pull: [0.95, 0.22, 0.14],
  },
): GummyGrip | undefined {
  if (time < 0.65 || time >= 5.4) return undefined
  const pull = smooth((time - 1.25) / 3.1)
  return {
    center: [...handle.center],
    radius: handle.radius,
    target: [
      handle.center[0] + handle.pull[0] * pull,
      handle.center[1] + handle.pull[1] * pull,
      handle.center[2] + handle.pull[2] * pull,
    ],
  }
}

/** The plate's lower face; the solver and rendered collider use this exact command. */
export function gummyDemoPress(time: number): GummyPress {
  if (!Number.isFinite(time))
    throw new RangeError('The press clock must be finite')
  const raised = DEFAULT_GUMMY_PRESS.height
  const compressed = 0.15
  let height = raised
  if (time >= 0.2 && time < 6.5) {
    height = raised + (compressed - raised) * smooth((time - 0.2) / 6.3)
  } else if (time >= 6.5 && time < 7.05) {
    height = compressed
  } else if (time >= 7.05 && time < 8.45) {
    height = compressed + (raised - compressed) * smooth((time - 7.05) / 1.4)
  }
  return { height, halfExtent: DEFAULT_GUMMY_PRESS.halfExtent }
}

/** Rigidly lay the solver rest pose on its back without changing the mould's dye coordinates. */
export function layGummyBearBack(positions: Float32Array): Float32Array {
  if (!positions.length || positions.length % 4)
    throw new RangeError(
      'The gummy pose must contain packed xyz and inverse mass',
    )
  const laid = positions.slice()
  for (let i = 0; i < positions.length; i += 4) {
    if (
      ![
        positions[i],
        positions[i + 1],
        positions[i + 2],
        positions[i + 3],
      ].every(Number.isFinite)
    )
      throw new RangeError('The gummy pose must be finite')
    laid[i + 1] = positions[i + 2]! + 0.36
    laid[i + 2] = 1.265 - positions[i + 1]!
  }
  return laid
}

export const GUMMY_JELLY_TEAR_BODY_FIXTURE = Object.freeze({
  halfWidth: 0.3,
  minY: 0.85,
  maxY: 1.2,
})

/** A second hand holds the waist in the tear study; material coordinates and shared topology stay intact. */
export function holdGummyTearBody(positions: Float32Array) {
  if (!positions.length || positions.length % 4)
    throw new RangeError('The gummy fixture must contain packed xyzw')
  const held = positions.slice()
  const width = Math.fround(GUMMY_JELLY_TEAR_BODY_FIXTURE.halfWidth)
  const low = Math.fround(GUMMY_JELLY_TEAR_BODY_FIXTURE.minY)
  const high = Math.fround(GUMMY_JELLY_TEAR_BODY_FIXTURE.maxY)
  let heldNodes = 0
  for (let i = 0; i < positions.length; i += 4) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      w = positions[i + 3]!
    if (!Number.isFinite(x + y + positions[i + 2]! + w) || w < 0)
      throw new RangeError(
        'The gummy fixture must contain finite positions and non-negative inverse masses',
      )
    if (Math.abs(x) <= width && y >= low && y <= high && w > 0) {
      held[i + 3] = 0
      heldNodes++
    }
  }
  return { positions: held, heldNodes }
}

/** Rest bounds describe the actual solver pose, including the laid-back squeeze. */
export function gummyRestBounds(positions: Float32Array) {
  if (!positions.length || positions.length % 4)
    throw new RangeError('Gummy rest positions must contain packed xyzw')
  const min: GummyVec3 = [Infinity, Infinity, Infinity]
  const max: GummyVec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]!
      if (!Number.isFinite(value))
        throw new RangeError('Gummy rest positions must be finite')
      min[k] = Math.min(min[k]!, value)
      max[k] = Math.max(max[k]!, value)
    }
  }
  if (max[1] <= min[1])
    throw new RangeError('Gummy rest height must be positive')
  return { min, max }
}

/** Fixed-tick collider/handle commands; positions always come from the solid solver. */
export function gummyJellyCommand(
  tick: number,
  protocol: GummyJellyProtocol,
  bounds: { min: GummyVec3; max: GummyVec3 },
): { phase: GummyBenchmarkPhase; press?: GummyPress; grip?: GummyGrip } {
  if (!Number.isInteger(tick) || tick < 0)
    throw new RangeError(
      'The jelly benchmark tick must be a non-negative integer',
    )
  const height = bounds.max[1] - bounds.min[1]
  if (!Number.isFinite(height) || height <= 0)
    throw new RangeError('The jelly benchmark rest height must be positive')
  if (protocol === 'tear') {
    if (tick >= 1440) return { phase: 'complete' }
    if (tick >= 840) return { phase: 'recovering' }
    const load = smooth((tick - 120) / 480)
    const center: GummyVec3 = [0.64, 1.24, 0.08]
    return {
      phase: tick >= 600 ? 'holding' : tick >= 120 ? 'loading' : 'settling',
      grip: {
        center,
        radius: GUMMY_JELLY_TEAR_GRIP_RADIUS,
        target: [
          center[0] + 1.8 * load,
          center[1] + 0.12 * load,
          center[2] + 0.08 * load,
        ],
      },
    }
  }
  let phase: GummyBenchmarkPhase = 'settling'
  if (tick >= 1440) phase = 'complete'
  else if (tick >= 900) phase = 'recovering'
  else if (tick >= 720)
    phase = protocol === 'stretch' ? 'recovering' : 'releasing'
  else if (tick >= 360) phase = 'holding'
  else if (tick >= 120) phase = 'loading'
  const loading = smooth((tick - 120) / 240)
  if (protocol === 'stretch') {
    if (tick >= 720) return { phase }
    const center: GummyVec3 = [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      bounds.max[1] - 0.55,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ]
    return {
      phase,
      grip: {
        center,
        target: [center[0], center[1] + height * 0.25 * loading, center[2]],
        // Capture the head before gravity settlement, then translate that same patch.
        radius: 0.65,
      },
    }
  }
  const raised = bounds.max[1] + 0.25
  const compressed = bounds.min[1] + height * 0.6
  const release = smooth((tick - 720) / 180)
  return {
    phase,
    press: {
      height: raised + (compressed - raised) * loading * (1 - release),
      halfExtent: DEFAULT_GUMMY_PRESS.halfExtent,
    },
  }
}
