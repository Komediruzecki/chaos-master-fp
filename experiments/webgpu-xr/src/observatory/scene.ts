// Shared desktop observatory coordinates, presentation records and input projection.
import { mat4 } from 'wgpu-matrix'
import { BOOK_RELIEFS } from '../almanac/bookAwards'
import { WORLD_VISUALS } from '../almanac/worldIdentity'
import type { BookAwards } from '../almanac/bookAwards'
import type { BookDetailSnapshot } from '../almanac/bookDetailData'
import type { SurfaceSnapshot } from '../materials/surfaceData'
import type { PassageSnapshot } from './passage'
import type { TemplePresentation, TempleStats } from './temple'

export { EMPTY_TEMPLE } from './temple'
export type { TemplePresentation } from './temple'

export type Vec3 = readonly [number, number, number]
export type WorldId = 'glasswake' | 'tideweave'
export type ObservatoryView =
  | 'overview'
  | 'inspect'
  | 'trace'
  | 'glasswake'
  | 'temple'
/** Normalized trace coordinates: time increases right, pitch increases upward (v decreases). */
export type TracePoint = readonly [number, number]

export interface GlasswakePresentation {
  time: number
  charge: number
  accepted: number
  holding: boolean
  burstTimes: readonly number[]
}
export const GLASSWAKE_CENTER: Vec3 = [0, 1.45, -4.6]
export const GLASSWAKE_CHAMBER_ORIGIN: Vec3 = [0, 0, GLASSWAKE_CENTER[2]]
export const EMPTY_GLASSWAKE: GlasswakePresentation = {
  time: 0,
  charge: 0,
  accepted: 0,
  holding: false,
  burstTimes: [],
}

export interface MusicFrame {
  playing: boolean
  level: number
  activeNote: number | null
  progress: number
}

export interface TracePresentation {
  phase: 'idle' | 'demo' | 'answer' | 'complete'
  target: readonly TracePoint[]
  response: readonly TracePoint[]
  acceptedSegments: number
  segmentCount: number
}

export type ObservatoryInput =
  | { kind: 'world'; worldId: WorldId }
  | {
      kind: 'trace'
      phase: 'start' | 'move' | 'end' | 'cancel'
      point: TracePoint | null
    }

export interface ObservatoryOptions {
  changed(): void
  input(event: ObservatoryInput): void
  music(): MusicFrame
}

export interface ProjectedPoint {
  x: number
  y: number
  visible: boolean
}

export interface AssetStatus {
  id: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  triangles: number
  bytes: number
}

export interface ObservatorySnapshot {
  bookDetail: BookDetailSnapshot
  sceneDetail: SurfaceSnapshot
  ready: boolean
  active: boolean
  error: string
  errors: string[]
  adapter: string
  selectedWorld: WorldId
  view: ObservatoryView
  passage: PassageSnapshot
  motion: boolean
  clay: boolean
  assets: AssetStatus[]
  traceAnchors: ProjectedPoint[]
  visual: {
    bookAwards: BookAwards
    time: number
    music: MusicFrame
    instructionNote: number | null
    bridgeProgress: number
    glasswake: GlasswakePresentation & { renderedShards: number }
    temple: TemplePresentation & TempleStats
  }
  frame: {
    submissions: number
    generations: number
    drawCalls: number
    triangles: number
    livePoints: number
    bufferBytes: number
    width: number
    height: number
    frameIntervalMedianMs: number | null
    frameIntervalP95Ms: number | null
    timingNote: string
  }
}

export interface CameraState {
  yaw: number
  pitch: number
  distance: number
}

export interface ObservatoryFrame {
  bookAwards?: BookAwards
  selectedWorld: WorldId
  view: ObservatoryView
  camera: CameraState
  arrival?: number
  time: number
  music: MusicFrame
  instructionNote: number | null
  clay: boolean
  trace: TracePresentation
  glasswake?: GlasswakePresentation
  temple?: TemplePresentation
  motion?: boolean
}

