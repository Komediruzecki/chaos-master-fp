import { createSignal } from 'solid-js'
import { applyEasing, clamp } from './easing'

interface TimelineState {
  tracks: () => TimelineTrack[]
  getFrame: () => number
}

export type EasingCurve =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bounce'
  | 'elastic'

export type PointInitMode =
  | 'pointInitUnitDisk'
  | 'pointInitGaussianDisk'
  | 'pointInitUnitSquare'
  | 'pointInitModeGaussianSquare'
  | 'pointInitModeGaussianCircle'

/**
 * Expandable mapping of variation types to their available parameters.
 * This system can be extended to support more variations and parameters.
 */
export const VariationParameterMaps: Record<string, string[]> = {
  tunnelVar: ['distortion'],
  lissajousVar: ['freqX', 'freqY', 'freqRatio', 'amplitude', 'phase'],
  pigtail: ['xmultiplier', 'ymultiplier'],
  blob: ['scale', 'phi', 'theta', 'psi'],
  fan2: ['curl_1', 'curl_2'],
  grid: ['du', 'dv'],
  hexes: ['Sx', 'Sy'],
  invCircle: ['distortion'],
  invCircle2: ['distortion'],
  invEllipse: ['a', 'b', 'sinAngle', 'cosAngle'],
  juliaN: ['jx', 'jy'],
  juliaScope: ['jx', 'jy'],
  linearT: [],
  line: [],
  popcorn: ['distortion'],
  popcorn2: ['distortion'],
  radialBlur: ['blurRadius'],
  rectangles: ['dx', 'dy'],
  rings: ['b', 'c', 'd', 'e', 'f'],
  rings2: ['scale', 'phi', 'theta', 'psi'],
  scry: ['Sx', 'Sy', 'a', 'b', 'c'],
  sinusGrid: ['dx', 'dy'],
  spirograph: ['Sx', 'Sy', 'a', 'b', 'c'],
  squish: ['Sx', 'Sy'],
  starBlur: ['blurRadius'],
  swirl: ['Sx', 'Sy', 'a', 'b', 'c'],
  swirl3: ['Sx', 'Sy', 'a', 'b', 'c'],
}

/**
 * Resolve variation parameters for a given transform and variation type.
 * @param transforms - The transform record containing all variations
 * @param transformId - The ID of the transform
 * @param variationId - The ID of the variation
 * @param paramPath - The parameter path (e.g., "tunnelVar.distortion")
 * @param frame - The current frame number
 * @returns The interpolated parameter value or null if not found
 */
export function resolveVariationParameter(
  transforms: Record<string, unknown>,
  transformId: string,
  variationId: string,
  paramPath: string,
  frame: number,
): number | null {
  const transform = transforms[transformId] as {
    variations: Record<string, unknown>
  }

  if (!transform) return null

  const variation = transform.variations[variationId] as {
    type: string
    params: Record<string, number>
    weight: number
  }

  if (!variation || variation.params === undefined) return null

  // Get the available parameters for this variation type
  const params = VariationParameterMaps[variation.type] || []

  // Find the parameter in the paramPath
  const paramName = paramPath.split('.').pop()
  if (!paramName || !params.includes(paramName)) return null

  // Check if there's a keyframe track for this parameter
  const timelineState = window.currentTimeline as TimelineState | undefined

  if (!timelineState) return null

  const trackPath = `${transformId}.${variationId}.${paramName}`
  // Search through the tracks array to find the matching track
  const track = timelineState.tracks().find(
    (t: TimelineTrack) => t.parameterPath === trackPath,
  )

  if (!track) return null

  // Find the keyframe at the current frame
  const keyframe = track.keyframes.find((kf: KeyframeData) => kf.frame === frame)
  if (!keyframe) return null

  return keyframe.value as number
}

export interface FlameDescriptor {
  renderSettings: {
    exposure: number
    skipIters: number
    drawMode: 'light' | 'paint'
    colorInitMode: 'colorInitZero' | 'colorInitPosition'
    pointInitMode:
      | 'pointInitUnitDisk'
      | 'pointInitGaussianDisk'
      | 'pointInitUnitSquare'
      | 'pointInitModeGaussianSquare'
      | 'pointInitModeGaussianCircle'
    vibrancy: number
    backgroundColor?: [number, number, number]
    camera?: {
      zoom: number
      position: [number, number]
      rotation?: number
    }
    palettePhase?: number
    paletteSpeed?: number
  }
  transforms: Record<string, unknown>
  metadata: {
    author: string
  }
  edgeFadeColor?: [number, number, number, number]
}

