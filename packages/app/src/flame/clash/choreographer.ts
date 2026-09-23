/**
 * The scripted 12-second bout of the Flame Clash preview: the intro, one hit,
 * a beam clash, the Devour finisher and the victory, as a pure function of
 * time.
 *
 * Everything that moves is a uniform of the fight flame (placements, morph,
 * tint, split, leak, exposure) or the camera, so a whole bout compiles one
 * shader. The same wall time always gives the same frame, which is what a
 * clip export and a test both need.
 *
 * Two clocks run through it. Wall time is the real clock. Story time is wall
 * time held still for a few frames at each impact (a hit-stop): the action
 * freezes, the progressive renderer converges, and the impact frame becomes
 * the sharpest of the fight. The camera shake keeps to wall time, so the
 * freeze still trembles.
 *
 * Reduced motion keeps the story, the outcome and the captions, and drops
 * what moves the eye: the camera holds still, the fighters hold their marks,
 * nothing flashes, squashes or shakes, and the hit arrives as a slow leak.
 *
 * The winner is an input. Phase 1 scripts it; phase 2 hands in the result of
 * the rules, and `boutCues` is where sound and clip export will hook on.
 */
import { DEFAULT_TINT } from './tint'
import type { Placement, Vec3 } from './placement'
import type { Team } from './tint'

export type Beat = 'intro' | 'strike' | 'clash' | 'devour' | 'victory'

export type FighterPose = {
  placement: Placement
  /** 0 the flat card, 1 the full 3D form (2D fighters only). */
  morph: number
  /** How far the fighter's hues are pulled to its team colour. */
  tint: number
}

/** The orbit camera, and how much of the arena it must show. */
export type ClashCamera = {
  theta: number
  phi: number
  fov: number
  target: Vec3
  /** Half the arena width and height, in arena units, the frame must hold. */
  halfWidth: number
  halfHeight: number
}

export type BoutFrame = {
  wall: number
  story: number
  beat: Beat
  /** True once the bout has played out; the frame then holds the victory. */
  done: boolean
  a: FighterPose
  b: FighterPose
  /** The fight uniforms: team A's share of walkers, and each side's leak. */
  split: number
  leakA: number
  leakB: number
  /** Multiplies the stage exposure: above 1 is an impact flash. */
  exposure: number
  camera: ClashCamera
}

export type BoutOptions = { winner: Team; reducedMotion: boolean }

export const BOUT_SECONDS = 12

/** Story times of the impacts, and how long each one holds. */
export const HIT_STOPS = [
  { at: 3.15, hold: 0.09 },
  { at: 9.9, hold: 0.11 },
] as const

const STORY_SECONDS =
  BOUT_SECONDS - HIT_STOPS.reduce((sum, stop) => sum + stop.hold, 0)

/** Story time of the start of each beat. */
const BEAT_STARTS: readonly (readonly [Beat, number])[] = [
  ['intro', 0],
  ['strike', 2.4],
  ['clash', 5.0],
  ['devour', 8.2],
  ['victory', 10.4],
]

/** Story time at wall time `wall`: the wall clock with each hit-stop held. */
export function storyTime(wall: number): number {
  const t = Number.isFinite(wall) ? Math.max(0, wall) : 0
  let shift = 0
  for (const stop of HIT_STOPS) {
    const start = stop.at + shift
    if (t < start) break
    if (t < start + stop.hold) return stop.at
    shift += stop.hold
  }
  return Math.min(STORY_SECONDS, t - shift)
}

/** The wall time a story moment first shows. */
export function wallTime(story: number): number {
  let wall = story
  for (const stop of HIT_STOPS) if (story > stop.at) wall += stop.hold
  return wall
}

export type BoutCue = {
  /** Wall seconds from the start of the bout. */
  wall: number
  kind: 'intro' | 'impact' | 'clash' | 'devour' | 'swallow' | 'victory' | 'end'
  /** The team that acts, where one does. */
  by?: Team
}

/** The moments sound and clip export hook onto, in wall time. */
export function boutCues(winner: Team): BoutCue[] {
  return [
    { wall: 0, kind: 'intro' },
    { wall: wallTime(HIT_STOPS[0].at), kind: 'impact', by: winner },
    { wall: wallTime(5.0), kind: 'clash' },
    { wall: wallTime(8.2), kind: 'devour', by: winner },
    { wall: wallTime(HIT_STOPS[1].at), kind: 'swallow', by: winner },
    { wall: wallTime(10.4), kind: 'victory', by: winner },
    { wall: BOUT_SECONDS, kind: 'end' },
  ]
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** 0 before a, 1 after b, a smooth S between. */
const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a))
  return x * x * (3 - 2 * x)
}
/** 0 outside [a, b]; jumps to 1 at a and decays: a hit envelope. */
const pulse = (a: number, b: number, t: number) =>
  t < a || t > b ? 0 : Math.exp((-5 * (t - a)) / (b - a))
