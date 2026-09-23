/**
 * Team colour for Flame Clash fighters, in the renderer's own colour space.
 *
 * A transform's colour (x, y) is an OkLab (a, b) pair: its angle is the hue
 * and its length the chroma, and the renderer adds lightness from density.
 * So a fighter takes its team's colour by turning each transform's hue toward
 * the team hue and pulling its chroma to the team chroma. Hue moves in the hue
 * channel: mixing (a, b) toward a team point instead, as a straight blend
 * does, drains chroma on the way and greys out a fighter whose colours sit
 * opposite the team's.
 *
 * The pair is Okabe and Ito's orange and sky blue, which stay apart for the
 * common forms of colour blindness and have near-equal lightness, so neither
 * side looks stronger for its colour.
 */

export type Team = 'A' | 'B'

type TeamColour = {
  /** OkLab hue, radians. */
  hue: number
  /** The chroma a fully tinted transform takes. */
  chroma: number
  /** The same colour for the page (HUD badges, captions). */
  css: string
}

const degrees = (d: number) => (d * Math.PI) / 180

export const TEAM_COLOUR: Record<Team, TeamColour> = {
  // #E69F00: OkLab L 0.753, hue 76.8 deg.
  A: { hue: degrees(76.8), chroma: 0.15, css: '#e69f00' },
  // #56B4E9: OkLab L 0.735, hue 236.2 deg.
  B: { hue: degrees(236.2), chroma: 0.15, css: '#56b4e9' },
}

/** How far a fighter's hues are pulled to its team's by default. */
export const DEFAULT_TINT = 0.7

/** The angle `x` wrapped into (-pi, pi]. */
export function wrapAngle(x: number): number {
  const turn = 2 * Math.PI
  const wrapped = x - turn * Math.floor((x + Math.PI) / turn)
  return wrapped === -Math.PI ? Math.PI : wrapped
}

/**
 * A transform colour turned toward `team`. `amount` 0 leaves it as it is;
 * 1 gives exactly the team colour; in between, its hue keeps `1 - amount` of
 * its distance from the team hue (the short way round) and its chroma moves
 * the same share toward the team chroma. A grey transform has no hue to keep
 * and takes the team's.
 */
export function tintColour(
  colour: { x: number; y: number },
  team: Team,
  amount: number,
): { x: number; y: number } {
  const k = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0
  const target = TEAM_COLOUR[team]
  const chroma = Math.hypot(colour.x, colour.y)
  const hue = chroma > 1e-6 ? Math.atan2(colour.y, colour.x) : target.hue
  const h = target.hue + (1 - k) * wrapAngle(hue - target.hue)
  const c = chroma + k * (target.chroma - chroma)
  return { x: c * Math.cos(h), y: c * Math.sin(h) }
}

/** The hue of a colour, for tests and readouts: radians in (-pi, pi]. */
export function hueOf(colour: { x: number; y: number }): number {
  return Math.atan2(colour.y, colour.x)
}