export type KeyframeData = {
  frame: number
  value:
    | number
    | string
    | [number, number, number]
    | [number, number, number, number]
    | boolean
    | null
  easing?: EasingCurve
}

export type TimelineTrack = {
  parameterPath: string
  keyframes: KeyframeData[]
}

export type TimelineConfig = {
  fps: number
  timeScale: number
  startFrame: number
  endFrame: number
  loop: boolean
}

function defaultConfig(): TimelineConfig {
  return { fps: 30, timeScale: 1, startFrame: 0, endFrame: 90, loop: true }
}

/**
 * Resolves the value at a given frame for a set of keyframes.
 * Returns the interpolated value or the nearest keyframe value.
 */
export function resolveKeyframeValue(
  keyframes: KeyframeData[],
  frame: number,
):
  | number
  | string
  | boolean
  | [number, number, number]
  | null
  | [number, number, number, number] {
  if (keyframes.length === 0) return null

  const sorted = [...keyframes].sort(
    (a: KeyframeData, b: KeyframeData) => a.frame - b.frame,
  )

  // Before first keyframe
  const firstKf = sorted[0]!
  if (frame <= firstKf.frame) return firstKf.value

  // After last keyframe
  const lastKf = sorted[sorted.length - 1]!
  if (frame >= lastKf.frame) return lastKf.value

  // Find surrounding keyframes
  let prev = sorted[0]!
  let next = sorted[sorted.length - 1]!
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!
    const after = sorted[i + 1]!
    if (current.frame <= frame && after.frame >= frame) {
      prev = current
      next = after
      break
    }
  }

  const frameRange = next.frame - prev.frame
  if (frameRange === 0) return prev.value

  const rawT = (frame - prev.frame) / frameRange
  const t = clamp(rawT, 0, 1)

  // Type guard: if values are numbers, use lerp with easing, otherwise interpolate strings
  if (typeof prev.value === 'number' && typeof next.value === 'number') {
    // Use the easing curve from the next keyframe (or default to linear)
    const easingCurve = next.easing ?? 'linear'
    const easedT = applyEasing(t, easingCurve)
    return prev.value + (next.value - prev.value) * easedT
  }

  // For string interpolation (drawMode, colorInitMode, pointInitMode) or boolean
  if (typeof prev.value === 'string' || typeof prev.value === 'boolean') {
    return prev.value
  }
  return next.value
}

/**
 * Gets all unique frames from all tracks for the timeline ruler.
 */
export function getAllTrackFrames(tracks: TimelineTrack[]): number[] {
  const frames = new Set<number>()
  for (const track of tracks) {
    for (const kf of track.keyframes) {
      frames.add(kf.frame)
    }
  }
  return [...frames].sort((a: number, b: number) => a - b)
}

/**
 * Creates a timeline state manager.
 * Returns current frame, config, tracks, and utility functions.
 */