/** Fast early, slow late: the morph's visible change sits near 1. */
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3

/** The arena's fight line: A stands at -x, B at +x. */
const sideOf = (team: Team) => (team === 'A' ? -1 : 1)
/** B walks on a beat after A. */
const entranceDelay = (team: Team) => (team === 'A' ? 0 : 0.2)
const SEPARATION = 1.45
const ENTRANCE = 4.4
const MORPH_START = 0.5
const MORPH_END = 2.2

export function beatAt(story: number): Beat {
  let beat: Beat = 'intro'
  for (const [name, start] of BEAT_STARTS) if (story >= start) beat = name
  return beat
}

/** Shared by both scripts: the flat card inflating and the team colour. */
function introLooks(story: number) {
  return {
    morph: easeOut((story - MORPH_START) / (MORPH_END - MORPH_START)),
    tint: DEFAULT_TINT * smooth(1.2, 2.2, story),
  }
}

/** Walker share and leaks: the fight's uniforms, as the winner's share. */
function fightUniforms(s: number, reducedMotion: boolean) {
  const approach = smooth(5.0, 5.7, s)
  const devour = smooth(8.3, 9.9, s)
  const gone = smooth(9.9, 10.3, s)
  const sway = reducedMotion
    ? 0
    : 0.1 * Math.sin(2 * Math.PI * 0.5 * (s - 5.3)) * approach
  const clashShare = 0.5 + sway + 0.1 * smooth(7.4, 8.2, s)
  const winnerShare = lerp(lerp(clashShare, 0.985, devour), 1, gone)
  const clinch = reducedMotion
    ? 0.06
    : 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.4 * (s - 5)))
  const inClinch = approach * (1 - smooth(8.2, 8.6, s))
  const hit = reducedMotion
    ? 0.18 * smooth(2.9, 3.3, s) * (1 - smooth(3.6, 4.6, s))
    : 0.32 * pulse(3.15, 3.5, s)
  const swallowed = 0.85 * smooth(8.3, 9.3, s) * (1 - gone)
  return {
    winnerShare,
    winnerLeak: Math.max(hit, clinch * inClinch),
    loserLeak: Math.max(clinch * inClinch, swallowed),
  }
}

const pose = (
  position: Vec3,
  rest: Partial<Omit<Placement, 'position'>>,
  looks: { morph: number; tint: number },
): FighterPose => ({
  placement: {
    position,
    yaw: rest.yaw ?? 0,
    lean: rest.lean ?? 0,
    scale: rest.scale ?? 1,
    squash: rest.squash ?? 1,
  },
  ...looks,
})