export const WORLD_PLACEMENTS = {
  glasswake: {
    center: [-2.8, 3, -5.8] as Vec3,
    scale: 1.55,
    ...WORLD_VISUALS.glasswake,
  },
  tideweave: {
    center: [2.8, 3, -5.8] as Vec3,
    scale: 1.3,
    ...WORLD_VISUALS.tideweave,
  },
} as const

export const OBSERVATORY_ASSETS = [
  { id: 'bay', url: '/models/observatory/observation-bay.glb' },
  { id: 'book', url: '/models/almanac/almanac-book.glb' },
  ...BOOK_RELIEFS.map((relief) => ({
    id: `book-${relief.id}`,
    url: relief.url,
  })),
  { id: 'bridge', url: '/models/observatory/bridge-segment.glb' },
  { id: 'landing', url: '/models/observatory/far-landing.glb' },
  { id: 'relic', url: '/models/observatory/celestial-seed.glb' },
  { id: 'glasswake-chamber', url: '/models/observatory/glasswake-chamber.glb' },
  {
    id: 'glasswake-tone-star',
    url: '/models/observatory/glasswake-tone-star.glb',
  },
  {
    id: 'tideweave-crossing',
    url: '/models/observatory/tideweave-crossing.glb',
  },
  {
    id: 'tideweave-resonator',
    url: '/models/observatory/tideweave-resonator.glb',
  },
  {
    id: 'tideweave-bridge-weave',
    url: '/models/observatory/tideweave-bridge-weave.glb',
  },
] as const

export const EMPTY_TRACE: TracePresentation = {
  phase: 'idle',
  target: [],
  response: [],
  acceptedSegments: 0,
  segmentCount: 4,
}

export const QUIET_MUSIC: MusicFrame = {
  playing: false,
  level: 0,
  activeNote: null,
  progress: 0,
}

export const TRACE_PLANE = {
  x: -1.1,
  top: 1.62,
  width: 2.2,
  height: 1,
  z: -4.6,
}
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function traceWorld(point: TracePoint): Vec3 {
  return [
    TRACE_PLANE.x + point[0] * TRACE_PLANE.width,
    TRACE_PLANE.top - point[1] * TRACE_PLANE.height,
    TRACE_PLANE.z,
  ]
}

export function copyTrace(state: TracePresentation): TracePresentation {
  const points = (source: readonly TracePoint[]) =>
    source
      .filter((point) => point.length === 2 && point.every(Number.isFinite))
      .slice(-512)
      .map(
        (point): TracePoint => [clamp(point[0], 0, 1), clamp(point[1], 0, 1)],
      )
  const segmentCount = clamp(Math.trunc(state.segmentCount) || 4, 1, 16)
  return {
    phase: state.phase,
    target: points(state.target).slice(0, 16),
    response: points(state.response),
    acceptedSegments: clamp(
      Math.trunc(state.acceptedSegments) || 0,
      0,
      segmentCount,
    ),
    segmentCount,
  }
}

function transformPoint(matrix: ArrayLike<number>, point: Vec3, w = 1) {
  return [
    matrix[0] * point[0] +
      matrix[4] * point[1] +
      matrix[8] * point[2] +
      matrix[12] * w,
    matrix[1] * point[0] +
      matrix[5] * point[1] +
      matrix[9] * point[2] +
      matrix[13] * w,
    matrix[2] * point[0] +
      matrix[6] * point[1] +
      matrix[10] * point[2] +
      matrix[14] * w,
    matrix[3] * point[0] +
      matrix[7] * point[1] +
      matrix[11] * point[2] +
      matrix[15] * w,
  ]
}

export function projectPoint(
  matrix: ArrayLike<number>,
  point: Vec3,
): ProjectedPoint {
  const p = transformPoint(matrix, point)
  const x = (p[0] / p[3]) * 0.5 + 0.5
  const y = 0.5 - (p[1] / p[3]) * 0.5
  return {
    x,
    y,
    visible:
      p[3] > 0 &&
      p[2] >= 0 &&
      p[2] <= p[3] &&
      x >= 0 &&
      x <= 1 &&
      y >= 0 &&
      y <= 1,
  }
}

