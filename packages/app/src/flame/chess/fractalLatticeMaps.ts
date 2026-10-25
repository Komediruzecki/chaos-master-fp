/** Whole-attractor affine studies: pierced volumes, folded ribbons and recursive lace. */
import { diagonal, product, rotation } from './fractalChessMaps'
import type { ChessCandidateRole } from './chessCandidate'
import type { ArtMap, Matrix3, Point3 } from './fractalChessMaps'

const turn = Math.PI * 2

function similarity(scale: number, yaw = 0, pitch = 0): Matrix3 {
  return product(
    diagonal(scale),
    product(rotation(yaw, 'y'), rotation(pitch, 'x')),
  )
}

function tetrahedron(): ArtMap[] {
  // A genuine tetrahedral gasket: four vertex contractions share one walk.
  const vertices: Point3[] = [[0, 1, 0]]
  for (let n = 0; n < 3; n++) {
    const angle = (n * turn) / 3 + Math.PI / 6
    vertices.push([
      Math.sqrt(8 / 9) * Math.cos(angle),
      -1 / 3,
      Math.sqrt(8 / 9) * Math.sin(angle),
    ])
  }
  return vertices.map((vertex, n) => ({
    matrix: diagonal(0.5),
    offset: vertex.map((value) => value * 0.5) as unknown as Point3,
    colour: n === 0 ? 2 : n % 2,
  }))
}

function windowTower(): ArtMap[] {
  const maps: ArtMap[] = []
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1]) {
      if (x === 0 && y === 0) continue
      // Eight perimeter contractions keep the large central window empty at
      // every scale. Corner relief creates real depth without the many back
      // layers of a volumetric Menger sponge filling its projected openings.
      maps.push({
        matrix: diagonal(1 / 3),
        offset: [(x * 2) / 3, (y * 2) / 3, x * y * 0.25],
        colour: y + 1,
        weight: y === 0 ? 1.25 : 1,
      })
    }
  return maps
}

function foldedDragon(): ArtMap[] {
  // Two similarity maps retain the dragon's folding grammar. Opposed depth
  // rotations lift the folds into a spatial ribbon instead of a flat emblem.
  const scale = 1 / Math.sqrt(2)
  return [
    {
      matrix: product(similarity(scale, 0.32, -0.12), rotation(Math.PI / 4)),
      offset: [-0.27, -0.48, -0.08],
      weight: 0.52,
      colour: 0,
    },
    {
      matrix: product(
        similarity(scale, -0.44, 0.19),
        rotation((3 * Math.PI) / 4),
      ),
      offset: [0.6, 0.35, 0.16],
      weight: 0.48,
      colour: 2,
    },
  ]
}

function octahedron(): ArtMap[] {
  const vertices: Point3[] = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]
  return vertices.map((vertex, n) => ({
    matrix: diagonal(0.5),
    offset: vertex.map((value) => value * 0.5) as unknown as Point3,
    colour: n === 0 ? 2 : n === 1 ? 0 : 1,
    weight: n < 2 ? 1.25 : 1,
  }))
}

function pentagonalLace(): ArtMap[] {
  const maps: ArtMap[] = []
  const lean = 0.62
  const branch = product(rotation(-lean, 'z'), diagonal(0.31, 0.54, 0.31))
  for (let n = 0; n < 5; n++) {
    const angle = (n * turn) / 5
    // Every upward lobe maps the stem's lower fixed point [0,-1,0] to
    // [0,0.1,0]. A shared root keeps the five-point crown cohesive in space.
    const radius = 0.54 * Math.sin(lean)
    maps.push({
      matrix: product(rotation(-angle, 'y'), branch),
      offset: [
        radius * Math.cos(angle),
        0.1 + 0.54 * Math.cos(lean),
        radius * Math.sin(angle),
      ],
      colour: n % 2 === 0 ? 2 : 1,
      weight: 1,
    })
  }
  maps.push(
    {
      matrix: diagonal(0.25, 0.55, 0.25),
      offset: [0, -0.45, 0],
      colour: 0,
      weight: 1.5,
    },
    {
      matrix: diagonal(0.42, 0.12, 0.42),
      offset: [0, -0.88, 0],
      colour: 0,
      weight: 0.7,
    },
  )
  return maps
}

function openCitadel(): ArtMap[] {
  const maps: ArtMap[] = []
  // A square-pyramid gasket tapers continuously into its apex: the four
  // lower corner recurrences meet the upper pyramid along their sloping edges.
  // Their missing central cells leave large pierced windows, unlike the rook.
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      maps.push({
        matrix: diagonal(0.5),
        offset: [x * 0.35, -0.5, z * 0.35],
        colour: x === z ? 0 : 1,
      })
  maps.push(
    {
      matrix: diagonal(0.5),
      offset: [0, 0.5, 0],
      colour: 2,
      weight: 1.2,
    },
    {
      matrix: diagonal(0.58, 0.085, 0.58),
      offset: [0, -0.915, 0],
      colour: 0,
      weight: 0.8,
    },
  )
  return maps
}

/** All maps are contractive; palette indices never alter their geometry. */
export function latticeMaps(role: ChessCandidateRole): ArtMap[] {
  switch (role) {
    case 'pawn':
      return tetrahedron()
    case 'rook':
      return windowTower()
    case 'knight':
      return foldedDragon()
    case 'bishop':
      return octahedron()
    case 'queen':
      return pentagonalLace()
    case 'king':
      return openCitadel()
  }
}
