/** Whole-attractor botanical recurrences: leaves, coral, fern and branching crowns. */
import { diagonal, product, rotation } from './fractalChessMaps'
import type { ChessCandidateRole } from './chessCandidate'
import type { ArtMap, Matrix3, Point3 } from './fractalChessMaps'

const branch = (
  scale: Point3,
  turn: number,
  twist: number,
  offset: Point3,
  colour: number,
  weight = 1,
): ArtMap => ({
  matrix: product(
    rotation(twist, 'y'),
    product(rotation(turn), diagonal(...scale)),
  ),
  offset,
  colour,
  weight,
  mix: [
    ['linear3D', 0.96],
    ['sinusoidal3D', 0.04],
  ],
})
const mapped = (
  matrix: Matrix3,
  offset: Point3,
  weight: number,
  colour: number,
): ArtMap => ({ matrix, offset, weight, colour })

export function organicMaps(role: ChessCandidateRole): ArtMap[] {
  switch (role) {
    case 'pawn':
      // A closed fern bud: every leaflet contains the same forked leaf.
      return [
        branch([0.52, 0.72, 0.49], 0.04, 0.28, [0, 0.35, 0], 0, 5),
        branch([0.43, 0.48, 0.38], -0.73, 0.22, [0.16, 0.15, 0.025], 1, 2),
        branch([0.43, 0.48, 0.38], 0.73, -0.22, [-0.16, 0.15, -0.025], 2, 2),
        mapped(diagonal(0.12, 0.4, 0.12), [0, -0.15, 0], 0.5, 2),
      ]
    case 'rook':
      // A broad, flat-topped fan coral. Alternating branch gaps remain open;
      // the short central leader gives this role a heavier, squatter outline.
      return [
        branch([0.42, 0.6, 0.42], 0, 0.2, [0, 0.36, 0], 0, 3),
        branch([0.39, 0.52, 0.42], -0.72, 0.16, [0.36, 0.23, 0], 1, 2),
        branch([0.39, 0.52, 0.42], 0.72, -0.16, [-0.36, 0.23, 0], 2, 2),
        branch([0.64, 0.12, 0.65], 0, 0, [0, -0.23, 0], 0, 1),
      ]
    case 'knight':
      // The fern's dominant recurrence curls the entire spine forward.
      return [
        mapped(
          [
            [0.02, 0, 0],
            [0, 0.18, 0],
            [0, 0, 0.08],
          ],
          [0, 0, 0],
          0.7,
          2,
        ),
        mapped(
          [
            [0.81, 0.1, 0.035],
            [-0.1, 0.82, 0],
            [0.02, 0.018, 0.74],
          ],
          [0.015, 0.27, 0],
          8,
          0,
        ),
        branch([0.31, 0.41, 0.42], -1.04, 0.28, [0.03, 0.2, 0], 1),
        branch([0.31, 0.42, 0.42], 1.02, -0.35, [-0.03, 0.16, 0], 2),
      ]
    case 'bishop':
      // Two self-similar wings leave a persistent central cleft.
      return [
        branch([0.49, 0.64, 0.46], -0.3, 0.2, [0.31, 0.5, 0], 0, 2),
        branch([0.49, 0.64, 0.46], 0.3, -0.2, [-0.31, 0.5, 0], 1, 2),
        branch([0.35, 0.4, 0.5], 0, 1.1, [0, -0.14, 0], 2, 0.8),
      ]
    case 'queen': {
      // Five open leaf fans share a root above a flared stem. Narrow transverse
      // scales retain the branching veins instead of merging into a canopy.
      const lean = 0.52
      const sy = 0.6
      return Array.from({ length: 5 }, (_, n) => {
        const a = (n * Math.PI * 2) / 5
        return branch(
          [0.22, sy, 0.22],
          -lean,
          a,
          [
            sy * Math.sin(lean) * Math.cos(a),
            0.08 + sy * Math.cos(lean),
            -sy * Math.sin(lean) * Math.sin(a),
          ],
          n % 3,
          1.2,
        )
      }).concat([
        branch([0.22, 0.53, 0.22], 0, 0.2, [0, -0.47, 0], 2, 1.5),
        branch([0.48, 0.1, 0.48], 0, 0, [0, -0.9, 0], 0, 0.8),
      ])
    }
    case 'king':
      // A four-way tree with a separate continuing leader, all one recurrence.
      return [
        branch([0.53, 0.7, 0.53], 0, 0.28, [0, 0.58, 0], 0, 3),
        ...[0, 1, 2, 3].map((n) => {
          const a = (n * Math.PI) / 2
          return branch(
            [0.39, 0.49, 0.39],
            0.8,
            a,
            [0.34 * Math.cos(a), 0.25, -0.34 * Math.sin(a)],
            n % 3,
            1,
          )
        }),
        branch([0.09, 0.49, 0.09], 0, 0, [0, -0.3, 0], 2, 0.5),
      ]
  }
}