export function createTimelineState() {
  const [currentFrame, setCurrentFrame] = createSignal(0)
  const [config, setConfig] = createSignal<TimelineConfig>(defaultConfig())
  const [tracks, setTracks] = createSignal<TimelineTrack[]>([], {
    equals: false,
  })
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [_timeScale, _setTimeScale] = createSignal(1)
  let animationFrameId: number | null = null

  function addKeyframe(
    parameterPath: string,
    frame: number,
    value:
      | number
      | string
      | [number, number, number]
      | [number, number, number, number],
    easing?: EasingCurve,
  ) {
    setTracks((prev: TimelineTrack[]) => {
      const existingTrack = prev.find(
        (t: TimelineTrack) => t.parameterPath === parameterPath,
      )
      if (existingTrack) {
        const existingKf = existingTrack.keyframes.find(
          (kf: KeyframeData) => kf.frame === frame,
        )
        if (existingKf) {
          // Update existing keyframe
          existingKf.value = value
          existingKf.easing = easing ?? existingKf.easing
        } else {
          existingTrack.keyframes.push({ frame, value, easing })
        }
        return [...prev]
      }
      return [...prev, { parameterPath, keyframes: [{ frame, value, easing }] }]
    })
  }

  function removeKeyframe(parameterPath: string, frame: number) {
    setTracks((prev: TimelineTrack[]) =>
      prev
        .map((t: TimelineTrack) =>
          t.parameterPath === parameterPath
            ? {
                ...t,
                keyframes: t.keyframes.filter(
                  (kf: KeyframeData) => kf.frame !== frame,
                ),
              }
            : t,
        )
        .filter((t: TimelineTrack) => t.keyframes.length > 0),
    )
  }

  function getKeysForFrame(frame: number): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    const trackList = tracks()
    for (let i = 0; i < trackList.length; i++) {
      const track = trackList[i]
      const hasKf = track.keyframes.some(
        (kf: KeyframeData) => kf.frame === frame,
      )
      if (hasKf) {
        result[track.parameterPath] = true
      }
    }
    return result
  }

  function hasKeyframeAtFrame(parameterPath: string, frame: number): boolean {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    return (
      track?.keyframes.some((kf: KeyframeData) => kf.frame === frame) ?? false
    )
  }

  /**
   * Get all keyframes at a specific frame for a track
   * Returns the keyframe at that frame or undefined
   */
  function getKeyframeAtFrame(
    parameterPath: string,
    frame: number,
  ): KeyframeData | undefined {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    if (!track) return undefined
    return track.keyframes.find((kf: KeyframeData) => kf.frame === frame)
  }

  /**
   * Get keyframes that would overlap if added at a specific frame
   * This helps detect when creating multiple keyframes at the same frame
   */
  function getOverlappingKeyframes(
    parameterPath: string,
    frame: number,
  ): KeyframeData[] {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    if (!track) return []
    return track.keyframes.filter((kf: KeyframeData) => kf.frame === frame)
  }

  /**
   * Handle keyframe overlap - warn if adding a keyframe at a frame with existing keyframes
   * Returns true if operation was successful, false if duplicate was detected
   */
  function addKeyframeWithOverlapCheck(
    parameterPath: string,
    frame: number,
    value:
      | number
      | string
      | [number, number, number]
      | [number, number, number, number],
    easing?: EasingCurve,
  ): boolean {
    const existingKeyframes = getOverlappingKeyframes(parameterPath, frame)
    if (existingKeyframes.length > 0) {
      return false // Update in place instead
    }

    addKeyframe(parameterPath, frame, value, easing)
    return true
  }

  /**
   * Remove all keyframes at a specific frame for a track
   */
  function removeKeyframesAtFrame(parameterPath: string, frame: number): void {
    setTracks((prev: TimelineTrack[]) =>
      prev
        .map((t: TimelineTrack) =>
          t.parameterPath === parameterPath
            ? {
                ...t,
                keyframes: t.keyframes.filter(
                  (kf: KeyframeData) => kf.frame !== frame,
                ),
              }
            : t,
        )
        .filter((t: TimelineTrack) => t.keyframes.length > 0),
    )
  }

  /**
   * Find the closest keyframe before or at a given frame
   */
  function findClosestKeyframeBeforeFrame(
    parameterPath: string,
    frame: number,
  ): KeyframeData | undefined {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    if (!track) return undefined

    const validKeyframes = track.keyframes
      .filter((kf: KeyframeData) => kf.frame <= frame)
      .sort((a: KeyframeData, b: KeyframeData) => b.frame - a.frame)

    return validKeyframes[0]
  }

  /**
   * Split a keyframe into two at a specified frame
   * Keeps the first keyframe value, copies to second with updated frame number
   */
  function splitKeyframeAtFrame(
    parameterPath: string,
    originalFrame: number,
    splitFrame: number,
  ): boolean {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    if (!track) return false

    const keyframe = track.keyframes.find(
      (kf: KeyframeData) => kf.frame === originalFrame,
    )
    if (
      !keyframe ||
      keyframe.value === null ||
      typeof keyframe.value === 'boolean'
    )
      return false

    // Remove the original keyframe
    removeKeyframesAtFrame(parameterPath, originalFrame)

    // Add new keyframes at split positions (only if value is not null or boolean)
    addKeyframe(parameterPath, originalFrame, keyframe.value, keyframe.easing)
    addKeyframe(parameterPath, splitFrame, keyframe.value, keyframe.easing)

    return true
  }

  /**
   * Mirror keyframe value to the opposite side of the timeline
   * Calculates the mirrored frame position based on timeline bounds
   */
  function mirrorKeyframeToOpposite(
    parameterPath: string,
    frame: number,
  ): number | null {
    const currentConfig = config()
    const _frameRange = currentConfig.endFrame - currentConfig.startFrame

    // Calculate mirrored frame (if center is startFrame)
    const mirroredFrame =
      currentConfig.startFrame + (currentConfig.endFrame - frame)

    // Check if mirrored frame is within valid range
    if (
      mirroredFrame < currentConfig.startFrame ||
      mirroredFrame > currentConfig.endFrame
    ) {
      return null
    }

    return mirroredFrame
  }

  /**
   * Apply mirrored value from one keyframe to another track
   * Useful for creating symmetrical animations across different parameters
   */
  function applyMirroredValueFromTrack(
    sourceParameterPath: string,
    targetParameterPath: string,
    frame: number,
  ): boolean {
    const sourceTrack = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === sourceParameterPath,
    )
    if (!sourceTrack) return false

    // Get keyframe value at source frame
    const keyframe = sourceTrack.keyframes.find(
      (kf: KeyframeData) => kf.frame === frame,
    )
    if (
      !keyframe ||
      keyframe.value === null ||
      typeof keyframe.value === 'boolean'
    )
      return false

    // Add keyframe to target track at mirrored frame with same easing
    const mirroredFrame = mirrorKeyframeToOpposite(sourceParameterPath, frame)
    if (mirroredFrame === null) return false

    addKeyframe(
      targetParameterPath,
      mirroredFrame,
      keyframe.value,
      keyframe.easing,
    )
    return true
  }

  /**
   * Check if multiple tracks have keyframes at the same frame
   */
  function getTracksWithFrameOverlap(frame: number): string[] {
    const result: string[] = []
    for (const track of tracks()) {
      if (track.keyframes.some((kf: KeyframeData) => kf.frame === frame)) {
        result.push(track.parameterPath)
      }
    }
    return result
  }

  function resolveValueAtPath(
    parameterPath: string,
    frame: number,
  ):
    | number
    | string
    | boolean
    | [number, number, number]
    | [number, number, number, number]
    | null {
    const track = tracks().find(
      (t: TimelineTrack): t is TimelineTrack =>
        t.parameterPath === parameterPath,
    )
    if (!track) return null
    return resolveKeyframeValue(track.keyframes, frame)
  }

  function advanceFrame() {
    const cfg = config()
    const next = currentFrame() + 1
    if (next > cfg.endFrame) {
      setCurrentFrame(cfg.loop ? cfg.startFrame : cfg.endFrame)
    } else {
      setCurrentFrame(next)
    }
  }

  function goBackFrame() {
    const cfg = config()
    const prev = currentFrame() - 1
    if (prev < cfg.startFrame) {
      setCurrentFrame(cfg.loop ? cfg.endFrame : cfg.startFrame)
    } else {
      setCurrentFrame(prev)
    }
  }

  function goToFrame(frame: number) {
    setCurrentFrame(clamp(frame, config().startFrame, config().endFrame))
  }

  function play() {
    if (isPlaying()) return

    setIsPlaying(true)
    const frameLoop = () => {
      if (!isPlaying()) {
        animationFrameId = null
        return
      }

      const cfg = config()
      for (let i = 0; i < cfg.timeScale; i++) {
        advanceFrame()
      }
      animationFrameId = requestAnimationFrame(frameLoop)
    }

    animationFrameId = requestAnimationFrame(frameLoop)
  }

  function pause() {
    setIsPlaying(false)
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  function togglePlay() {
    if (isPlaying()) {
      pause()
    } else {
      play()
    }
  }

  /**
   * Applies timeline values to a flame descriptor for the current frame.
   * Updates the descriptor with camera position, zoom, exposure, and other animated parameters.
   */
  function applyToFlame(flame: FlameDescriptor): void {
    const frame = currentFrame()

    // Animate camera position
    const xTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'camera.x',
    )
    if (xTrack) {
      const value = resolveKeyframeValue(xTrack.keyframes, frame)
      if (
        value !== null &&
        typeof value === 'number' &&
        flame.renderSettings.camera?.position
      ) {
        flame.renderSettings.camera.position[0] = value
      }
    }

    const yTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'camera.y',
    )
    if (yTrack) {
      const value = resolveKeyframeValue(yTrack.keyframes, frame)
      if (
        value !== null &&
        typeof value === 'number' &&
        flame.renderSettings.camera?.position
      ) {
        flame.renderSettings.camera.position[1] = value
      }
    }

    // Animate camera rotation
    const rotationTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'camera.rotation',
    )
    if (rotationTrack) {
      const value = resolveKeyframeValue(rotationTrack.keyframes, frame)
      if (
        value !== null &&
        typeof value === 'number' &&
        flame.renderSettings.camera
      ) {
        flame.renderSettings.camera.rotation = value
      }
    }

    // Animate camera zoom
    const zoomTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'camera.zoom',
    )
    if (zoomTrack) {
      const value = resolveKeyframeValue(zoomTrack.keyframes, frame)
      if (
        value !== null &&
        typeof value === 'number' &&
        flame.renderSettings.camera
      ) {
        flame.renderSettings.camera.zoom = value
      }
    }

    // Animate flame parameters
    const exposureTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'exposure',
    )
    if (exposureTrack) {
      const value = resolveKeyframeValue(exposureTrack.keyframes, frame)
      if (value !== null && typeof value === 'number') {
        flame.renderSettings.exposure = value
      }
    }

    const skipItersTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'skipIters',
    )
    if (skipItersTrack) {
      const value = resolveKeyframeValue(skipItersTrack.keyframes, frame)
      if (value !== null && typeof value === 'number') {
        flame.renderSettings.skipIters = value
      }
    }

    const vibrancyTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'vibrancy',
    )
    if (vibrancyTrack) {
      const value = resolveKeyframeValue(vibrancyTrack.keyframes, frame)
      if (value !== null && typeof value === 'number') {
        flame.renderSettings.vibrancy = value
      }
    }

    const drawModeTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'drawMode',
    )
    if (drawModeTrack) {
      const value = resolveKeyframeValue(drawModeTrack.keyframes, frame)
      if (value !== null && typeof value === 'string') {
        flame.renderSettings.drawMode = value as 'light' | 'paint'
      }
    }

    // Animate palette parameters
    const palettePhaseTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'palettePhase',
    )
    if (palettePhaseTrack) {
      const value = resolveKeyframeValue(palettePhaseTrack.keyframes, frame)
      if (value !== null && typeof value === 'number') {
        flame.renderSettings.palettePhase = value
      }
    }

    const paletteSpeedTrack = tracks().find(
      (t: TimelineTrack) => t.parameterPath === 'paletteSpeed',
    )
    if (paletteSpeedTrack) {
      const value = resolveKeyframeValue(paletteSpeedTrack.keyframes, frame)
      if (value !== null && typeof value === 'number') {
        flame.renderSettings.paletteSpeed = value
      }
    }

    // Apply variation parameters

    // Iterate through all tracks and apply variation parameter animations
    for (const track of tracks()) {
      const trackPath = track.parameterPath
      // Check if this is a variation parameter track (format: transformId.variationId.paramName)
      const parts = trackPath.split('.')
      if (parts.length !== 3) continue

      const [transformId, variationId, paramName] = parts

      // Check if this parameter is defined for this variation type
      const params = VariationParameterMaps[variationId!] || []
      if (!params.includes(paramName!)) continue

      // Get the variation from the transform
      const transform = flame.transforms[transformId!]
      if (!transform) continue

      const variation = (transform as { variations: Record<string, { params: Record<string, number> | undefined; type: string }> }).variations[variationId!]

      if (!variation || !variation.params) continue

      const keyframe = track.keyframes.find((kf: KeyframeData) => kf.frame === frame)

      if (keyframe && typeof keyframe.value === 'number') {
        variation.params[paramName!] = keyframe.value
      }
    }
  }

  const getFrame = (): number => currentFrame()

  return {
    currentFrame,
    setCurrentFrame,
    config,
    setConfig,
    tracks,
    setTracks,
    isPlaying,
    setIsPlaying,
    getFrame,
    addKeyframe,
    removeKeyframe,
    getKeysForFrame,
    hasKeyframeAtFrame,
    getKeyframeAtFrame,
    getOverlappingKeyframes,
    addKeyframeWithOverlapCheck,
    removeKeyframesAtFrame,
    findClosestKeyframeBeforeFrame,
    splitKeyframeAtFrame,
    getTracksWithFrameOverlap,
    mirrorKeyframeToOpposite,
    applyMirroredValueFromTrack,
    resolveValueAtPath,
    advanceFrame,
    goBackFrame,
    goToFrame,
    play,
    pause,
    togglePlay,
    applyToFlame,
  }
}