function fullMotion(s: number, wall: number, winner: Team) {
  const loser: Team = winner === 'A' ? 'B' : 'A'
  const sw = sideOf(winner)
  const sl = sideOf(loser)
  const looks = introLooks(s)
  const enter = (delay: number) => easeOut((s - delay) / 1.4)
  const approach = smooth(5.0, 5.7, s)
  const bob = (phase: number) => 0.06 * Math.sin(1.7 * s + phase)
  // The winner's strike: wind up, dash in, land at the impact, recover.
  const wind = smooth(2.4, 2.9, s) * (1 - smooth(2.9, 3.15, s))
  const dash = smooth(2.9, 3.15, s) * (1 - smooth(3.35, 3.95, s))
  const knock = pulse(3.15, 3.95, s)
  // Devour: the loser shrinks into the winner, the winner takes the centre.
  const shrink = smooth(8.6, 9.9, s)
  const drawn = smooth(8.8, 9.9, s)
  const centre = smooth(9.6, 10.4, s)
  const victory = smooth(10.4, 11.0, s)
  const stand = (team: Team) =>
    sideOf(team) *
    lerp(lerp(ENTRANCE, SEPARATION, enter(entranceDelay(team))), 0.78, approach)
  const winnerX =
    lerp(stand(winner), 0, centre) - sw * (1.05 * dash - 0.3 * wind)
  const loserX = lerp(stand(loser) + sl * 0.55 * knock, sw * 0.3, drawn)
  const facing = (side: number) => -side * lerp(0.3, 0.55, approach)
  const winnerPose = pose(
    [winnerX, bob(0), 0],
    {
      yaw: lerp(facing(sw), 0, victory) + 0.5 * Math.max(0, s - 10.4),
      lean: -sw * (0.22 * dash - 0.18 * wind),
      scale:
        lerp(0.75, 1, enter(entranceDelay(winner))) *
        lerp(1, 1.12, smooth(9.0, 10.2, s)),
    },
    looks,
  )
  const loserPose = pose(
    [loserX, bob(1.3), 0],
    {
      yaw: facing(sl),
      lean: sl * 0.25 * knock,
      scale: lerp(0.75, 1, enter(entranceDelay(loser))) * lerp(1, 0.35, shrink),
      squash: 1 - 0.32 * pulse(3.15, 3.6, s),
    },
    looks,
  )
  const shake = 0.05 * pulse(3.15, 3.45, s)
  const push = smooth(8.4, 10.2, s)
  const camera: ClashCamera = {
    // Keeps the fight line across the frame until only the winner is left.
    theta:
      -0.5 +
      0.5 * smooth(0, 2.4, s) +
      0.15 * smooth(2.4, 5.0, s) +
      0.6 * smooth(5.0, 8.2, s) -
      0.2 * smooth(8.2, 10.4, s) +
      0.5 * smooth(10.4, 11.8, s),
    phi: lerp(1.28, 1.18, smooth(5.0, 6.0, s)),
    fov: 50,
    target: [
      winnerX * push + shake * Math.sin(wall * 83),
      shake * Math.cos(wall * 71),
      0,
    ],
    halfWidth: lerp(lerp(SEPARATION + 1.3, 2.0, approach), 1.5, push),
    halfHeight: 1.4,
  }
  const exposure = 1 + 0.8 * pulse(3.15, 3.33, s) + 0.5 * pulse(9.9, 10.3, s)
  return { winnerPose, loserPose, camera, exposure }
}

function reduced(s: number, winner: Team) {
  const loser: Team = winner === 'A' ? 'B' : 'A'
  const looks = introLooks(s)
  const still = (team: Team) =>
    pose([sideOf(team) * SEPARATION, 0, 0], { yaw: -sideOf(team) * 0.3 }, looks)
  const camera: ClashCamera = {
    theta: 0.25,
    phi: 1.25,
    fov: 50,
    target: [0, 0, 0],
    halfWidth: SEPARATION + 1.3,
    halfHeight: 1.4,
  }
  return {
    winnerPose: still(winner),
    loserPose: still(loser),
    camera,
    exposure: 1,
  }
}

/** The bout at wall time `wall` (seconds). */
export function boutFrame(wall: number, options: BoutOptions): BoutFrame {
  const w = Number.isFinite(wall) ? Math.max(0, wall) : 0
  const s = storyTime(w)
  const { winner, reducedMotion } = options
  const staged = reducedMotion ? reduced(s, winner) : fullMotion(s, w, winner)
  const fight = fightUniforms(s, reducedMotion)
  const aWins = winner === 'A'
  return {
    wall: w,
    story: s,
    beat: beatAt(s),
    done: w >= BOUT_SECONDS,
    a: aWins ? staged.winnerPose : staged.loserPose,
    b: aWins ? staged.loserPose : staged.winnerPose,
    split: aWins ? fight.winnerShare : 1 - fight.winnerShare,
    leakA: aWins ? fight.winnerLeak : fight.loserLeak,
    leakB: aWins ? fight.loserLeak : fight.winnerLeak,
    exposure: staged.exposure,
    camera: staged.camera,
  }
}

/**
 * The orbit camera for a canvas of `aspect` (width / height): the radius
 * that holds the arena's half-width and half-height in the frame.
 */
export function orbitCamera(camera: ClashCamera, aspect: number) {
  const slope = Math.tan((camera.fov * Math.PI) / 360)
  const wide = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 0.1
  return {
    theta: camera.theta,
    phi: camera.phi,
    radius: Math.max(
      camera.halfHeight / slope,
      camera.halfWidth / (slope * wide),
    ),
    target: [...camera.target] as [number, number, number],
    fov: camera.fov,
    roll: 0,
  }
}

/** What the stage says during `beat`, by the fighters' names. */
export function beatCaption(
  beat: Beat,
  names: Record<Team, string>,
  winner: Team,
): string {
  const loser: Team = winner === 'A' ? 'B' : 'A'
  switch (beat) {
    case 'intro':
      return `${names.A} vs ${names.B}`
    case 'strike':
      return `${names[winner]} strikes`
    case 'clash':
      return 'Beam clash'
    case 'devour':
      return `${names[winner]} devours ${names[loser]}`
    case 'victory':
      return `${names[winner]} wins`
  }
}
