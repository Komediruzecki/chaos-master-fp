/** Exact shared-node components and incident tetrahedra for runtime fracture rendering. */
import { EXPOSED_TEAR_FACE } from '@/simulation/gummy/gummyMesh'
import { prepareGummyRounding } from './gummyRoundedSurface'

type Tet = [number, number, number, number]

/** Wet pigment follows actual crack vertices through shared material edges.
 * First neighbours remain fully wet, the second ring fades, and all other skin
 * keeps its bulk optics. Detached coincident copies never share this influence. */
export function gummyTearVertexWeights(
  incident: Tet[][],
  surface: Uint32Array,
) {
  const distance = new Uint8Array(incident.length).fill(255)
  const queue = new Uint32Array(incident.length)
  let head = 0,
    tail = 0
  for (let offset = 0; offset < surface.length; offset += 4) {
    if (surface[offset + 3] !== EXPOSED_TEAR_FACE) continue
    for (let corner = 0; corner < 3; corner++) {
      const node = surface[offset + corner]!
      if (distance[node] === 0) continue
      distance[node] = 0
      queue[tail++] = node
    }
  }
  while (head < tail) {
    const node = queue[head++]!
    const next = distance[node]! + 1
    if (next > 2) continue
    for (const tet of incident[node]!)
      for (const neighbour of tet) {
        if (distance[neighbour] !== 255) continue
        distance[neighbour] = next
        queue[tail++] = neighbour
      }
  }
  return Uint8Array.from(distance, (value) =>
    value < 2 ? 255 : value === 2 ? 128 : 0,
  )
}

function oppositeSide(
  positions: Float32Array,
  first: number,
  second: number,
  third: number,
  opposite: number,
) {
  const a = first * 4,
    b = second * 4,
    c = third * 4,
    q = opposite * 4
  const ux = positions[b]! - positions[a]!
  const uy = positions[b + 1]! - positions[a + 1]!
  const uz = positions[b + 2]! - positions[a + 2]!
  const vx = positions[c]! - positions[a]!
  const vy = positions[c + 1]! - positions[a + 1]!
  const vz = positions[c + 2]! - positions[a + 2]!
  return (
    (uy * vz - uz * vy) * (positions[q]! - positions[a]!) +
    (uz * vx - ux * vz) * (positions[q + 1]! - positions[a + 1]!) +
    (ux * vy - uy * vx) * (positions[q + 2]! - positions[a + 2]!)
  )
}

function validTet(a: number, b: number, c: number, q: number, count: number) {
  return (
    a < count &&
    b < count &&
    c < count &&
    q < count &&
    a !== b &&
    a !== c &&
    a !== q &&
    b !== c &&
    b !== q &&
    c !== q
  )
}

function inwardOwner(
  positions: Float32Array,
  candidates: readonly Tet[],
  a: number,
  b: number,
  c: number,
) {
  if (a === b || a === c || b === c) return undefined
  // The first face node already indexes every possible owner in input order.
  // Match all three exact IDs; a coincident detached copy is never a candidate.
  for (const tet of candidates) {
    if (!tet.includes(b) || !tet.includes(c)) continue
    for (const node of tet)
      if (node !== a && node !== b && node !== c) {
        if (oppositeSide(positions, a, b, c, node) < 0) return node
        break
      }
  }
  return undefined
}

export function prepareRuntimeGummyMetadata(
  positions: Float32Array,
  tetrahedra: Uint32Array,
  surface: Uint32Array,
) {
  const count = positions.length / 4
  if (!tetrahedra.length || tetrahedra.length % 4)
    throw new Error('Runtime gummy surface requires tetrahedra')
  const parent = Array.from({ length: count }, (_, node) => node)
  const find = (node: number) => {
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]!]!
      node = parent[node]!
    }
    return node
  }
  const incident: Tet[][] = Array.from({ length: count }, () => [])
  for (let offset = 0; offset < tetrahedra.length; offset += 4) {
    const a = tetrahedra[offset]!
    const b = tetrahedra[offset + 1]!
    const c = tetrahedra[offset + 2]!
    const q = tetrahedra[offset + 3]!
    if (!validTet(a, b, c, q, count))
      throw new Error('Invalid runtime gummy tetrahedron')
    const tet: Tet = [a, b, c, q]
    for (const node of tet) {
      parent[find(node)] = find(tet[0])
      incident[node]!.push(tet)
    }
  }
  const components = new Map<number, number>()
  const metadata = new Uint32Array(surface.length)
  const wet = gummyTearVertexWeights(incident, surface)
  for (let offset = 0; offset < surface.length; offset += 4) {
    const a = surface[offset]!
    const b = surface[offset + 1]!
    const c = surface[offset + 2]!
    const component = find(a)
    if (find(b) !== component || find(c) !== component)
      throw new Error('Runtime gummy surface crosses components')
    if (!components.has(component))
      components.set(component, components.size + 1)
    const opposite = inwardOwner(positions, incident[a]!, a, b, c)
    if (opposite === undefined)
      throw new Error('Runtime gummy surface has no inward tetrahedron')
    metadata[offset] = components.get(component)!
    metadata[offset + 1] = opposite + 1
    metadata[offset + 2] =
      wet[a]! > 0 &&
      incident[a]!.length === 1 &&
      incident[b]!.length === 1 &&
      incident[c]!.length === 1 &&
      incident[opposite]!.length === 1
        ? 2
        : 1
    metadata[offset + 3] = wet[a]! | (wet[b]! << 8) | (wet[c]! << 16)
  }
  return { incident, metadata, rounding: prepareGummyRounding(count, surface) }
}
