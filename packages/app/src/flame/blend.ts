/**
 * Blend composition defaults: the weight a new blend partner starts at.
 *
 * One number with two readers: the blend gallery's hover preview, which
 * shows a partner at this weight and commits its pick at it, and
 * `flame.setBlendFlame`, which gives a blend that starts from none this
 * weight when the caller names none. A replay lands on what the viewer saw
 * only while the two agree.
 */

/** The share of the partner in a new blend, 0 to 1 (40%). */
export const DEFAULT_BLEND_WEIGHT = 0.4
