/**
 * Shared 3D geometry for the atlas camera, world billboards and star field.
 * Camera travel interpolates a focus and radial viewpoint; projection uses
 * an orthonormal look-at basis, so depth controls apparent size and parallax.
 */
import type { OrbPresetId } from './orbPresets'

export type AtlasPoint = readonly [number, number, number]
export interface AtlasViewport {
  width: number
  height: number
}
export interface AtlasCamera {
  focus: AtlasPoint
  azimuth: number
  distance: number
  elevation: number
}
export interface AtlasWorld {
  id: OrbPresetId
  position: AtlasPoint
  radius: number
}
export interface AtlasProjection {
  x: number
  y: number
  depth: number
  scale: number
  visible: boolean
}

export const TRAVEL_DURATION_MS = 1600
const FOV = (85 * Math.PI) / 180
const NEAR = 0.15
const TAU = Math.PI * 2

export function orbitPoint(
  angle: number,
  radius = 9,
  tilt = -0.287,
  warp = 0.76,
): AtlasPoint {
  return [
    Math.sin(angle) * radius * Math.cos(tilt),
    Math.sin(angle) * radius * Math.sin(tilt) +
      Math.sin(angle * 2) * radius * warp,
    Math.cos(angle) * radius,
  ]
}

export const ATLAS_WORLDS: readonly AtlasWorld[] = [
  { id: 'sol', position: orbitPoint(-TAU / 5), radius: 1.22 },
  { id: 'verdant', position: orbitPoint(0), radius: 1.08 },
  { id: 'ember', position: orbitPoint(TAU / 5), radius: 0.9 },
  { id: 'tide', position: orbitPoint((2 * TAU) / 5), radius: 1.5 },
  { id: 'irchiinnuss', position: orbitPoint((-2 * TAU) / 5), radius: 1.55 },
]

export function atlasWorld(id: string): AtlasWorld {
  return ATLAS_WORLDS.find((world) => world.id === id) ?? ATLAS_WORLDS[1]!
}

function focalLength(viewport: AtlasViewport): number {
  return Math.max(1, viewport.height) / (2 * Math.tan(FOV / 2))
}

/** Reserve the header and bottom navigation even in a short landscape view. */
export function targetDiameter(viewport: AtlasViewport): number {
  const portrait = viewport.width < 680
  return Math.max(
    48,
    Math.min(
      viewport.height * 0.48,
      viewport.width * (portrait ? 0.66 : 0.36),
      viewport.height - 246,
    ),
  )
}

export function cameraForWorld(
  world: AtlasWorld,
  viewport: AtlasViewport,
): AtlasCamera {
  return {
    focus: world.position,
    azimuth: Math.atan2(world.position[0], world.position[2]),
    distance:
      (2 * world.radius * focalLength(viewport)) / targetDiameter(viewport),
    elevation: Math.atan2(
      world.position[1],
      Math.hypot(world.position[0], world.position[2]),
    ),
  }
}

function normalize(point: AtlasPoint): AtlasPoint {
  const length = Math.hypot(...point) || 1
  return [point[0] / length, point[1] / length, point[2] / length]
}

function dot(a: AtlasPoint, b: AtlasPoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cameraEye(camera: AtlasCamera): AtlasPoint {
  const flat = camera.distance * Math.cos(camera.elevation)
  return [
    camera.focus[0] + Math.sin(camera.azimuth) * flat,
    camera.focus[1] + Math.sin(camera.elevation) * camera.distance,
    camera.focus[2] + Math.cos(camera.azimuth) * flat,
  ]
}

/** Build the basis once per frame, then project stars, paths and nodes alike. */
export function atlasProjector(camera: AtlasCamera, viewport: AtlasViewport) {
  const eye = cameraEye(camera)
  const forward = normalize([
    camera.focus[0] - eye[0],
    camera.focus[1] - eye[1],
    camera.focus[2] - eye[2],
  ])
  const right = normalize([-forward[2], 0, forward[0]])
  const up: AtlasPoint = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  const focal = focalLength(viewport)
  const radius = targetDiameter(viewport) / 2
  const centerX = viewport.width * (viewport.width < 680 ? 0.5 : 0.58)
  const centerY = Math.max(
    84 + radius,
    Math.min(viewport.height * 0.45, viewport.height - 162 - radius),
  )
  return (point: AtlasPoint): AtlasProjection => {
    const relative: AtlasPoint = [
      point[0] - eye[0],
      point[1] - eye[1],
      point[2] - eye[2],
    ]
    const depth = dot(relative, forward)
    const scale = focal / Math.max(NEAR, depth)
    const x = centerX + dot(relative, right) * scale
    const y = centerY - dot(relative, up) * scale
    return {
      x,
      y,
      depth,
      scale,
      visible:
        depth > NEAR &&
        x > -80 &&
        x < viewport.width + 80 &&
        y > -80 &&
        y < viewport.height + 80,
    }
  }
}

/** Shortest angular path, including a flight across the -π/π seam. */
export function interpolateCamera(
  from: AtlasCamera,
  to: AtlasCamera,
  progress: number,
): AtlasCamera {
  if (progress <= 0) return from
  if (progress >= 1) return to
  const t = Math.max(0, Math.min(1, progress))
  const ease = t * t * t * (t * (t * 6 - 15) + 10)
  const angle = Math.atan2(
    Math.sin(to.azimuth - from.azimuth),
    Math.cos(to.azimuth - from.azimuth),
  )
  const lerp = (a: number, b: number) => a + (b - a) * ease
  return {
    focus: [
      lerp(from.focus[0], to.focus[0]),
      lerp(from.focus[1], to.focus[1]),
      lerp(from.focus[2], to.focus[2]),
    ],
    azimuth: from.azimuth + angle * ease,
    distance: lerp(from.distance, to.distance),
    elevation: lerp(from.elevation, to.elevation),
  }
}
