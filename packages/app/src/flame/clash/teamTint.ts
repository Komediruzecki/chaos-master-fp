// A clash team's colour: a hue on the OkLab (a, b) plane, for every transform of that team.

/**
 * How far from grey a team tint sits in OkLab: about as saturated as the
 * editor's own colours, whose randomiser draws `a` and `b` within +-0.4.
 */
const TEAM_CHROMA = 0.3

type OkLabAB = { x: number; y: number }

/**
 * A team's hue, a fraction of a turn, as a transform colour.
 *
 * A transform's `color` is an OkLab `(a, b)` pair. The arena's tint used to
 * write the hue into `a` and 1.0 into `b`, which put both teams in the same
 * yellow-orange; here the hue is an angle on the (a, b) plane, so the arena's
 * defaults 0.15 and 0.65 are amber and blue, half a turn apart.
 */
function teamTintColor(hue: number): OkLabAB {
  const angle = hue * 2 * Math.PI
  return { x: TEAM_CHROMA * Math.cos(angle), y: TEAM_CHROMA * Math.sin(angle) }
}

/** A transform colour as stored (an object, or a legacy pair), or grey. */
function colorOf(raw: unknown): OkLabAB {
  if (typeof raw === 'object' && raw !== null && 'x' in raw && 'y' in raw) {
    const { x, y } = raw
    return { x: Number(x) || 0, y: Number(y) || 0 }
  }
  if (Array.isArray(raw)) {
    return { x: Number(raw[0]) || 0, y: Number(raw[1]) || 0 }
  }
  return { x: 0, y: 0 }
}

/**
 * A transform's colour on a team: the team colour itself (`override`), or the
 * midpoint between the transform's own colour and it (`blend`).
 */
export function teamTintedColor(
  own: unknown,
  hue: number,
  mode: 'override' | 'blend',
): OkLabAB {
  const team = teamTintColor(hue)
  if (mode === 'override') return team
  const base = colorOf(own)
  return { x: (base.x + team.x) / 2, y: (base.y + team.y) / 2 }
}
