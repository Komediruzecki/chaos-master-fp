/** Exact shared-node components and incident tetrahedra for runtime fracture rendering. */
import { EXPOSED_TEAR_FACE } from '@/simulation/gummy/gummyMesh'

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

const faceKey = (nodes: number[]) => nodes.sort((a, b) => a - b).join(':')

function oppositeSide(
  positions: Float32Array,
  nodes: number[],
  opposite: number,
) {
  const a = nodes[0]! * 4,
    b = nodes[1]! * 4,
    c = nodes[2]! * 4,
    q = opposite * 4
  const u = [0, 1, 2].map((axis) => positions[b + axis]! - positions[a + axis]!)
  const v = [0, 1, 2].map((axis) => positions[c + axis]! - positions[a + axis]!)
  const n = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ]
  return n.reduce(
    (sum, value, axis) =>
      sum + value * (positions[q + axis]! - positions[a + axis]!),
    0,
  )
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
  const opposites = new Map<string, number[]>()
  for (let offset = 0; offset < tetrahedra.length; offset += 4) {
    const tet = Array.from(tetrahedra.subarray(offset, offset + 4)) as Tet
    if (new Set(tet).size !== 4 || tet.some((node) => node >= count))
      throw new Error('Invalid runtime gummy tetrahedron')
    for (const node of tet) {
      parent[find(node)] = find(tet[0])
      incident[node]!.push(tet)
    }
    for (let corner = 0; corner < 4; corner++) {
      const key = faceKey(tet.filter((_, index) => index !== corner))
      const list = opposites.get(key) ?? []
      list.push(tet[corner]!)
      opposites.set(key, list)
    }
  }
  const components = new Map<number, number>()
  const metadata = new Uint32Array(surface.length)
  const wet = gummyTearVertexWeights(incident, surface)
  for (let offset = 0; offset < surface.length; offset += 4) {
    const nodes = Array.from(surface.subarray(offset, offset + 3))
    const component = find(nodes[0]!)
    if (nodes.some((node) => find(node) !== component))
      throw new Error('Runtime gummy surface crosses components')
    if (!components.has(component))
      components.set(component, components.size + 1)
    const candidates = opposites.get(faceKey([...nodes]))
    const opposite = candidates?.find(
      (node) => oppositeSide(positions, nodes, node) < 0,
    )
    if (opposite === undefined)
      throw new Error('Runtime gummy surface has no inward tetrahedron')
    metadata[offset] = components.get(component)!
    metadata[offset + 1] = opposite + 1
    metadata[offset + 2] = 1
    metadata[offset + 3] =
      wet[nodes[0]!]! | (wet[nodes[1]!]! << 8) | (wet[nodes[2]!]! << 16)
  }
  return { incident, metadata }
}