/**
 * Exported version of addKeyframe for use in components
 */
export function addKeyframeToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  frame: number,
  value:
    | number
    | string
    | [number, number, number]
    | [number, number, number, number],
  easing: EasingCurve = 'linear',
) {
  timeline.addKeyframe(parameterPath, frame, value, easing)
}

/**
 * Add a keyframe with overlap detection and automatic split
 * @param timeline - The timeline state
 * @param parameterPath - The parameter path to animate
 * @param frame - The frame to add the keyframe at
 * @param value - The value at that frame
 * @param easing - Optional easing curve
 * @returns true if keyframe was successfully added, false if update was performed instead
 */
export function addKeyframeWithOverlapCheckToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  frame: number,
  value:
    | number
    | string
    | [number, number, number]
    | [number, number, number, number],
  easing: EasingCurve = 'linear',
): boolean {
  return timeline.addKeyframeWithOverlapCheck(
    parameterPath,
    frame,
    value,
    easing,
  )
}

/**
 * Get all tracks with keyframes at a specific frame
 */
export function getTracksWithFrameOverlapToTimeline(
  timeline: TimelineState,
  frame: number,
): string[] {
  return timeline.getTracksWithFrameOverlap(frame)
}

/**
 * Find the closest keyframe before or at a given frame
 */
export function findClosestKeyframeBeforeFrameToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  frame: number,
): KeyframeData | undefined {
  return timeline.findClosestKeyframeBeforeFrame(parameterPath, frame)
}

/**
 * Split a keyframe at a specified frame position
 */
export function splitKeyframeAtFrameToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  originalFrame: number,
  splitFrame: number,
): boolean {
  return timeline.splitKeyframeAtFrame(parameterPath, originalFrame, splitFrame)
}

/**
 * Remove all keyframes at a specific frame for a track
 */
export function removeKeyframesAtFrameToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  frame: number,
): void {
  timeline.removeKeyframesAtFrame(parameterPath, frame)
}

/**
 * Mirror keyframe value to the opposite side of the timeline
 * @param timeline - The timeline state
 * @param parameterPath - The parameter path to mirror
 * @param frame - The frame to mirror from
 * @returns The mirrored frame number, or null if not possible
 */
export function mirrorKeyframeToOppositeToTimeline(
  timeline: TimelineState,
  parameterPath: string,
  frame: number,
): number | null {
  const config = timeline.config()
  const mirroredFrame = config.startFrame + (config.endFrame - frame)

  // Check if mirrored frame is within valid range
  if (mirroredFrame < config.startFrame || mirroredFrame > config.endFrame) {
    return null
  }

  return mirroredFrame
}