export function traceAtCanvas(
  inverse: ArrayLike<number>,
  x: number,
  y: number,
): TracePoint | null {
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1)
    return null
  const near = transformPoint(inverse, [x * 2 - 1, 1 - y * 2, 0])
  const far = transformPoint(inverse, [x * 2 - 1, 1 - y * 2, 1])
  const a = near.slice(0, 3).map((value) => value / near[3])
  const b = far.slice(0, 3).map((value) => value / far[3])
  const dz = b[2] - a[2]
  if (Math.abs(dz) < 1e-6) return null
  const t = (TRACE_PLANE.z - a[2]) / dz
  if (t < 0 || t > 1) return null
  const u = (a[0] + (b[0] - a[0]) * t - TRACE_PLANE.x) / TRACE_PLANE.width
  const v = (TRACE_PLANE.top - a[1] - (b[1] - a[1]) * t) / TRACE_PLANE.height
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null
}

/** Camera input remains separate from identity and sample construction. */
export function sceneCamera(frame: ObservatoryFrame, aspect: number) {
  const world = WORLD_PLACEMENTS[frame.selectedWorld]
  let target: Vec3 = [0, 1.4, -3.5]
  let distance = 9.334
  let basePitch = Math.atan2(0.8, 9.3)
  let fov = Math.PI / 3.5
  if (frame.view === 'inspect') {
    target = [world.center[0], world.center[1] - 0.22, world.center[2]]
    // Fit the authored corona as well as the core, including narrow screens.
    distance = world.scale * 4.4 * Math.max(1, 0.95 / aspect)
    basePitch = 0.08
  } else if (frame.view === 'temple') {
    // The score never moves the viewer; only the covered navigation can settle.
    target = [0, aspect < 0.8 ? 1.3 : 1.9, -12]
    distance = 9.8
    basePitch = 0.045
    fov =
      2 *
      Math.atan(
        Math.tan(0.9 / 2) * Math.max(1, 1.35 / aspect, aspect > 1.9 ? 1.25 : 1),
      )
  } else if (frame.view === 'glasswake') {
    target = [
      0,
      aspect < 0.8 ? 0.25 : aspect < 1.1 ? 0.78 : aspect > 1.9 ? 0.48 : 0.92,
      GLASSWAKE_CENTER[2],
    ]
    distance = 4.25
    basePitch = 0.03
    fov =
      2 *
      Math.atan(
        Math.tan(0.9 / 2) * Math.max(1, 1.12 / aspect, aspect > 1.9 ? 1.6 : 1),
      )
  } else if (frame.view === 'trace') {
    // Work from the bridge mouth, ahead of the lectern. Widen portrait FOV
    // instead of retreating behind the book, which would cover the bridge.
    target = [0, aspect < 0.8 ? 0.3 : 0.6, TRACE_PLANE.z]
    distance = 3.05
    basePitch = 0.11
    fov =
      2 *
      Math.atan(
        Math.tan(Math.PI / 3.8 / 2) *
          Math.max(1, 1.05 / aspect, aspect > 1.9 ? 1.65 : 1),
      )
  } else distance *= Math.max(1, 0.9 / aspect)
  const fixed =
    frame.view === 'trace' ||
    frame.view === 'glasswake' ||
    frame.view === 'temple'
  const yaw = fixed ? 0 : frame.camera.yaw
  const pitch = basePitch + (fixed ? 0 : frame.camera.pitch)
  distance *= fixed ? 1 : frame.camera.distance
  distance *= 1 + 0.035 * clamp(frame.arrival ?? 0, 0, 1)
  const eye: Vec3 = [
    target[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * Math.cos(pitch) * distance,
  ]
  const view = mat4.lookAt(eye, target, [0, 1, 0])
  const projection = mat4.perspective(fov, aspect, 0.05, 120)
  const viewProjection = mat4.multiply(projection, view)
  return {
    eye,
    view,
    projection,
    viewProjection,
    inverse: mat4.inverse(viewProjection),
    fov,
  }
}
