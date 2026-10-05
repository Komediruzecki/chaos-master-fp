/** Conservative corner relaxation for exposed, manifold material boundaries only. */
import { d, std, tgpu } from 'typegpu'
import { EXPOSED_TEAR_FACE } from '@/simulation/gummy/gummyMesh'

/** Loop's vertex mask, evaluated once for each topology rather than every frame. */
export function gummyRoundingWeight(valence: number) {
  if (!Number.isInteger(valence) || valence < 3) return 0
  if (valence === 3) return 3 / 16
  return (
    (5 / 8 - (3 / 8 + Math.cos((2 * Math.PI) / valence) / 4) ** 2) / valence
  )
}

/** Freeze open, pinched or disconnected boundary stars; never weld by position. */
export function prepareGummyRounding(nodeCount: number, surface: Uint32Array) {
  const links: Map<number, number[]>[] = Array.from(
    { length: nodeCount },
    () => new Map(),
  )
  const exposed = new Uint8Array(nodeCount)
  for (let offset = 0; offset < surface.length; offset += 4) {
    for (let corner = 0; corner < 3; corner++) {
      const node = surface[offset + corner]!
      const a = surface[offset + ((corner + 1) % 3)]!
      const b = surface[offset + ((corner + 2) % 3)]!
      if (surface[offset + 3] === EXPOSED_TEAR_FACE) exposed[node] = 1
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const neighbors = links[node]!.get(from!) ?? []
        neighbors.push(to!)
        links[node]!.set(from!, neighbors)
      }
    }
  }
  return links.map((link, node) => {
    if (
      !exposed[node] ||
      link.size < 3 ||
      [...link.values()].some(
        (neighbors) => neighbors.length !== 2 || neighbors[0] === neighbors[1],
      )
    )
      return []
    const visited = new Set<number>()
    const pending = [link.keys().next().value!]
    while (pending.length) {
      const neighbor = pending.pop()!
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      pending.push(...link.get(neighbor)!)
    }
    return visited.size === link.size
      ? [...link.keys()].sort((a, b) => a - b)
      : []
  })
}

/** One convex stencil moves a corner by at most 0.3 of its current material support.
 * The same scalar must be used for world and rest positions, so dye follows material.
 * This is bounded render relaxation; it does not alter solver mass or claim equal visible volume. */
export const gummyRoundingScale = tgpu.fn(
  [d.vec3f, d.f32],
  d.f32,
)((delta, support) => {
  'use gpu'
  return std.min(
    1,
    (std.max(support, 0) * 0.3) / std.max(std.length(delta), 0.000001),
  )
})