/**
 * Apply mirrored value from one track to another
 * @param timeline - The timeline state
 * @param sourceParameterPath - The source track parameter path
 * @param targetParameterPath - The target track parameter path
 * @param frame - The frame to mirror from
 * @returns true if successful, false if source keyframe doesn't exist
 */
export function applyMirroredValueFromTrackToTimeline(
  timeline: TimelineState,
  sourceParameterPath: string,
  targetParameterPath: string,
  frame: number,
): boolean {
  return timeline.applyMirroredValueFromTrack(
    sourceParameterPath,
    targetParameterPath,
    frame,
  )
}

export type TimelineState = ReturnType<typeof createTimelineState>

/**
 * Applies timeline values to a flame descriptor for the current frame.
 * This function is the module-level version used by components.
 */
export function applyTimelineToFlame(
  timeline: TimelineState,
  flame: FlameDescriptor,
): void {
  const frame = timeline.currentFrame()

  // Animate camera position
  const xTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'camera.x')
  if (xTrack) {
    const value = resolveKeyframeValue(xTrack.keyframes, frame)
    if (
      value !== null &&
      typeof value === 'number' &&
      flame.renderSettings.camera?.position
    ) {
      flame.renderSettings.camera.position[0] = value
    }
  }

  const yTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'camera.y')
  if (yTrack) {
    const value = resolveKeyframeValue(yTrack.keyframes, frame)
    if (
      value !== null &&
      typeof value === 'number' &&
      flame.renderSettings.camera?.position
    ) {
      flame.renderSettings.camera.position[1] = value
    }
  }

  const zoomTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'camera.zoom')
  if (zoomTrack) {
    const value = resolveKeyframeValue(zoomTrack.keyframes, frame)
    if (
      value !== null &&
      typeof value === 'number' &&
      flame.renderSettings.camera
    ) {
      flame.renderSettings.camera.zoom = value
    }
  }

  // Animate flame parameters
  const exposureTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'exposure')
  if (exposureTrack) {
    const value = resolveKeyframeValue(exposureTrack.keyframes, frame)
    if (value !== null && typeof value === 'number') {
      flame.renderSettings.exposure = value
    }
  }

  const skipItersTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'skipIters')
  if (skipItersTrack) {
    const value = resolveKeyframeValue(skipItersTrack.keyframes, frame)
    if (value !== null && typeof value === 'number') {
      flame.renderSettings.skipIters = value
    }
  }

  const vibrancyTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'vibrancy')
  if (vibrancyTrack) {
    const value = resolveKeyframeValue(vibrancyTrack.keyframes, frame)
    if (value !== null && typeof value === 'number') {
      flame.renderSettings.vibrancy = value
    }
  }

  const drawModeTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'drawMode')
  if (drawModeTrack) {
    const value = resolveKeyframeValue(drawModeTrack.keyframes, frame)
    if (value !== null && typeof value === 'string') {
      flame.renderSettings.drawMode = value as 'light' | 'paint'
    }
  }

  // Animate string parameters (colorInitMode, pointInitMode)
  const colorInitModeTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'colorInitMode')
  if (colorInitModeTrack) {
    const value = resolveKeyframeValue(colorInitModeTrack.keyframes, frame)
    if (value !== null && typeof value === 'string') {
      flame.renderSettings.colorInitMode = value as
        | 'colorInitZero'
        | 'colorInitPosition'
    }
  }

  const pointInitModeTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'pointInitMode')
  if (pointInitModeTrack) {
    const value = resolveKeyframeValue(pointInitModeTrack.keyframes, frame)
    if (value !== null && typeof value === 'string') {
      flame.renderSettings.pointInitMode = value as PointInitMode
    }
  }

  // Animate backgroundColor (array of 3 numbers)
  const backgroundColorTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'backgroundColor')
  if (backgroundColorTrack) {
    const value = resolveKeyframeValue(backgroundColorTrack.keyframes, frame)
    if (
      value !== null &&
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      typeof value[2] === 'number'
    ) {
      flame.renderSettings.backgroundColor = value
    }
  }

  // Animate edgeFadeColor (array of 4 numbers)
  const edgeFadeColorTrack = timeline
    .tracks()
    .find((t: TimelineTrack) => t.parameterPath === 'edgeFadeColor')
  if (edgeFadeColorTrack) {
    const value = resolveKeyframeValue(edgeFadeColorTrack.keyframes, frame)
    if (value !== null && Array.isArray(value) && value.length === 4) {
      const typed = value as unknown as [number, number, number, number]
      ;(flame as unknown as Record<string, unknown>).edgeFadeColor = typed
    }
  }
}
