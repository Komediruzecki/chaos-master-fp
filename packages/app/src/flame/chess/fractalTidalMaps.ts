/** Curved whole-attractor IFS forms: coils, fans, waves and linked recursive ribbons. */
import { diagonal, product, rotation } from './fractalChessMaps'
import type { ChessCandidateRole } from './chessCandidate'
import type { ArtMap, Point3 } from './fractalChessMaps'

function coil(
  scale: Point3,
  turn: number,
  twist: number,
  offset: Point3,
  colour: number,
  weight = 1,
  curl = 0,
): ArtMap {
  return {
    matrix: product(
      rotation(twist, 'y'),
      product(rotation(turn), diagonal(...scale)),
    ),
    offset,
    colour,
    weight,
    mix: curl
      ? [
          ['linear3D', 1 - curl],
          ['curl3D', curl],
        ]
      : [['linear3D', 1]],
  }
}

export function tidalMaps(role: ChessCandidateRole): ArtMap[] {
  switch (role) {
    case 'pawn':
      return [
        coil([0.76, 0.76, 0.62], 0.62, 0.16, [0.03, 0.03, 0], 0, 4),
        coil([0.32, 0.38, 0.44], -0.7, 0.45, [0.72, 0.05, 0], 1, 1, 0.07),
        coil([0.24, 0.28, 0.36], 0.6, -0.45, [0.6, 0.19, 0], 2, 0.6),
      ]
    case 'rook':
      // Opposed inward curls leave a broad central well. Depth rotations make
      // a spatial basket, rather than filling the opening with a second wall.
      return [
        coil([0.4, 0.58, 0.4], 0.48, 0.12, [-0.268, 0.614, 0.032], 0, 2),
        coil([0.4, 0.58, 0.4], -0.48, -0.12, [0.268, 0.614, 0.032], 1, 2),
        coil([0.4, 0.55, 0.4], 0, 0.12, [0, -0.45, 0], 2, 1.5),
        coil([0.66, 0.12, 0.6], 0, 0, [0, -0.88, 0], 2, 1),
      ]
    case 'knight':
      // Two unequal opposed scrolls create a directional crest and a hooked tail.
      return [
        coil([0.71, 0.77, 0.59], -0.57, 0.18, [-0.08, 0.24, 0], 0, 4),
        coil(
          [0.43, 0.49, 0.58],
          1.8,
          -0.34,
          [0.53, -0.09, 0.08],
          1,
          1.6,
          0.055,
        ),
        coil([0.32, 0.28, 0.4], -0.8, 0.55, [-0.19, -0.36, -0.06], 2, 0.7),
      ]
    case 'bishop':
      // A twisted bifurcating ribbon, with nested fork gaps through the centre.
      return [
        coil([0.57, 0.6, 0.57], -0.55, 0.42, [0.38, 0.34, 0], 0, 1, 0.05),
        coil([0.57, 0.6, 0.57], 0.55, -0.42, [-0.38, 0.34, 0], 1, 1, 0.05),
        coil([0.3, 0.45, 0.32], 0, 0.3, [0, -0.48, 0], 2, 0.7),
      ]
    case 'queen': {
      // Three rising spiral arms meet a flared foot. Each arm contains the
      // entire recurrence, so the crown has nested curls rather than lobes.
      const lean = 0.64
      const sy = 0.55
      return Array.from({ length: 3 }, (_, n) => {
        const a = (n * Math.PI * 2) / 3
        return coil(
          [0.32, sy, 0.32],
          -lean,
          a,
          [
            sy * Math.sin(lean) * Math.cos(a),
            0.1 + sy * Math.cos(lean),
            -sy * Math.sin(lean) * Math.sin(a),
          ],
          n,
          1.5,
          0.06,
        )
      }).concat([
        coil([0.27, 0.55, 0.27], 0, 0.55, [0, -0.45, 0], 0, 1.5),
        coil([0.52, 0.12, 0.52], 0, 0.3, [0, -0.88, 0], 2, 1),
      ])
    }
    case 'king':
      // A shared upward screw motion winds two root ribbons around one axis.
      // The radius contracts as they rise, ending at a single upright apex.
      return [
        coil([0.86, 0.86, 0.86], 0, 0.68, [0, 0.28, 0], 0, 6),
        coil([0.38, 0.12, 0.3], 0, 0.4, [0.52, -0.6, 0], 1, 1.2),
        coil([0.38, 0.12, 0.3], 0, -0.4, [-0.52, -0.6, 0], 2, 1.2),
        coil([0.6, 0.07, 0.6], 0, 0, [0, -0.75, 0], 2, 0.6),
      ]
  }
}
